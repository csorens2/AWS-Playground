import * as cdk from 'aws-cdk-lib/core';
import {Duration} from 'aws-cdk-lib/core';
import {Construct} from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as events from 'aws-cdk-lib/aws-events';
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import {AttributeType} from 'aws-cdk-lib/aws-dynamodb';
import * as rds from 'aws-cdk-lib/aws-rds';

export class BankingAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

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
      timeout: Duration.minutes(15)
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

    const processorVPC = new ec2.Vpc(this, 'ProcessorVPC', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 3,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
        }
      ]
    })

    const bankEventProcessorFunction = new lambda.DockerImageFunction(this, 'BankEventProcessor', {
      vpc: processorVPC,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      code: lambda.DockerImageCode.fromImageAsset('./bank-event-processor'),
      environment: {
        INITIALIZATION_SQS_NAME: initializationSQS.queueName,
        TRANSACTION_SQS_NAME: transactionSQS.queueName
      },
      reservedConcurrentExecutions: 1,
      timeout: Duration.minutes(15)
    })

    bankEventProcessorFunction.addEventSource(new lambdaEventSources.SqsEventSource(initializationSQS, {
      batchSize: 1,
    }))
    bankEventProcessorFunction.addEventSource(new lambdaEventSources.SqsEventSource(transactionSQS, {
      batchSize: 1,
    }))
    //initializationSQS.grantConsumeMessages(bankEventProcessorFunction)
    //transactionSQS.grantConsumeMessages(bankEventProcessorFunction)


    const transactionLedgerDatabase = new rds.DatabaseCluster(this, 'MyAuroraCluster', {
      engine: rds.DatabaseClusterEngine.auroraMysql({
        version: rds.AuroraMysqlEngineVersion.VER_3_12_0,
      }),
      vpc: processorVPC,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      credentials: rds.Credentials.fromGeneratedSecret('TransactionLedgerAdminUser'),
      defaultDatabaseName: 'Transactions',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    transactionLedgerDatabase.connections.allowFrom(bankEventProcessorFunction, ec2.Port.tcp(3306))


    const accountStateTable = new dynamodb.Table(this, 'MyDynamoTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // for dev only
    });

    processorVPC.addGatewayEndpoint('AccountStateEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    });

    accountStateTable.grantReadWriteData(bankEventProcessorFunction);

  }
}
