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

        const dbSecurityGroup = new ec2.SecurityGroup(this, 'Lambda-to-Proxy-SG', {
            vpc: processorVPC,
            allowAllOutbound: true
        })

        dbSecurityGroup.addIngressRule(
            dbSecurityGroup,
            ec2.Port.tcp(3306),
            'Allow traffic from Lambda to RDS Proxy (same SG)'
        );

        const transactionLedgerDBName = 'transactionDB'
        const transactionLedgerCredentialName = 'dbadmin'
        const transactionLedgerDatabase = new rds.DatabaseCluster(this, 'TransactionLedger', {
            engine: rds.DatabaseClusterEngine.auroraMysql({
                version: rds.AuroraMysqlEngineVersion.VER_3_12_0,
            }),
            vpc: processorVPC,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
            },
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            writer: rds.ClusterInstance.serverlessV2('writer'),
            readers: [rds.ClusterInstance.serverlessV2('reader', {
                scaleWithWriter: true
            })],

            defaultDatabaseName: transactionLedgerDBName,
            credentials: rds.Credentials.fromGeneratedSecret(transactionLedgerCredentialName),

            securityGroups: [dbSecurityGroup]
        });

        const transactionLedgerProxy = new rds.DatabaseProxy(this, 'TransactionLedgerProxy', {
            proxyTarget: rds.ProxyTarget.fromCluster(transactionLedgerDatabase),
            vpc: processorVPC,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
            },

            requireTLS: true,
            iamAuth: true,
            secrets: [transactionLedgerDatabase.secret!],
            clientPasswordAuthType: rds.ClientPasswordAuthType.MYSQL_NATIVE_PASSWORD,
            debugLogging: true,

            securityGroups: [dbSecurityGroup],
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

                // Should only need these 3
                PROXY_ENDPOINT: transactionLedgerProxy.endpoint,
                DATABASE_NAME: transactionLedgerDBName,
                DATABASE_USER: transactionLedgerCredentialName,

                CLUSTER_ENDPOINT: transactionLedgerDatabase.clusterEndpoint.hostname,
                SECRET_ARN: transactionLedgerDatabase.secret!.secretArn,
            },
            //reservedConcurrentExecutions: 1,
            timeout: Duration.minutes(15),
            securityGroups: [dbSecurityGroup],
        })

        transactionLedgerProxy.grantConnect(bankEventProcessorFunction.role!, transactionLedgerCredentialName)
    }
}