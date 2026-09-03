import type { PostConfirmationTriggerHandler } from 'aws-lambda';
import {
    CognitoIdentityProviderClient,
    AdminAddUserToGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const cognito = new CognitoIdentityProviderClient({});

export const handler: PostConfirmationTriggerHandler = async (event) => {
    if (event.triggerSource !== "PostConfirmation_ConfirmSignUp") {
        return event
    }

    await cognito.send(new AdminAddUserToGroupCommand({
        UserPoolId: event.userPoolId,
        Username: event.userName,
        GroupName: process.env.CUSTOMER_GROUP_NAME
    }))

    return event
}