import * as cdk from 'aws-cdk-lib/core';
import {Construct} from "constructs";
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as lambda from "aws-cdk-lib/aws-lambda";
import {Duration} from "aws-cdk-lib/core";

interface GeneratorProps extends cdk.StackProps {
    BankEventSQSTimeout: Duration
}

export class BankingAppGeneratorStack extends cdk.Stack {

    public BankEventSQS: sqs.Queue

    constructor(scope: Construct, id: string, props: GeneratorProps) {
        super(scope, id, props)

        const bankEventDLQ = new sqs.Queue(this, 'BankEventDLQ', {
            fifo: true
        })

        this.BankEventSQS = new sqs.Queue(this, 'BankEventQueue', {
            contentBasedDeduplication: true,
            fifo: true,
            deadLetterQueue: {
                queue: bankEventDLQ,
                maxReceiveCount: 3
            },
            visibilityTimeout: Duration.seconds(props.BankEventSQSTimeout.toSeconds() * 6)
        })

        const generatorFunction = new lambda.DockerImageFunction(this, 'BankEventGenerator', {
            code: lambda.DockerImageCode.fromImageAsset('./bank-event-generator'),
            environment: {
                BANK_EVENT_SQS_URL: this.BankEventSQS.queueUrl
            },
            timeout: Duration.minutes(5),
        })
        this.BankEventSQS.grantSendMessages(generatorFunction.role!)
    }
}