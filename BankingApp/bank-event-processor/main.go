package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
	_ "github.com/aws/aws-sdk-go-v2/service/sqs"
	_ "github.com/go-sql-driver/mysql"
)

type DepositMessageBody struct {
	AccountNumber string  `json:"AccountNumber"`
	Amount        float64 `json:"Amount"`
}

type WithdrawalMessageBody struct {
	AccountNumber string  `json:"AccountNumber"`
	Amount        float64 `json:"Amount"`
}

type AccountStatusEntry struct {
	AccountNumber string  `dynamodbav:"account_number"`
	Amount        float64 `dynamodbav:"amount"`
}

const (
	AccountStatusAccountNumberField = "account_number"
	AccountStatusAmountField        = "amount"
)

var (
	AccountStatusTableName     string
	TransactionLedgerTableName string

	TransactionLedgerClient *sql.DB
	AccountStatusClient     *dynamodb.Client
)

const (
	AccountStatusTableNameEnvVar = "ACCOUNT_STATUS_TABLE_NAME"

	LedgerDatabaseSecretNameEnvVar = "LEDGER_DATABASE_SECRET_NAME"
	LedgerDatabaseHostnameEnvVar   = "LEDGER_DATABASE_HOSTNAME"
	LedgerDatabasePortEnvVar       = "LEDGER_DATABASE_PORT"
	LedgerDatabaseNameEnvVar       = "LEDGER_DATABASE_NAME"
	LedgerTableNameEnvVar          = "LEDGER_TABLE_NAME"
)

const (
	EventTypeAttribute       = "EventType"
	DepositEventTypeValue    = "Deposit"
	WithdrawalEventTypeValue = "Withdrawal"
)

const (
	EmptyAccountNumber = "0000000000"
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
	lambda.Start(ESMHandler)
}

func ESMHandler(ctx context.Context, event events.SQSEvent) (map[string]interface{}, error) {
	log.Println("Hello from ESM Handler")

	err := setupLedger()
	if err != nil {
		return nil, fmt.Errorf("failed to setup ledger database: %w", err)
	}

	var batchItemFailures []map[string]interface{}
	addToBIF := func(messageId string) {
		batchItemFailures = append(batchItemFailures, map[string]interface{}{
			"itemIdentifier": messageId,
		})
	}

	for _, event := range event.Records {
		log.Printf("Processing message '%s'\n", event.MessageId)

		eventType := event.MessageAttributes[EventTypeAttribute].StringValue
		if *eventType == DepositEventTypeValue {
			err := handleDeposit(ctx, event)
			if err != nil {
				log.Printf("failed to handle deposit: %v", err)
				addToBIF(event.MessageId)
			}
		} else if *eventType == WithdrawalEventTypeValue {
			err := handleWithdrawal(ctx, event)
			if err != nil {
				log.Printf("failed to handle withdrawal: %v", err)
				addToBIF(event.MessageId)
			}
		} else {
			log.Printf("unknown EventType '%s'", *eventType)
			addToBIF(event.MessageId)
		}

		log.Println("Finished processing message")
	}

	sqsBatchResponse := map[string]interface{}{
		"batchItemFailures": batchItemFailures,
	}
	return sqsBatchResponse, nil
}

