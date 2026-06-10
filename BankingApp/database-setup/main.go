package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
	_ "github.com/go-sql-driver/mysql"
)

const (
	SecretNameEnvVar       = "DATABASE_SECRET_NAME"
	EndpointHostnameEnvVar = "DATABASE_ENDPOINT_HOSTNAME"
	EndpointPortEnvVar     = "DATABASE_ENDPOINT_PORT"
	DatabaseNameEnvVar     = "DATABASE_NAME"
	LedgerTableNameEnvVar  = "LEDGER_TABLE_NAME"
)

func main() {
	lambda.Start(handler)
}

func handler(ctx context.Context) error {
	username, password, err := getDBUsernameAndPassword(ctx)
	if err != nil {
		return err
	}

	notSetError := "environment variable '%s' not set"
	hostname, exists := os.LookupEnv(EndpointHostnameEnvVar)
	if !exists {
		return fmt.Errorf(notSetError, EndpointHostnameEnvVar)
	}
	port, exists := os.LookupEnv(EndpointPortEnvVar)
	if !exists {
		return fmt.Errorf(notSetError, EndpointPortEnvVar)
	}
	databaseName, exists := os.LookupEnv(DatabaseNameEnvVar)
	if !exists {
		return fmt.Errorf(notSetError, DatabaseNameEnvVar)
	}
	ledgerTableName, exists := os.LookupEnv(LedgerTableNameEnvVar)
	if !exists {
		return fmt.Errorf(notSetError, LedgerTableNameEnvVar)
	}

	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?allowCleartextPasswords=true",
		*username, *password, hostname, port, databaseName)

	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return fmt.Errorf("failed to open database connection: %w", err)
	}
	defer db.Close()

	var statementBuilder strings.Builder
	statementBuilder.WriteString(fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s(", ledgerTableName))
	statementBuilder.WriteString("timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,")
	statementBuilder.WriteString("credit_account VARCHAR(20) NOT NULL,")
	statementBuilder.WriteString("debit_account VARCHAR(20),")
	statementBuilder.WriteString("amount DECIMAL(20,2) NOT NULL")
	statementBuilder.WriteString(")")

	_, err = db.Exec(statementBuilder.String())
	if err != nil {
		return fmt.Errorf("failed to create ledger table: %w", err)
	}

	log.Println("Successfully Created Table (If not already present)")

	return nil
}

func getDBUsernameAndPassword(ctx context.Context) (*string, *string, error) {
	secretName, exists := os.LookupEnv(SecretNameEnvVar)
	if !exists {
		return nil, nil, fmt.Errorf("environment variable '%s' not set", SecretNameEnvVar)
	}

	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to load AWS config: %w", err)
	}

	secretClient := secretsmanager.NewFromConfig(cfg)

	result, err := secretClient.GetSecretValue(ctx, &secretsmanager.GetSecretValueInput{
		SecretId: &secretName,
	})

	var secretMap map[string]interface{}
	if err := json.Unmarshal([]byte(*result.SecretString), &secretMap); err != nil {
		return nil, nil, fmt.Errorf("failed to unmarshal secret string: %w", err)
	}

	userNameFieldName := "username"
	passwordFieldName := "password"
	failureErrorString := "failed to acquire '%s' from secret string: field not present"

	username, exists := secretMap[userNameFieldName].(string)
	if !exists {
		return nil, nil, fmt.Errorf(failureErrorString, userNameFieldName)
	}

	password, exists := secretMap[passwordFieldName].(string)
	if !exists {
		return nil, nil, fmt.Errorf(failureErrorString, passwordFieldName)
	}

	return &username, &password, nil
}
