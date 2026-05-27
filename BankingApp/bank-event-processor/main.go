package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strconv"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/aws/aws-sdk-go-v2/service/sqs/types"
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
	return nil
}

func main() {
	lambda.Start(handler)
}
