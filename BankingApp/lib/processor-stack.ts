import * as cdk from 'aws-cdk-lib/core';
import {Construct} from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as lambda from "aws-cdk-lib/aws-lambda";
import {Duration} from "aws-cdk-lib/core";
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';

interface ProcessorProps extends cdk.StackProps {
    BankEventSQS: sqs.Queue
    ProcessorTimeout: Duration
}

export class BankingAppProcessorStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: ProcessorProps) {
        super(scope, id, props)

        const ledgerDBName = 'ledger'
        const ledgerTableName = 'ledger'
        const ledgerAdminName = 'admin' // DO NOT TOUCH

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

        const ledgerDatabase = new rds.DatabaseInstance(this, 'Ledger', {
            engine: rds.DatabaseInstanceEngine.mysql({
                version: rds.MysqlEngineVersion.VER_8_4_8
            }),
            vpc: processorVPC,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PUBLIC // TODO: Change to Isolated
            },
            credentials: rds.Credentials.fromUsername(ledgerAdminName), // DO NOT TOUCH
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            databaseName: ledgerDBName
        })

        const accountStatusDatabase = new dynamodb.TableV2(this, 'AccountStatus', {
            partitionKey: { name: 'account_number', type: dynamodb.AttributeType.STRING },
            tableName: 'AccountStatus',
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
                BANK_EVENT_SQS_URL: props.BankEventSQS.queueUrl,

                ACCOUNT_STATUS_TABLE_NAME: accountStatusDatabase.tableName,

                LEDGER_DATABASE_SECRET_NAME: ledgerDatabase.secret!.secretName,
                LEDGER_DATABASE_HOSTNAME: ledgerDatabase.instanceEndpoint.hostname,
                LEDGER_DATABASE_PORT: ledgerDatabase.instanceEndpoint.port.toString(),
                LEDGER_DATABASE_NAME: ledgerDBName,
                LEDGER_TABLE_NAME: ledgerTableName,
            },
            timeout: props.ProcessorTimeout
        })

        ledgerDatabase.secret!.grantRead(bankEventProcessorFunction.role!)
        ledgerDatabase.connections.allowFrom(bankEventProcessorFunction, ec2.Port.tcp(ledgerDatabase.instanceEndpoint.port))
        ledgerDatabase.connections.allowDefaultPortFrom(ec2.Peer.ipv4("24.148.32.162/32")) // TODO: Remove me
        accountStatusDatabase.grantReadWriteData(bankEventProcessorFunction)

        props.BankEventSQS.grantConsumeMessages(bankEventProcessorFunction) // TODO: Need?

        bankEventProcessorFunction.addEventSource(new eventsources.SqsEventSource(props.BankEventSQS, {
            batchSize: 10,
            reportBatchItemFailures: true,
        }));
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
