package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"strconv"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/aws/aws-sdk-go-v2/service/sqs/types"

	"github.com/aws/aws-sdk-go-v2/feature/rds/auth"
	_ "github.com/go-sql-driver/mysql" // MySQL driver
)

type InitializationMessage struct {
	AccountNumber string `json:"AccountNumber"`
	Amount        int    `json:"Amount"`
}

type TransactionMessage struct {
	DebitAccountNumber  string `json:"DebitAccountNumber"`
	CreditAccountNumber string `json:"CreditAccountNumber"`
	Amount              int    `json:"Amount"`
}

type SQSMessage struct {
	DetailType string `json:"detail-type"`
	Detail     string `json:"detail"`
}

var (
	initialization_queue_URL *string
	transaction_queue_URL    *string

	SQSClient *sqs.Client
)

func getSQSURL(envVarName string) *string {
	envVarValue, exists := os.LookupEnv(envVarName)
	if !exists {
		log.Fatalf("'%s' not set", envVarName)
	}

	result, err := SQSClient.GetQueueUrl(context.TODO(), &sqs.GetQueueUrlInput{
		QueueName: aws.String(envVarValue),
	})
	if err != nil {
		log.Fatalf("unable to get queue URL: %v", err)
	}

	return result.QueueUrl
}

func init() {
	/*
		cfg, err := config.LoadDefaultConfig(context.TODO())
		if err != nil {
			log.Fatalf("unable to load SDK config: %v", err)
		}

		SQSClient = sqs.NewFromConfig(cfg)

		initialization_queue_URL = getSQSURL("INITIALIZATION_SQS_NAME")
		transaction_queue_URL = getSQSURL("TRANSACTION_SQS_NAME")
	*/
}

func handleInitialization(ctx context.Context, message SQSMessage) error {
	return nil
}

func handleTransaction(ctx context.Context, message SQSMessage) error {

	// Check if the initialization queue has any messages first
	result, err := SQSClient.GetQueueAttributes(ctx, &sqs.GetQueueAttributesInput{
		QueueUrl: initialization_queue_URL,
		AttributeNames: []types.QueueAttributeName{
			types.QueueAttributeNameApproximateNumberOfMessages,
		},
	})

	numMessagesStr := result.Attributes[string(types.QueueAttributeNameApproximateNumberOfMessages)]
	if numMessagesStr == "" {
		log.Fatal("Unable to get number of messages on initialization queue")
	}

	numMessages, err := strconv.Atoi(numMessagesStr)
	if err != nil {
		log.Fatalf("unable to parse num messages: '%s'", numMessagesStr)
	}

	if numMessages > 0 {
		return fmt.Errorf("returning message to queue. '%d' messages on initialization queue take priority", numMessages)
	}

	return nil
}

func handler(ctx context.Context, event events.SQSEvent) error {
	initializationDetailType := "Initialization Event"
	transactionDetailType := "Transaction Event"

	// We only process 1 message at a time
	sqsRecord := event.Records[0]

	var message SQSMessage
	if err := json.Unmarshal([]byte(sqsRecord.Body), &message); err != nil {
		log.Fatalf("unable to unmarshal SQS message body: %v", err)
	}

	if message.DetailType == initializationDetailType {
		return handleInitialization(ctx, message)
	} else if message.DetailType == transactionDetailType {
		return handleTransaction(ctx, message)
	}

	log.Fatalf("Unknown message detail '%s'", message.DetailType)

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

	dbEndpoint := fmt.Sprintf("%s:%d", proxyEndpoint, port)

	token, err := auth.BuildAuthToken(
		ctx,
		dbEndpoint,
		cfg.Region,
		databaseUser,
		cfg.Credentials)
	if err != nil {
		return fmt.Errorf("failed to generate auth token: %w", err)
	}

	dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?tls=true&allowCleartextPasswords=true",
		databaseUser, token, proxyEndpoint, port, databaseName)

	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return fmt.Errorf("failed to open DB connection: %w", err)
	}
	defer db.Close()

	conn, err := net.DialTimeout("tcp", proxyEndpoint+":3306", 5*time.Second)
	if err != nil {
		log.Printf("TCP dial test failed: %v", err)
	}
	if conn != nil {
		conn.Close()
		log.Println("TCP dial to proxy:3306 succeeded")
	}

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

	return nil
}

func main() {
	lambda.Start(testingHandler)
}
