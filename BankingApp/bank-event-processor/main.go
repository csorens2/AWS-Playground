package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/rds/auth"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	sqstypes "github.com/aws/aws-sdk-go-v2/service/sqs/types"
	_ "github.com/go-sql-driver/mysql"
)

type ServerInfo struct {
	Version   string `json:"version"`
	Hostname  string `json:"hostname"`
	CurrentDB string `json:"currentDb"`
}

type InitializationMessage struct {
	Details InitializationDetails `json:"detail"`
}
type InitializationDetails struct {
	AccountNumber string  `json:"AccountNumber"`
	Amount        float64 `json:"Amount"`
}

type TransactionMessage struct {
	DebitAccountNumber  string  `json:"DebitAccountNumber"`
	CreditAccountNumber string  `json:"CreditAccountNumber"`
	Amount              float64 `json:"Amount"`
}

var (
	TransactionSQSURL          string
	InitializationSQSURL       string
	AccountStatusTableName     string
	TransactionLedgerTableName string

	SQSClient               *sqs.Client
	TransactionLedgerClient *sql.DB
	AccountStatusClient     *dynamodb.Client
)

const (
	TransactionSQSURLEnvVar    = "TRANSACTION_SQS_URL"
	InitializationSQSURLEnvVar = "INITIALIZATION_SQS_URL"

	AccountStatusTableNameEnvVar = "ACCOUNT_STATUS_TABLE_NAME"

	LedgerDatabaseSecretNameEnvVar = "LEDGER_DATABASE_SECRET_NAME"
	LedgerDatabaseHostnameEnvVar   = "LEDGER_DATABASE_HOSTNAME"
	LedgerDatabasePortEnvVar       = "LEDGER_DATABASE_PORT"
	LedgerDatabaseNameEnvVar       = "LEDGER_DATABASE_NAME"
	LedgerTableNameEnvVar          = "LEDGER_TABLE_NAME"
)

func init() {
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		log.Fatalf("unable to load SDK config: %v", err)
	}

	getEnvVar := func(envVarName string) string {
		var success bool
		envVarValue, success := os.LookupEnv(envVarName)
		if !success {
			log.Fatalf("env var '%s' not set", envVarName)
		}

		return envVarValue
	}

	TransactionSQSURL = getEnvVar(TransactionSQSURLEnvVar)
	InitializationSQSURL = getEnvVar(InitializationSQSURLEnvVar)

	AccountStatusTableName = getEnvVar(AccountStatusTableNameEnvVar)

	secretName := getEnvVar(LedgerDatabaseSecretNameEnvVar)
	ledgerHostname := getEnvVar(LedgerDatabaseHostnameEnvVar)
	ledgerPort := getEnvVar(LedgerDatabasePortEnvVar)
	ledgerDatabaseName := getEnvVar(LedgerDatabaseNameEnvVar)
	TransactionLedgerTableName = getEnvVar(LedgerTableNameEnvVar)

	secretUsername, secretPassword, err := getLedgerDatabaseUsernameAndPassword(context.TODO(), secretName)
	if err != nil {
		log.Fatalf("failed to acquire transaction ledger secret username and password : %v", err)
	}

	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?allowCleartextPasswords=true",
		secretUsername, secretPassword, ledgerHostname, ledgerPort, ledgerDatabaseName)

	TransactionLedgerClient, err = sql.Open("mysql", dsn)
	if err != nil {
		log.Fatalf("failed to open connection to transaction ledger database: %v", err)
	}

	SQSClient = sqs.NewFromConfig(cfg)
	AccountStatusClient = dynamodb.NewFromConfig(cfg)
}

