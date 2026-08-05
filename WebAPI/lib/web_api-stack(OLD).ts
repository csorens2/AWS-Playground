import * as cdk from 'aws-cdk-lib/core';
import {Construct} from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import {Effect} from 'aws-cdk-lib/aws-iam';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from "aws-cdk-lib/aws-ec2";

import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as path from 'path';

export class WebApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

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

    const ecsExecutionRole = new iam.Role(this, 'ECSExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
            'service-role/AmazonECSTaskExecutionRolePolicy'
        )
      ],
    })

    const ecsInfrastructureRole = new iam.Role(this, 'ECSInfrastructureRole', {
      assumedBy: new iam.ServicePrincipal('ecs.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
            'service-role/AmazonECSInfrastructureRoleforExpressGatewayServices'
        ),
      ]
    });
    /*
    ecsInfrastructureRole.addToPolicy(new iam.PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['ec2:DescribeInternetGateways'],
      resources: ['*'],
    }))
     */

    const apiImageAsset = new ecrAssets.DockerImageAsset(this, 'MyWebApiImage', {
      directory: path.join(__dirname, '../api/MyWebApi')
    })
    apiImageAsset.repository.grantPull(ecsExecutionRole);

    const expressCluster = new ecs.Cluster(this, 'ExpressCluster', {
      vpc: apiVPC,
    })

    const expressService = new ecs.CfnExpressGatewayService(this, 'AspNetWebApi', {
      infrastructureRoleArn: ecsInfrastructureRole.roleArn,
      executionRoleArn: ecsExecutionRole.roleArn,
      primaryContainer: {
        image: apiImageAsset.imageUri,
        containerPort: 8080,
      },

      cluster: expressCluster.clusterArn,

      networkConfiguration: {
        subnets: apiVPC.publicSubnets.map(s => s.subnetId)
      },

    });
    //expressService.node.addDependency(ecsExecutionRole)

    new cdk.CfnOutput(this, 'ServiceUrl', {
      value: expressService.getAtt('Endpoint').toString(),
      description: 'URL of the ASP.NET Web API on ECS Express Mode',
    });
  }
}
