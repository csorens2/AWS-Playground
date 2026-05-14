import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as events from 'aws-cdk-lib/aws-events';
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as targets from 'aws-cdk-lib/aws-events-targets';
import {Duration} from "aws-cdk-lib/core";

export class BankingAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const transactionBus = new events.EventBus(this, 'TransactionBus', {
      eventBusName: 'Transaction-Bus',
    });

    const generatorFunction = new lambda.DockerImageFunction(this, 'TransactionGenerator', {
      functionName: 'TransactionGenerator',
      code: lambda.DockerImageCode.fromImageAsset('./transaction-generator'),
      environment: {
        EVENTBRIDGE_NAME: transactionBus.eventBusName
      },
      timeout: Duration.minutes(15)
    })
    transactionBus.grantPutEventsTo(generatorFunction)

    const transactionDLQ = new sqs.Queue(this, 'TransactionDLQ', {
      queueName: 'TransactionDLQ',
    })
    const transactionSQS = new sqs.Queue(this, 'TransactionQueue', {
      fifo: true,
      queueName: 'TransactionQueue',
      visibilityTimeout: Duration.minutes(5),
      deadLetterQueue: {
        queue: transactionDLQ,
        maxReceiveCount: 3
      }
    })

    const eventToSQSRule = new events.Rule(this, 'eventToSQSRule', {
      eventBus: transactionBus,
      description: 'Send all messages to the SQS',
      eventPattern: {
        source: [{prefix: ''}] as any[]
      },
    })
    eventToSQSRule.addTarget(new targets.SqsQueue(transactionSQS))
  }
}