func getLedgerDatabaseUsernameAndPassword(ctx context.Context, secretName string) (string, string, error) {
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return "", "", fmt.Errorf("failed to load AWS config: %w", err)
	}

	secretClient := secretsmanager.NewFromConfig(cfg)

	result, err := secretClient.GetSecretValue(ctx, &secretsmanager.GetSecretValueInput{
		SecretId: &secretName,
	})
	if err != nil {
		return "", "", fmt.Errorf("failed to get secret value: %w", err)
	}

	var secretMap map[string]interface{}
	if err = json.Unmarshal([]byte(*result.SecretString), &secretMap); err != nil {
		return "", "", fmt.Errorf("failed to unmarshal secret string: %w", err)
	}

	userNameFieldName := "username"
	passwordFieldName := "password"
	failureErrorString := "failed to acquire '%s' from secret string: field not present"

	username, exists := secretMap[userNameFieldName].(string)
	if !exists {
		return "", "", fmt.Errorf(failureErrorString, userNameFieldName)
	}

	password, exists := secretMap[passwordFieldName].(string)
	if !exists {
		return "", "", fmt.Errorf(failureErrorString, passwordFieldName)
	}

	return username, password, nil
}

func main() {
	lambda.Start(handler)
}

func handler(ctx context.Context) error {
	log.Println("Hello World from the Lambda!")

	log.Println("Checking if Transaction Ledger database is setup")
	isSetup, err := isLedgerDatabaseSetup(TransactionLedgerTableName)
	if err != nil {
		return err
	}

	if !isSetup {
		log.Println("Setting up transaction ledger database")
		err = setupLedgerDatabase(TransactionLedgerTableName)
		if err != nil {
			return err
		}
		log.Println("Successfully setup transaction ledger database")
	} else {
		log.Println("Ledger database already setup")
	}

	for {

		break
	}

	initializationMessages, err := getQueueMessages(ctx, InitializationSQSURL)
	if err != nil {
		return err
	}

	transactionMessages, err := getQueueMessages(ctx, TransactionSQSURL)
	if err != nil {
		return err
	}

	log.Printf("Num initialization messages: %d\n", len(initializationMessages.Messages))
	log.Printf("Num transaction messages: %d\n", len(transactionMessages.Messages))

	err = processInitializations(ctx, initializationMessages)
	if err != nil {
		return err
	}
	err = processTransactions(ctx, transactionMessages)
	if err != nil {
		return err
	}
	err = pingAccountStatusTable(ctx)
	if err != nil {
		return err
	}

	return nil
}

func isLedgerDatabaseSetup(transactionLedgerTableName string) (bool, error) {

	checkStatement := fmt.Sprintf("SHOW TABLES LIKE '%s'", transactionLedgerTableName)

	queryRows, err := TransactionLedgerClient.Query(checkStatement)
	if err != nil {
		return false, fmt.Errorf("failed to execute statement checking if transaction ledger table is present: %w", err)
	}

	rowCount := 0
	if queryRows.Next() {
		rowCount++
	}

	return rowCount == 1, nil
}

func setupLedgerDatabase(transactionLedgerTableName string) error {
	var statementBuilder strings.Builder
	statementBuilder.WriteString(fmt.Sprintf("CREATE TABLE %s(", transactionLedgerTableName))
	statementBuilder.WriteString("timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP, ")
	statementBuilder.WriteString("credit_account VARCHAR(20) NOT NULL, ")
	statementBuilder.WriteString("debit_account VARCHAR(20), ")
	statementBuilder.WriteString("amount DECIMAL(20,2) NOT NULL)")

	_, err := TransactionLedgerClient.Exec(statementBuilder.String())
	if err != nil {
		return fmt.Errorf("failed to create ledger table: %w", err)
	}

	return nil
}

func pingAccountStatusTable(ctx context.Context) error {
	log.Println("Attempting DDBTable Connection")

	_, err := AccountStatusClient.DescribeTable(ctx, &dynamodb.DescribeTableInput{
		TableName: &AccountStatusTableName,
	})

	if err != nil {
		return fmt.Errorf("unable to connect to DDBTable: %v", err)
	}

	log.Println("DDBTable ping successful")

	return nil
}

