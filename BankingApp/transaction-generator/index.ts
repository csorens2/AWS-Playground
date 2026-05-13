import { fakerEN } from '@faker-js/faker';
import { Transaction } from "../lib/transaction";
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Context } from 'aws-lambda'

type GenerationOrder = {
    num_unique_accounts: number
    transaction_count: number
}

export const handler = async (event: GenerationOrder, context: Context) : Promise<string> => {

    console.log("Hello World from Lambda")

    const eventBridgeName = process.env.EVENTBRIDGE_NAME

    const accountNumberLength = 10;
    const fakerInstance = fakerEN;

    const accountNumbersSet = new Set<string>();
    while (accountNumbersSet.size < event.num_unique_accounts) {
        accountNumbersSet.add(fakerInstance.finance.accountNumber(accountNumberLength))
    }

    const accountNumbersArray = Array.from(accountNumbersSet)
    const randomAccountNumber = (): string => accountNumbersArray[Math.floor(Math.random() * accountNumbersArray.length)]

    const eventBridgeClient = new EventBridgeClient({})

    for(let i: number = 0; i < event.transaction_count; i++) {
        const nextTransaction: Transaction = {
            AccountNumber: randomAccountNumber(),
            Amount: Number(fakerInstance.finance.amount( {min: 1, max: 10})),
            Initializing: false
        }

        const command = new PutEventsCommand({
            Entries: [
                {
                    // Use the bus name/ARN you created or 'default'
                    EventBusName: eventBridgeName,
                    Source: context.functionName,
                    DetailType: 'Transaction',
                    Detail: JSON.stringify(nextTransaction),
                },
            ],
        });

        try {
            const response = await eventBridgeClient.send(command)
            console.log('PutEvents succeeded:');
        } catch (error) {
            console.error('PutEvents failed:', error);
            throw error;
        }
    }

    return 'Something'
}