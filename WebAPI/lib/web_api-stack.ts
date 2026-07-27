import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecs from 'aws-cdk-lib/aws-ecs';

import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as path from 'path';

export class WebApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

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

    const expressService = new ecs.CfnExpressGatewayService(this, 'AspNetWebApi', {
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
