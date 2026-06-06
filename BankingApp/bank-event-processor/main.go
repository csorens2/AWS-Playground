package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/rds/auth"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
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
	TransactionSQSURL      string
	InitializationSQSURL   string
	AccountStatusTableName string

	SQSClient *sqs.Client
	DDBClient *dynamodb.Client
)

const (
	TransactionSQSURLEnvVar      = "TRANSACTION_SQS_URL"
	InitializationSQSURLEnvVar   = "INITIALIZATION_SQS_URL"
	AccountStatusTableNameEnvVar = "ACCOUNT_STATUS_TABLE_NAME"
)

func init() {
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		log.Fatalf("unable to load SDK config: %v", err)
	}

	SQSClient = sqs.NewFromConfig(cfg)
	DDBClient = dynamodb.NewFromConfig(cfg)

	var success bool
	TransactionSQSURL, success = os.LookupEnv(TransactionSQSURLEnvVar)
	if !success {
		log.Fatalf("env var %s not set", TransactionSQSURLEnvVar)
	}
	InitializationSQSURL, success = os.LookupEnv(InitializationSQSURLEnvVar)
	if !success {
		log.Fatalf("env var %s not set", InitializationSQSURLEnvVar)
	}
	AccountStatusTableName, success = os.LookupEnv(AccountStatusTableNameEnvVar)
	if !success {
		log.Fatalf("env var %s not set", AccountStatusTableNameEnvVar)
	}
}

func main() {
	lambda.Start(scheduledHandler)
}

func scheduledHandler(ctx context.Context) error {
	log.Println("Hello World from the Lambda!")

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

	/*
		err = pingAccountStatusTable(ctx)
		if err != nil {
			return err
		}

	*/

	return nil
}

func pingAccountStatusTable(ctx context.Context) error {
	log.Println("Attempting DDBTable Connection")

	_, err := DDBClient.DescribeTable(ctx, &dynamodb.DescribeTableInput{
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
		CREATE TABLE IF NOT EXISTS ledger(
			timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			credit_account VARCHAR(20) NOT NULL,
			debit_account VARCHAR(20),
			amount DECIMAL(20,2) NOT NULL
		)
	`
	_ = `
		INSERT INTO ledger (credit_account_num, debit_account_num, amount)
		VALUES ('111', '222', 55.50)
	`

	return nil
}

func proxyTesting(ctx context.Context, event json.RawMessage) error {
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
