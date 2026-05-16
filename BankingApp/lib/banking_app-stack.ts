import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as events from 'aws-cdk-lib/aws-events';
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as targets from 'aws-cdk-lib/aws-events-targets';
import {Duration} from "aws-cdk-lib/core";
import {TransactionEventDetailType} from "../shared/transactionEvent";
import {InitializationEventDetailType} from "../shared/initializationEvent";

export class BankingAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const bankEventBus = new events.EventBus(this, 'BankEventBus', {});

    const generatorFunction = new lambda.DockerImageFunction(this, 'BankEventGenerator', {
      code: lambda.DockerImageCode.fromImageAsset('./bank-event-generator'),
      environment: {
        EVENTBRIDGE_NAME: bankEventBus.eventBusName
      },
      timeout: Duration.minutes(15)
    })
    bankEventBus.grantPutEventsTo(generatorFunction)

    const eventDLQ = new sqs.Queue(this, 'EventDLQ', {})
    const transactionSQS = new sqs.Queue(this, 'TransactionQueue', {
      fifo: true,
      visibilityTimeout: Duration.minutes(5),
      deadLetterQueue: {
        queue: eventDLQ,
        maxReceiveCount: 3
      }
    })
    const initializationSQS = new sqs.Queue(this, 'InitializationQueue', {
      fifo: true,
      visibilityTimeout: Duration.minutes(5),
      deadLetterQueue: {
        queue: eventDLQ,
        maxReceiveCount: 3
      }
    })

    const busToInitializationRule = new events.Rule(this, 'BusToInitializationRule', {
      eventBus: bankEventBus,
      eventPattern: {
        detailType: [InitializationEventDetailType]
      }
    });
    busToInitializationRule.addTarget(new targets.SqsQueue(initializationSQS))

    const busToTransactionRule = new events.Rule(this, 'BusToTransactionRule', {
      eventBus: bankEventBus,
      eventPattern: {
        detailType: [TransactionEventDetailType]
      }
    });
    busToTransactionRule.addTarget(new targets.SqsQueue(transactionSQS))
  }
}
