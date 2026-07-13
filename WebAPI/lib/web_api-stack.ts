import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as path from 'path';

export class WebApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const imageAsset = new ecrAssets.DockerImageAsset(this, 'AspNetApiImage', {
      directory: path.join(__dirname, '../api')
    })

    /*
    new cdk.CfnOutput(this, 'AppRunnerUrl', {
      value: `https://${service.serviceUrl}`,
      description: 'Public URL of the App Runner service',
    });
     */
  }
}