func handleDeposit(ctx context.Context, message events.SQSMessage) error {

	var depositBody DepositMessageBody
	err := json.Unmarshal([]byte(message.Body), &depositBody)
	if err != nil {
		return fmt.Errorf("failed to unmarshal deposit message body: %w", err)
	}

	log.Printf("Handling deposit for: '%s' Amount: %f \n", depositBody.AccountNumber, depositBody.Amount)

	key := map[string]types.AttributeValue{
		AccountStatusAccountNumberField: &types.AttributeValueMemberS{Value: depositBody.AccountNumber},
	}

	input := &dynamodb.GetItemInput{
		TableName:            &AccountStatusTableName,
		Key:                  key,
		ProjectionExpression: aws.String(AccountStatusAmountField),
	}

	resp, err := AccountStatusClient.GetItem(ctx, input)
	if err != nil {
		return fmt.Errorf("unable to check if account status table already has an account: %w", err)
	}

	if len(resp.Item) > 0 {
		return fmt.Errorf("failed to process deposit: account '%s' already exists", depositBody.AccountNumber)
	}

	item, err := attributevalue.MarshalMap(AccountStatusEntry{AccountNumber: depositBody.AccountNumber, Amount: depositBody.Amount})
	if err != nil {
		return fmt.Errorf("failed to marshal item map: %w", err)
	}

	_, err = AccountStatusClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &AccountStatusTableName,
		Item:      item,
	})

	if err != nil {
		return fmt.Errorf("failed to put account status entry in table: %w", err)
	}

	// And the entry to the ledger
	var ledgerStatementBuilder strings.Builder
	ledgerStatementBuilder.WriteString(fmt.Sprintf("INSERT INTO %s (credit_account, debit_account, amount) ", TransactionLedgerTableName))
	ledgerStatementBuilder.WriteString(fmt.Sprintf("VALUES ('%s', '%s', %f)", depositBody.AccountNumber, EmptyAccountNumber, depositBody.Amount))

	_, err = TransactionLedgerClient.Exec(ledgerStatementBuilder.String())
	if err != nil {
		return fmt.Errorf("failed to add deposit to ledger: %w", err)
	}

	return nil
}

func handleWithdrawal(ctx context.Context, message events.SQSMessage) error {
	var withdrawalBody WithdrawalMessageBody
	err := json.Unmarshal([]byte(message.Body), &withdrawalBody)
	if err != nil {
		return fmt.Errorf("failed to unmarshal withdrawal message body: %w", err)
	}

	log.Printf("Handling withdrawal for: '%s' Amount: %f \n", withdrawalBody.AccountNumber, withdrawalBody.Amount)

	key := map[string]types.AttributeValue{
		AccountStatusAccountNumberField: &types.AttributeValueMemberS{Value: withdrawalBody.AccountNumber},
	}

	input := &dynamodb.GetItemInput{
		TableName:            &AccountStatusTableName,
		Key:                  key,
		ProjectionExpression: aws.String(AccountStatusAmountField),
	}

	resp, err := AccountStatusClient.GetItem(ctx, input)
	if err != nil {
		return fmt.Errorf("unable to check if account status table already has an account: %w", err)
	}

	if len(resp.Item) == 0 {
		return fmt.Errorf("failed to process withdrawal: account '%s' does not exist", withdrawalBody.AccountNumber)
	}

	var accountStatusEntry AccountStatusEntry
	err = attributevalue.UnmarshalMap(resp.Item, &accountStatusEntry)
	if err != nil {
		return fmt.Errorf("failed to unmarshal account status: %w", err)
	}

	if withdrawalBody.Amount > accountStatusEntry.Amount {
		return fmt.Errorf("failed to withdraw '%f' from account '%s' with funds '%f': insufficient funds",
			withdrawalBody.Amount,
			accountStatusEntry.AccountNumber,
			accountStatusEntry.Amount)
	}

	newAmount := accountStatusEntry.Amount - withdrawalBody.Amount
	item, err := attributevalue.MarshalMap(AccountStatusEntry{AccountNumber: withdrawalBody.AccountNumber, Amount: newAmount})
	if err != nil {
		return fmt.Errorf("failed to marshal item map: %w", err)
	}

	_, err = AccountStatusClient.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &AccountStatusTableName,
		Item:      item,
	})

	if err != nil {
		return fmt.Errorf("failed to put account status entry in table: %w", err)
	}

	var ledgerStatementBuilder strings.Builder
	ledgerStatementBuilder.WriteString(fmt.Sprintf("INSERT INTO %s (credit_account, debit_account, amount) ", TransactionLedgerTableName))
	ledgerStatementBuilder.WriteString(fmt.Sprintf("VALUES ('%s', '%s', %f)", EmptyAccountNumber, withdrawalBody.AccountNumber, withdrawalBody.Amount))

	_, err = TransactionLedgerClient.Exec(ledgerStatementBuilder.String())
	if err != nil {
		return fmt.Errorf("failed to add withdrawal to ledger: %w", err)
	}

	return nil
}

func setupLedger() error {
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
