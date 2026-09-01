import * as cdk from 'aws-cdk-lib/core';
import {Construct} from 'constructs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as rds from "aws-cdk-lib/aws-rds";
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import path from "path";

export class StoreApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const itemsDBName = 'items'
    const itemsAdminName = 'admin' // DO NOT TOUCH

    const apiVPC = new ec2.Vpc(this, 'ApiVPC', {
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

    const itemsDatabase = new rds.DatabaseInstance(this, 'ItemsDatabase', {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_4_8
      }),
      vpc: apiVPC,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC
      },
      credentials: rds.Credentials.fromUsername(itemsAdminName), // DO NOT TOUCH
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      databaseName: itemsDBName
    })

    const cartDatabase = new dynamodb.TableV2(this, 'CustomerCart', {
      partitionKey: { name: 'CartGuid', type: dynamodb.AttributeType.STRING },
      tableName: 'CustomerCart',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    const logGroup = new logs.LogGroup(this, 'ApiLogGroup', {
      logGroupName: '/ecs/my-aspnet-api',
      retention: logs.RetentionDays.ONE_MONTH, // adjust as needed
      removalPolicy: cdk.RemovalPolicy.DESTROY, // or RETAIN for production
    });

    const itemPictureBucket = new s3.Bucket(this, 'ItemPictureBucket', {})

    const ecsService = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'ApiFargateService', {
      taskImageOptions: {
        image: ecs.ContainerImage.fromDockerImageAsset(
            new ecrAssets.DockerImageAsset(this, 'ApiImage', {
              directory: path.join(__dirname, '../api')
            })
        ),
        containerPort: 8080,
        environment: {
          itemsDatabaseEndpoint: itemsDatabase.instanceEndpoint.hostname,
          itemsDatabaseName: itemsDBName,
          itemsDatabaseUser: itemsAdminName,

          itemPicturesBucketName: itemPictureBucket.bucketName,

          DynamoDb__CartTableName: cartDatabase.tableName,
        },
        secrets: {
          itemsDatabasePassword: ecs.Secret.fromSecretsManager(itemsDatabase.secret!, 'password'),
        },
        logDriver: ecs.LogDrivers.awsLogs({
          streamPrefix: 'aspnet-api',
          logGroup: logGroup,
          mode: ecs.AwsLogDriverMode.NON_BLOCKING
        })
      },
      publicLoadBalancer: true,
      vpc: apiVPC,
      circuitBreaker: {
        enable: true,
        rollback: true
      },
    })

    itemPictureBucket.grantReadWrite(ecsService.taskDefinition.taskRole)
    cartDatabase.grantReadWriteData(ecsService.taskDefinition.taskRole)

    itemsDatabase.connections.allowDefaultPortFrom(
        ecsService.service,
    );

    itemsDatabase.connections.allowDefaultPortFromAnyIpv4()

    new cdk.CfnOutput(this, 'ItemsDatabaseEndpoint', {
      value: itemsDatabase.instanceEndpoint.hostname
    })

    new cdk.CfnOutput(this, 'LoadbalancerDNSName', {
      value: ecsService.loadBalancer.loadBalancerDnsName,
    });

    new cdk.CfnOutput(this, 'Cart Table Name', {
      value: cartDatabase.tableName,
    })
  }
}
