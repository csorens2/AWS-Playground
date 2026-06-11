import * as cdk from 'aws-cdk-lib/core';
import {Construct} from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as lambda from "aws-cdk-lib/aws-lambda";
import {Duration} from "aws-cdk-lib/core";
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as targets from 'aws-cdk-lib/aws-scheduler-targets'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

interface ProcessorProps extends cdk.StackProps {
    TransactionSQS: sqs.Queue
    InitializationSQS: sqs.Queue
    ProcessorCadence: Duration
    ProcessorTimeout: Duration
}

export class BankingAppProcessorStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: ProcessorProps) {
        super(scope, id, props)

        const transactionLedgerDBName = 'transactions'
        const transactionLedgerAdminName = 'admin' // DO NOT TOUCH
        const transactionLedgerTableName = 'ledger'

        const processorVPC = new ec2.Vpc(this, 'ProcessorVPC', {
            subnetConfiguration: [
                {
                    name: 'Public',
                    subnetType: ec2.SubnetType.PUBLIC
                },
                {
                    name: 'Private',
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
                },
                {
                    name: 'Isolated',
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED
                }
            ]
        })

        const transactionLedgerDatabase = new rds.DatabaseInstance(this, 'TransactionLedger', {
            engine: rds.DatabaseInstanceEngine.mysql({
                version: rds.MysqlEngineVersion.VER_8_4_8
            }),
            vpc: processorVPC,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PUBLIC // TODO: Change to Isolated
            },
            credentials: rds.Credentials.fromUsername(transactionLedgerAdminName), // DO NOT TOUCH
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            databaseName: transactionLedgerDBName
        })

        const accountStatusDatabase = new dynamodb.TableV2(this, 'AccountStatus', {
            partitionKey: { name: 'account', type: dynamodb.AttributeType.STRING },
            tableName: 'account-status',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        })

        const accountStatusGatewayEndpoint = processorVPC.addGatewayEndpoint('AccountStatusGatewayEndpoint', {
            service: ec2.GatewayVpcEndpointAwsService.DYNAMODB
        })

        const bankEventProcessorFunction = new lambda.DockerImageFunction(this, 'BankEventProcessor', {
            vpc: processorVPC,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            },
            code: lambda.DockerImageCode.fromImageAsset('./bank-event-processor'),
            environment: {
                TRANSACTION_SQS_URL: props.TransactionSQS.queueUrl,
                INITIALIZATION_SQS_URL: props.InitializationSQS.queueUrl,
                ACCOUNT_STATUS_TABLE_NAME: accountStatusDatabase.tableName,

                LEDGER_DATABASE_SECRET_NAME: transactionLedgerDatabase.secret!.secretName,
                LEDGER_DATABASE_HOSTNAME: transactionLedgerDatabase.instanceEndpoint.hostname,
                LEDGER_DATABASE_PORT: transactionLedgerDatabase.instanceEndpoint.port.toString(),
                LEDGER_DATABASE_NAME: transactionLedgerDBName,
                LEDGER_TABLE_NAME: transactionLedgerTableName,
            },
            timeout: props.ProcessorTimeout,
        })

        transactionLedgerDatabase.secret!.grantRead(bankEventProcessorFunction.role!)
        transactionLedgerDatabase.connections.allowFrom(bankEventProcessorFunction, ec2.Port.tcp(transactionLedgerDatabase.instanceEndpoint.port))
        transactionLedgerDatabase.connections.allowDefaultPortFrom(ec2.Peer.ipv4("24.148.32.162/32")) // TODO: Remove me
        accountStatusDatabase.grantReadWriteData(bankEventProcessorFunction)

        props.TransactionSQS.grantConsumeMessages(bankEventProcessorFunction)
        props.InitializationSQS.grantConsumeMessages(bankEventProcessorFunction)

        /*
        const processorTarget = new targets.LambdaInvoke(bankEventProcessorFunction, {
            retryAttempts: 3,
        })

        new scheduler.Schedule(this, 'ProcessorSchedule', {
            schedule: scheduler.ScheduleExpression.rate(props.ProcessorCadence),
            target: processorTarget
        })
         */
    }
}

/*
    const mySqlPort = 3306
    const transactionLedgerDatabase = new rds.DatabaseCluster(this, 'TransactionLedger', {
        engine: rds.DatabaseClusterEngine.auroraMysql({
            version: rds.AuroraMysqlEngineVersion.VER_3_12_0,
        }),
        vpc: processorVPC,
        vpcSubnets: {
            subnetType: ec2.SubnetType.PUBLIC // TODO: Switch to Isolated when development is done
        },
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        writer: rds.ClusterInstance.serverlessV2('writer'),
        readers: [rds.ClusterInstance.serverlessV2('reader', {
            scaleWithWriter: true
        })],

        defaultDatabaseName: transactionLedgerDBName,
        credentials: rds.Credentials.fromUsername(transactionLedgerAdminName), // DO NOT TOUCH
        cloudwatchLogsExports: [ "general"],
    });

    const transactionLedgerProxy = new rds.DatabaseProxy(this, 'TransactionLedgerProxy', {
        proxyTarget: rds.ProxyTarget.fromCluster(transactionLedgerDatabase),
        vpc: processorVPC,
        vpcSubnets: {
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
        },
        iamAuth: true,
        secrets: [transactionLedgerDatabase.secret!], // DO NOT TOUCH
        clientPasswordAuthType: rds.ClientPasswordAuthType.MYSQL_NATIVE_PASSWORD,
        debugLogging: true,
    })

    transactionLedgerDatabase.connections.allowFrom(transactionLedgerProxy, ec2.Port.tcp(mySqlPort))
    transactionLedgerProxy.connections.allowFrom(bankEventProcessorFunction, ec2.Port.tcp(mySqlPort))
    transactionLedgerProxy.grantConnect(bankEventProcessorFunction.role!, transactionLedgerAdminName)
 */
