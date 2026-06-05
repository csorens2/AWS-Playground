import * as cdk from 'aws-cdk-lib/core';
import {Construct} from "constructs";
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as events from "aws-cdk-lib/aws-events";
import * as lambda from "aws-cdk-lib/aws-lambda";
import {Duration} from "aws-cdk-lib/core";
import * as targets from "aws-cdk-lib/aws-events-targets";

export class BankingAppGeneratorStack extends cdk.Stack {

    public TransactionSQS: sqs.Queue
    public InitializationSQS: sqs.Queue

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props)

        const transactionEventDetailType = "Transaction Event"
        const initializationEventDetailType = "Initialization Event"

        const eventBusDLQ = new sqs.Queue(this, 'EventBusDLQ', {})
        const bankEventBus = new events.EventBus(this, 'BankEventBus', {
            deadLetterQueue: eventBusDLQ
        });

        const generatorFunction = new lambda.DockerImageFunction(this, 'BankEventGenerator', {
            code: lambda.DockerImageCode.fromImageAsset('./bank-event-generator'),
            environment: {
                INITIALIZATION_EVENT_DETAIL_TYPE: initializationEventDetailType,
                TRANSACTION_EVENT_DETAIL_TYPE: transactionEventDetailType,
                EVENTBRIDGE_NAME: bankEventBus.eventBusName
            },
            timeout: Duration.minutes(5)
        })
        bankEventBus.grantPutEventsTo(generatorFunction)

        const eventDLQ = new sqs.Queue(this, 'EventDLQ', {
            fifo: true
        })

        const transactionSQS = new sqs.Queue(this, 'TransactionQueue', {
            contentBasedDeduplication: true,
            fifo: true,
            visibilityTimeout: Duration.minutes(5),
            deadLetterQueue: {
                queue: eventDLQ,
                maxReceiveCount: 3
            }
        })
        const initializationSQS = new sqs.Queue(this, 'InitializationQueue', {
            contentBasedDeduplication: true,
            fifo: true,
            visibilityTimeout: Duration.minutes(5),
            deadLetterQueue: {
                queue: eventDLQ,
                maxReceiveCount: 3
            }
        })
        this.TransactionSQS= transactionSQS
        this.InitializationSQS = initializationSQS

        const busToInitializationRule = new events.Rule(this, 'BusToInitializationRule', {
            eventBus: bankEventBus,
            eventPattern: {
                detailType: [initializationEventDetailType]
            }
        });
        busToInitializationRule.addTarget(new targets.SqsQueue(initializationSQS, {
            deadLetterQueue: eventBusDLQ,
            messageGroupId: bankEventBus.eventBusName,
            retryAttempts: 0
        }))

        const busToTransactionRule = new events.Rule(this, 'BusToTransactionRule', {
            eventBus: bankEventBus,
            eventPattern: {
                detailType: [transactionEventDetailType]
            }
        });
        busToTransactionRule.addTarget(new targets.SqsQueue(transactionSQS, {
            deadLetterQueue: eventBusDLQ,
            retryAttempts: 0,
            messageGroupId: bankEventBus.eventBusName
        }))

    }
}