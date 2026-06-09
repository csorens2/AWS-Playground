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
}

export class BankingAppProcessorStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: ProcessorProps) {
        super(scope, id, props)

        const transactionLedgerDBName = 'transactions'
        const transactionLedgerAdminName = 'admin' // DO NOT TOUCH

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
                INITIALIZATION_SQS_URL: props!.InitializationSQS.queueUrl,
                TRANSACTION_SQS_URL: props!.TransactionSQS.queueUrl,

                LEDGER_HOSTNAME: transactionLedgerDatabase.instanceEndpoint.hostname,
                DATABASE_NAME: transactionLedgerDBName,
                DATABASE_USER: transactionLedgerAdminName,

                ACCOUNT_STATUS_TABLE_NAME: accountStatusDatabase.tableName
            },
            timeout: Duration.minutes(5),

        })

        const databaseSetupFunction = new lambda.DockerImageFunction(this, 'DatabaseSetup', {
            vpc: processorVPC,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            },
            code: lambda.DockerImageCode.fromImageAsset('./database-setup'),
            environment: {
                DATABASE_SECRET_NAME: transactionLedgerDatabase.secret!.secretName,
            },
            timeout: Duration.minutes(5),
        })
        transactionLedgerDatabase.secret!.grantRead(databaseSetupFunction.role!)

        transactionLedgerDatabase.connections.allowDefaultPortFrom(ec2.Peer.ipv4("24.148.32.162/32"))
        transactionLedgerDatabase.grantConnect(bankEventProcessorFunction.role!, transactionLedgerAdminName)

        const processorTarget = new targets.LambdaInvoke(bankEventProcessorFunction, {
            retryAttempts: 3,
        })

        new scheduler.Schedule(this, 'ProcessorSchedule', {
            schedule: scheduler.ScheduleExpression.rate(cdk.Duration.hours(1)),
            target: processorTarget
        })

        props!.TransactionSQS!.grantConsumeMessages(bankEventProcessorFunction)
        props!.InitializationSQS.grantConsumeMessages(bankEventProcessorFunction)

        accountStatusDatabase.grantReadWriteData(bankEventProcessorFunction)


        new cdk.CfnOutput(this, 'ClusterEndpoint', {
            value: transactionLedgerDatabase.instanceEndpoint.hostname,
            description: 'Aurora Cluster Endpoint (use this as host)',
        });

        new cdk.CfnOutput(this, 'Port', {
            value: transactionLedgerDatabase.instanceEndpoint.port.toString(),
            description: 'Database port (3306 for MySQL)',
        });

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
