import { fakerEN } from '@faker-js/faker';
import { TransactionEvent, TransactionEventDetailType } from "../lib/transactionEvent";
import { InitializationEvent, InitializationEventDetailType} from "../lib/initializationEvent"
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Context } from 'aws-lambda'

type GenerationOrder = {
    num_unique_accounts: number
    starting_balance: number
    transaction_count: number
}

const accountNumberLength = 10;

export const handler = async (event: GenerationOrder, context: Context) : Promise<string> => {

    console.log("Hello World from the Bank Event Generator")

    const eventBridgeName = process.env.EVENTBRIDGE_NAME
    const eventBridgeClient = new EventBridgeClient({})

    const fakerInstance = fakerEN;

    const accountNumbersSet = new Set<string>();
    while (accountNumbersSet.size < event.num_unique_accounts) {
        accountNumbersSet.add(fakerInstance.finance.accountNumber(accountNumberLength))
    }

    for (const accountNumber of accountNumbersSet) {
        const nextInitialization: InitializationEvent = {
            AccountNumber: accountNumber,
            Amount: event.starting_balance
        }

        const command = new PutEventsCommand({
            Entries: [
                {
                    EventBusName: eventBridgeName,
                    Source: context.functionName,
                    DetailType: InitializationEventDetailType,
                    Detail: JSON.stringify(nextInitialization),
                }
            ]
        });

        try {
            await eventBridgeClient.send(command)
            console.log('Initialization PutEvent succeeded');
        } catch (error) {
            console.error('Initialization PutEvent failed:', error);
            throw error;
        }
    }

    const accountNumbersArray = Array.from(accountNumbersSet)
    const randomAccountNumber = (): string => accountNumbersArray[Math.floor(Math.random() * accountNumbersArray.length)]

    for(let i: number = 0; i < event.transaction_count; i++) {
        let debitAccountNumber = ""
        let creditAccountNumber = ""
        do {
            debitAccountNumber = randomAccountNumber();
            creditAccountNumber = randomAccountNumber();
        } while (debitAccountNumber == creditAccountNumber)

        const nextTransaction: TransactionEvent = {
            DebitAccountNumber: debitAccountNumber,
            CreditAccountNumber: creditAccountNumber,
            Amount: Number(fakerInstance.finance.amount( {min: 1, max: event.starting_balance})),
        }

        const command = new PutEventsCommand({
            Entries: [
                {
                    EventBusName: eventBridgeName,
                    Source: context.functionName,
                    DetailType: InitializationEventDetailType,
                    Detail: JSON.stringify(nextTransaction),
                },
            ],
        });

        try {
            await eventBridgeClient.send(command)
            console.log('Transaction PutEvent succeeded:');
        } catch (error) {
            console.error('Transaction PutEvent failed:', error);
            throw error;
        }
    }

    return 'Complete'
}