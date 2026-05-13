import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions'
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources'

export class HelloWorldCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const snsTopic = new sns.Topic(this, "SNS", {
      fifo: true,
    });

    const mySQS = new sqs.Queue(this, "mySQS", {
      fifo: true,
    });
    snsTopic.addSubscription(new sns_subscriptions.SqsSubscription(mySQS, {
      rawMessageDelivery: true
    }));

    const myFunction = new lambda.DockerImageFunction(this, 'MyDockerLambda', {
      code: lambda.DockerImageCode.fromImageAsset('./lambda')
    });
    myFunction.addEventSource(new eventsources.SqsEventSource(mySQS, {
      batchSize: 10,
    }));
  }
}
