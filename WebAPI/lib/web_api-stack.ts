import * as cdk from 'aws-cdk-lib/core';
import {Construct} from 'constructs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import path from "path";


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

        const ecsService = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'ApiFargateService', {
            taskImageOptions: {
                image: ecs.ContainerImage.fromDockerImageAsset(
                    new ecrAssets.DockerImageAsset(this, 'MyWebApiImage', {
                        directory: path.join(__dirname, '../api/MyWebApi')
                    })
                ),
                containerPort: 8080
            },
            publicLoadBalancer: true,
            vpc: apiVPC,
            circuitBreaker: {
                enable: true,
                rollback: true
            },

        })

        new cdk.CfnOutput(this, 'LoadbalancerDNSName', {
            value: ecsService.loadBalancer.loadBalancerDnsName,
        });

    }
}