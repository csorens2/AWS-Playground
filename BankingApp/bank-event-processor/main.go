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
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/aws/aws-sdk-go-v2/service/sqs/types"
	_ "github.com/go-sql-driver/mysql"
)

type ServerInfo struct {
	Version   string `json:"version"`
	Hostname  string `json:"hostname"`
	CurrentDB string `json:"currentDb"`
}

var (
	TransactionSQSURL    string
	InitializationSQSURL string

	SQSClient *sqs.Client
)

const (
	TransactionSQSURLEnvVar    = "TRANSACTION_SQS_URL"
	InitializationSQSURLEnvVar = "INITIALIZATION_SQS_URL"
)

func init() {
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		log.Fatalf("unable to load SDK config: %v", err)
	}

	loadEnvVars()
	SQSClient = sqs.NewFromConfig(cfg)
}

func loadEnvVars() {
	var success bool

	TransactionSQSURL, success = os.LookupEnv(TransactionSQSURLEnvVar)
	if !success {
		log.Fatalf("env var %s not set", TransactionSQSURLEnvVar)
	}

	InitializationSQSURL, success = os.LookupEnv(InitializationSQSURLEnvVar)
	if !success {
		log.Fatalf("env var %s not set", InitializationSQSURLEnvVar)
	}

	log.Println(TransactionSQSURL)
	log.Println(InitializationSQSURL)
}

func handler(ctx context.Context, event events.SQSEvent) error {

	_ = `
		CREATE TABLE IF NOT EXISTS ledger(
			timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			credit_account VARCHAR(20) NOT NULL,
			debit_account VARCHAR(20) NOT NULL,
			amount DECIMAL(20,2) NOT NULL
		)
	`
	_ = `
		INSERT INTO ledger (credit_account, debit_account, amount)
		VALUES ('111', '222', 55.50)
	`

	return nil
}

func testingSQS(ctx context.Context, event json.RawMessage) error {

	input := &sqs.GetQueueAttributesInput{
		QueueUrl: &TransactionSQSURL,
		AttributeNames: []types.QueueAttributeName{
			types.QueueAttributeNameApproximateNumberOfMessages,
		},
	}

	result, err := SQSClient.GetQueueAttributes(ctx, input)
	if err != nil {
		log.Printf("Failed to get queue attributes: %v", err)
		return nil
	}

	log.Printf("ApproximateNumberOfMessages: %s\n", result.Attributes[string(types.QueueAttributeNameApproximateNumberOfMessages)])

	return nil
}

func testingHandler(ctx context.Context, event json.RawMessage) error {
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

	//result.RowsAffected()

	return nil
}

func main() {
	lambda.Start(testingSQS)
}
