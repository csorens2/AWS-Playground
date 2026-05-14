export type TransactionEvent = {
    DebitAccountNumber: string
    CreditAccountNumber: string
    Amount: number
}

export const TransactionEventDetailType = "Transaction Event"