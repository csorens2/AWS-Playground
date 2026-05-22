package main

import (
	"context"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
)

var initialization_queue_arn
var transaction_queue_arn

func init() {

}

func handler(ctx context.Context, event events.SQSEvent) error {
	event.Records[0].

	return nil
}

func main() {
	lambda.Start(handler)
}