func getQueueMessages(ctx context.Context, queueURL string) (*sqs.ReceiveMessageOutput, error) {
	result, err := SQSClient.ReceiveMessage(ctx, &sqs.ReceiveMessageInput{
		QueueUrl:            &queueURL,
		MaxNumberOfMessages: 10,
		MessageAttributeNames: []string{
			".*",
		},
		MessageSystemAttributeNames: []sqstypes.MessageSystemAttributeName{
			sqstypes.MessageSystemAttributeNameAll,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to poll '%s' for messages: %v", queueURL, err)
	}

	return result, nil
}

func processInitializations(ctx context.Context, output *sqs.ReceiveMessageOutput) error {
	log.Println("Processing initializations")

	for _, nextMessage := range output.Messages {
		log.Printf("Processing Message '%s'\n", *nextMessage.MessageId)
		log.Printf("Message details: '%s'\n", *nextMessage.Body)

		messageBytes := []byte(*nextMessage.Body)
		var message InitializationMessage
		err := json.Unmarshal(messageBytes, &message)
		if err != nil {
			return fmt.Errorf("failed to unmarshal message: %v", err)
		}

		_, err = SQSClient.DeleteMessage(ctx, &sqs.DeleteMessageInput{
			QueueUrl:      &InitializationSQSURL,
			ReceiptHandle: nextMessage.ReceiptHandle,
		})
		if err != nil {
			return fmt.Errorf("failed to delete message '%s' from '%s': %v", *nextMessage.ReceiptHandle, InitializationSQSURL, err)
		}
	}

	return nil
}

func processTransactions(ctx context.Context, output *sqs.ReceiveMessageOutput) error {
	log.Println("Processing transactions")

	for _, nextMessage := range output.Messages {
		log.Printf("Processing Message '%s'\n", *nextMessage.MessageId)

		_, err := SQSClient.DeleteMessage(ctx, &sqs.DeleteMessageInput{
			QueueUrl:      &TransactionSQSURL,
			ReceiptHandle: nextMessage.ReceiptHandle,
		})
		if err != nil {
			return fmt.Errorf("failed to delete message '%s' from '%s': %v", *nextMessage.ReceiptHandle, InitializationSQSURL, err)
		}
	}

	return nil
}

func SQLStatements(ctx context.Context, event events.SQSEvent) error {
	_ = `
		INSERT INTO ledger (credit_account_num, debit_account_num, amount)
		VALUES ('111', '222', 55.50)
	`

	return nil
}

func databasePinging(ctx context.Context, event json.RawMessage) error {
	log.Println("Hello World from the Lambda!")

	proxyEndpoint := os.Getenv("PROXY_ENDPOINT")
	port := 3306
	databaseName := os.Getenv("DATABASE_NAME")
	databaseUser := os.Getenv("DATABASE_USER")

	if proxyEndpoint == "" || databaseName == "" || databaseUser == "" {
		return fmt.Errorf("missing required environment variables")
	}

	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return fmt.Errorf("failed to load AWS config: %w", err)
	}

	proxyEndpointWithPort := fmt.Sprintf("%s:%d", proxyEndpoint, port)

	token, err := auth.BuildAuthToken(
		ctx,
		proxyEndpointWithPort,
		cfg.Region,
		databaseUser,
		cfg.Credentials)
	if err != nil {
		return fmt.Errorf("failed to generate auth token: %w", err)
	}

	dsn := fmt.Sprintf("%s:%s@tcp(%s)/%s?tls=true&allowCleartextPasswords=true",
		databaseUser, token, proxyEndpointWithPort, databaseName)

	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return fmt.Errorf("failed to open DB connection: %w", err)
	}
	defer db.Close()

	if err := db.PingContext(ctx); err != nil {
		log.Printf("Ping failed. Error type: %T", err)
		log.Printf("Ping error: %+v", err) // %+v often gives more context
		log.Printf("Ping error string: %s", err.Error())

		// Optional: unwrap for wrapped errors
		if unwrapped := errors.Unwrap(err); unwrapped != nil {
			log.Printf("Unwrapped error: %+v", unwrapped)
		}

		return fmt.Errorf("failed to ping RDS Proxy: %w", err)
	}

	tableStatement := ""

	_, err = db.Exec(tableStatement)
	if err != nil {
		return fmt.Errorf("failed to create ledger table: %w", err)
	}

	return nil
}
