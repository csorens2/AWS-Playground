import * as cdk from 'aws-cdk-lib/core';
import {Construct} from "constructs";
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as iam from "aws-cdk-lib/aws-iam";
import {CfnDBProxy, CfnDBProxyTargetGroup} from "aws-cdk-lib/aws-rds";
import * as lambda from "aws-cdk-lib/aws-lambda";
import {Duration} from "aws-cdk-lib/core";

interface ProcessorProps extends cdk.StackProps {
    TransactionSQSName: string
    InitializationSQSName: string
}

export class BankingAppProcessorStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: ProcessorProps) {
        super(scope, id, props)

        const processorVPC = new ec2.Vpc(this, 'ProcessorVPC', {
            //ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
            //maxAzs: 3,
            //natGateways: 1,
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

        const transactionLedgerDBName = 'transactionDB'
        const transactionLedgerCredentialName = 'clusteradmin'
        const transactionLedgerDatabase = new rds.DatabaseCluster(this, 'TransactionLedger', {
            engine: rds.DatabaseClusterEngine.auroraMysql({
                version: rds.AuroraMysqlEngineVersion.VER_3_12_0,
            }),
            vpc: processorVPC,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
            },
            iamAuthentication: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            writer: rds.ClusterInstance.serverlessV2('writer'),
            readers: [rds.ClusterInstance.serverlessV2('reader')],

            defaultDatabaseName: transactionLedgerDBName,
            credentials: rds.Credentials.fromGeneratedSecret(transactionLedgerCredentialName)
        });

        const transactionLedgerProxy = new rds.DatabaseProxy(this, 'TransactionLedgerProxy', {
            proxyTarget: rds.ProxyTarget.fromCluster(transactionLedgerDatabase),
            vpc: processorVPC,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
            },

            secrets: [transactionLedgerDatabase.secret!],
            clientPasswordAuthType: rds.ClientPasswordAuthType.MYSQL_NATIVE_PASSWORD
        })

        new cdk.CfnOutput(this, 'ClusterEndpoint', { value: transactionLedgerDatabase.clusterEndpoint.hostname });
        new cdk.CfnOutput(this, 'ProxyEndpoint', { value: transactionLedgerProxy.endpoint });
        new cdk.CfnOutput(this, 'SecretArn', { value: transactionLedgerDatabase.secret!.secretArn });

        const bankEventProcessorFunction = new lambda.DockerImageFunction(this, 'BankEventProcessor', {
            vpc: processorVPC,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            },
            code: lambda.DockerImageCode.fromImageAsset('./bank-event-processor'),
            environment: {
                INITIALIZATION_SQS_NAME: props!.InitializationSQSName,
                TRANSACTION_SQS_NAME: props!.TransactionSQSName,
                DB_NAME: transactionLedgerDBName,
            },
            //reservedConcurrentExecutions: 1,
            timeout: Duration.minutes(15),
        })
    }
}