import { fakerEN } from '@faker-js/faker';
import { Context } from 'aws-lambda'
import { SQSClient, SendMessageCommand, SendMessageCommandInput } from "@aws-sdk/client-sqs";

enum EventType {
    Deposit = "Deposit",
    Withdrawal = "Withdrawal",
    Transaction = "Transaction"
}

type RandomGenerationOrder = {
    num_unique_accounts: number
    starting_balance: number
    transaction_count: number
}

const accountNumberLength = 10;

export const generateRandomEvents = async (event: RandomGenerationOrder, context: Context) : Promise<string> => {

    console.log("Hello World from the Bank Event Generator")

    const fakerInstance = fakerEN;
    const sqsClient = new SQSClient();

    const bankEventSQSURL = process.env.BANK_EVENT_SQS_URL
    if (bankEventSQSURL === undefined) {
        console.error(`Env var BANK_EVENT_SQS_URL must be set`)
        return "failed"
    }

    const accountNumbersSet = new Set<string>();
    while (accountNumbersSet.size < event.num_unique_accounts) {
        accountNumbersSet.add(fakerInstance.finance.accountNumber(accountNumberLength))
    }

    const messageGroupId = "message-group-id"
    const eventTypeAttributeName = "EventType"
    const eventTypeAttributeDataType = "String"
    for (const accountNumber of accountNumbersSet) {

        const initialDepositCommand = new SendMessageCommand({
            QueueUrl: bankEventSQSURL,
            MessageBody: JSON.stringify({
                AccountNumber: accountNumber,
                Amount: event.starting_balance
            }),
            MessageGroupId: messageGroupId,
            MessageAttributes: {
                [eventTypeAttributeName]: {
                    DataType: eventTypeAttributeDataType,
                    StringValue: EventType.Deposit
                }
            }
        });

        try {
            await sqsClient.send(initialDepositCommand)
            console.log('Deposit event succeeded');
        } catch (error) {
            console.error('Deposit event failed:', error);
            throw error;
        }
    }

    return ""

    /*
    const accountNumbersArray = Array.from(accountNumbersSet)
    const randomAccountNumber = (): string => accountNumbersArray[Math.floor(Math.random() * accountNumbersArray.length)]

    for(let i: number = 0; i < event.transaction_count; i++) {
        let debitAccountNumber = ""
        let creditAccountNumber = ""
        do {
            debitAccountNumber = randomAccountNumber();
            creditAccountNumber = randomAccountNumber();
        } while (debitAccountNumber == creditAccountNumber)
    }

    return 'Complete'
     */
}