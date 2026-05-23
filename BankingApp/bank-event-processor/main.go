package main

import (
	"context"
	"encoding/json"
	"log"
	"os"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
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
	SQSClient                *sqs.Client
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
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		log.Fatalf("unable to load SDK config: %v", err)
	}

	SQSClient = sqs.NewFromConfig(cfg)

	initialization_queue_URL = getSQSURL("INITIALIZATION_SQS_NAME")
	transaction_queue_URL = getSQSURL("TRANSACTION_SQS_NAME")
}

func handleInitialization(ctx context.Context, message SQSMessage) error {
	return nil
}

func handleTransaction(ctx context.Context, message SQSMessage) error {
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

func main() {
	lambda.Start(handler)
}
