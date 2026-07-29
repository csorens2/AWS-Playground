import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
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

    const imageAsset = new ecrAssets.DockerImageAsset(this, 'MyWebApiImage', {
      directory: path.join(__dirname, '../api/MyWebApi')
    })

    const executionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
              'service-role/AmazonECSTaskExecutionRolePolicy'
          )
      ]
    })
    imageAsset.repository.grantPull(executionRole);

    const infrastructureRole = new iam.Role(this, 'InfrastructureRole', {
      assumedBy: new iam.ServicePrincipal('ecs.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
            'service-role/AmazonECSInfrastructureRoleforExpressGatewayServices'
        ),
      ],
    });

    const expressCluster = new ecs.Cluster(this, 'ExpressCluster', {
      vpc: apiVPC
    })

    const expressService = new ecs.CfnExpressGatewayService(this, 'AspNetWebApi', {
      cluster: expressCluster.clusterName,
      networkConfiguration: {
        subnets: apiVPC.publicSubnets.map(s => s.subnetId)
      },

      serviceName: 'aspnet-webapi',
      executionRoleArn: executionRole.roleArn,
      infrastructureRoleArn: infrastructureRole.roleArn,

      primaryContainer: {
        image: imageAsset.imageUri,
        containerPort: 8080,
        environment: [
            // Necessary?
          { name: 'ASPNETCORE_ENVIRONMENT', value: 'Production' },
        ],
      },

      healthCheckPath: '/health',
      //cpu: '1024',
      //memory: '2048',

      scalingTarget: {
        minTaskCount: 1,
        maxTaskCount: 5,
      },
    });

    new cdk.CfnOutput(this, 'ServiceUrl', {
      value: `https://${expressService.getAtt('Endpoint').toString()}`,
      description: 'URL of the ASP.NET Web API on ECS Express Mode',
    });
  }
}
