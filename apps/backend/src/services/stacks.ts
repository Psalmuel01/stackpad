import { Configuration, AccountsApi, TransactionsApi, SmartContractsApi } from '@stacks/blockchain-api-client';
import * as dotenv from 'dotenv';

dotenv.config();

const config = new Configuration({
    basePath: process.env.STACKS_API_URL || 'https://api.testnet.hiro.so',
});

export const accountsApi = new AccountsApi(config);
export const transactionsApi = new TransactionsApi(config);
export const smartContractsApi = new SmartContractsApi(config);

export const STACKS_NETWORK = process.env.STACKS_NETWORK || 'testnet';
export const BOOK_REGISTRY_CONTRACT = process.env.BOOK_REGISTRY_CONTRACT || '';
export const ENTITLEMENT_CONTRACT = process.env.ENTITLEMENT_CONTRACT || '';
