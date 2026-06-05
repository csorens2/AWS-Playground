import * as cdk from 'aws-cdk-lib/core';
import {Construct} from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as lambda from "aws-cdk-lib/aws-lambda";
import {Duration} from "aws-cdk-lib/core";
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';

interface ProcessorProps extends cdk.StackProps {
    TransactionSQS: sqs.Queue
    InitializationSQS: sqs.Queue
}

export class BankingAppProcessorStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: ProcessorProps) {
        super(scope, id, props)

        const mySqlPort = 3306
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

        const bankEventProcessorFunction = new lambda.DockerImageFunction(this, 'BankEventProcessor', {
            vpc: processorVPC,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            },
            code: lambda.DockerImageCode.fromImageAsset('./bank-event-processor'),
            environment: {
                INITIALIZATION_SQS_URL: props!.InitializationSQS.queueUrl,
                TRANSACTION_SQS_URL: props!.TransactionSQS.queueUrl,

                PROXY_ENDPOINT: transactionLedgerProxy.endpoint,
                DATABASE_NAME: transactionLedgerDBName,
                DATABASE_USER: transactionLedgerAdminName,
            },
            reservedConcurrentExecutions: 1,
            timeout: Duration.minutes(5),
        })
        transactionLedgerDatabase.connections.allowDefaultPortFrom(ec2.Peer.ipv4("24.148.32.162/32"))

        transactionLedgerDatabase.connections.allowFrom(transactionLedgerProxy, ec2.Port.tcp(mySqlPort))
        transactionLedgerProxy.connections.allowFrom(bankEventProcessorFunction, ec2.Port.tcp(mySqlPort))
        transactionLedgerProxy.grantConnect(bankEventProcessorFunction.role!, transactionLedgerAdminName)

        bankEventProcessorFunction.addEventSource(
            new eventsources.SqsEventSource(props!.InitializationSQS,{
                batchSize: 1,

            })
        )
        bankEventProcessorFunction.addEventSource(
            new eventsources.SqsEventSource(props!.TransactionSQS, {
                batchSize: 1,
            })
        )


        new cdk.CfnOutput(this, 'ClusterEndpoint', {
            value: transactionLedgerDatabase.clusterEndpoint.hostname,
            description: 'Aurora Cluster Endpoint (use this as host)',
        });

        new cdk.CfnOutput(this, 'Port', {
            value: transactionLedgerDatabase.clusterEndpoint.port.toString(),
            description: 'Database port (3306 for MySQL)',
        });

    }


}
