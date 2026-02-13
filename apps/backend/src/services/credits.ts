import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import * as dotenv from 'dotenv';
import pool from '../db/client';
import { transactionsApi } from './stacks';

dotenv.config();

const STACKS_NETWORK = (process.env.STACKS_NETWORK || 'testnet') as 'mainnet' | 'testnet';
const TREASURY_ADDRESS = process.env.STACKPAD_TREASURY_ADDRESS || process.env.SERVER_ADDRESS || '';
const DEFAULT_TOP_UP_AMOUNT = toBigIntSafe(process.env.DEFAULT_TOP_UP_MICROSTX, BigInt(200_000)); // 0.2 STX
const DEPOSIT_INTENT_TTL_MINUTES = toNumberSafe(process.env.DEPOSIT_INTENT_TTL_MINUTES, 30);
const DEPOSIT_PENDING_STATUSES = new Set(['pending', 'queued', 'processing']);

export interface DepositIntent {
    intentId: string;
    walletAddress: string;
    amount: string;
    recipient: string;
    memo: string;
    network: string;
    expiresAt: string;
}

export interface DepositSettlementResult {
    status: 'confirmed' | 'pending' | 'invalid';
    balance?: string;
    amountCredited?: string;
    txHash?: string;
    error?: string;
}

export interface CreditAccessGranted {
    status: 'granted';
    balance: string;
    deductedAmount: string;
    usedExistingUnlock: boolean;
}

export interface CreditAccessInsufficient {
    status: 'insufficient';
    balance: string;
    requiredAmount: string;
    shortfall: string;
    recipient: string;
    network: string;
    suggestedTopUpAmount: string;
}

export type CreditAccessResult = CreditAccessGranted | CreditAccessInsufficient;

interface PageChargeInput {
    walletAddress: string;
    bookId: number;
    pageNumber: number;
    chapterNumber: number | null;
    pagePrice: bigint;
    authorAddress: string;
}

interface ChapterChargeInput {
    walletAddress: string;
    bookId: number;
    chapterNumber: number;
    chapterPrice: bigint;
    authorAddress: string;
}

interface DepositVerificationResult {
    status: 'confirmed' | 'pending' | 'invalid';
    txHash?: string;
    amount?: bigint;
    error?: string;
}

export async function getReaderCreditBalance(walletAddress: string): Promise<bigint> {
    const normalizedWallet = normalizeWalletAddress(walletAddress);
    const client = await pool.connect();
    try {
        await ensureReaderAccount(client, normalizedWallet);
        const result = await client.query(
            'SELECT credit_balance FROM reader_accounts WHERE wallet_address = $1',
            [normalizedWallet]
        );

        if (result.rows.length === 0) {
            return BigInt(0);
        }

        return BigInt(String(result.rows[0].credit_balance ?? '0'));
    } finally {
        client.release();
    }
}

export async function createDepositIntent(walletAddress: string, amount: bigint): Promise<DepositIntent> {
    if (!TREASURY_ADDRESS) {
        throw new Error('Treasury address is not configured');
    }

    const normalizedWallet = normalizeWalletAddress(walletAddress);
    if (amount <= BigInt(0)) {
        throw new Error('Deposit amount must be greater than zero');
    }

    const intentId = randomUUID();
    const memo = `spd:${intentId.replace(/-/g, '').slice(0, 24)}`;
    const now = Date.now();
    const expiresAt = new Date(now + (DEPOSIT_INTENT_TTL_MINUTES * 60_000));

    await pool.query(
        `INSERT INTO credit_deposit_intents (id, wallet_address, amount, memo, status, expires_at)
         VALUES ($1, $2, $3, $4, 'pending', $5)`,
        [intentId, normalizedWallet, amount.toString(), memo, expiresAt.toISOString()]
    );

    return {
        intentId,
        walletAddress: normalizedWallet,
        amount: amount.toString(),
        recipient: TREASURY_ADDRESS,
        memo,
        network: toCaip2Network(STACKS_NETWORK),
        expiresAt: expiresAt.toISOString(),
    };
}

export async function settleDepositIntent(
    walletAddress: string,
    intentId: string,
    txHash?: string
): Promise<DepositSettlementResult> {
    const normalizedWallet = normalizeWalletAddress(walletAddress);
    const normalizedTxHash = typeof txHash === 'string' && txHash.trim()
        ? normalizeTxHash(txHash)
        : null;

    const intentLookup = await pool.query(
        `SELECT id, wallet_address, amount, memo, status, tx_hash, expires_at
         FROM credit_deposit_intents
         WHERE id = $1`,
        [intentId]
    );

    if (intentLookup.rows.length === 0) {
        return { status: 'invalid', error: 'Deposit intent not found' };
    }

    const intent = intentLookup.rows[0] as {
        id: string;
        wallet_address: string;
        amount: string;
        memo: string;
        status: string;
        tx_hash: string | null;
        expires_at: Date | string;
    };

    if (!isSameAddress(intent.wallet_address, normalizedWallet)) {
        return { status: 'invalid', error: 'Wallet does not match deposit intent' };
    }

    if (intent.status === 'confirmed') {
        const currentBalance = await getReaderCreditBalance(normalizedWallet);
        return {
            status: 'confirmed',
            balance: currentBalance.toString(),
            txHash: intent.tx_hash || normalizedTxHash || undefined,
            amountCredited: intent.amount,
        };
    }

    const submittedTxHash = intent.tx_hash || normalizedTxHash;

    // If a wallet transaction hash exists, keep the intent settle-able even after nominal TTL.
    // This avoids stranded deposits when chain confirmation is slow.
    const expiresAt = new Date(intent.expires_at);
    const isExpired = !Number.isNaN(expiresAt.getTime()) && Date.now() > expiresAt.getTime();
    const hasSubmittedTx = Boolean(submittedTxHash);
    if (isExpired && !hasSubmittedTx) {
        await pool.query(
            `UPDATE credit_deposit_intents
             SET status = 'expired',
                 last_error = COALESCE(last_error, 'Deposit intent expired')
             WHERE id = $1`,
            [intentId]
        );
        return {
            status: 'invalid',
            txHash: normalizedTxHash || undefined,
            error: 'Deposit intent expired. Create a new top-up request.',
        };
    }

    if (!submittedTxHash) {
        return {
            status: 'invalid',
            error: 'Transaction hash is required to verify this deposit intent.',
        };
    }

    const verification = await verifyDepositTransaction(
        submittedTxHash,
        normalizedWallet,
        BigInt(intent.amount),
        intent.memo
    );

    if (verification.status === 'pending') {
        await pool.query(
            `UPDATE credit_deposit_intents
             SET tx_hash = COALESCE(tx_hash, $2), last_error = $3
             WHERE id = $1`,
            [intentId, submittedTxHash, verification.error || null]
        );

        return {
            status: 'pending',
            txHash: submittedTxHash,
            error: verification.error || 'Transaction is still pending',
        };
    }

    if (verification.status === 'invalid' || !verification.amount || !verification.txHash) {
        await pool.query(
            `UPDATE credit_deposit_intents
             SET tx_hash = COALESCE(tx_hash, $2), last_error = $3
             WHERE id = $1`,
            [intentId, submittedTxHash, verification.error || 'Deposit verification failed']
        );

        return {
            status: 'invalid',
            txHash: submittedTxHash,
            error: verification.error || 'Deposit verification failed',
        };
    }

    const client = await pool.connect();
    let rolledBack = false;
    try {
        await client.query('BEGIN');

        const lockedIntent = await client.query(
            `SELECT id, status, tx_hash, memo
             FROM credit_deposit_intents
             WHERE id = $1
             FOR UPDATE`,
            [intentId]
        );

        if (lockedIntent.rows.length === 0) {
            await client.query('ROLLBACK');
            rolledBack = true;
            return { status: 'invalid', error: 'Deposit intent not found' };
        }

        const currentIntent = lockedIntent.rows[0] as {
            id: string;
            status: string;
            tx_hash: string | null;
            memo: string;
        };

        if (currentIntent.status === 'confirmed') {
            await client.query('COMMIT');
            const balance = await getReaderCreditBalance(normalizedWallet);
            return {
                status: 'confirmed',
                balance: balance.toString(),
                txHash: currentIntent.tx_hash || verification.txHash,
            };
        }

        if (currentIntent.tx_hash && currentIntent.tx_hash !== verification.txHash) {
            await client.query('ROLLBACK');
            rolledBack = true;
            return {
                status: 'invalid',
                error: 'Deposit intent already linked to a different transaction',
            };
        }

        const duplicateTx = await client.query(
            `SELECT id
             FROM credit_deposit_intents
             WHERE tx_hash = $1 AND id <> $2
             LIMIT 1`,
            [verification.txHash, intentId]
        );
        if (duplicateTx.rows.length > 0) {
            await client.query('ROLLBACK');
            rolledBack = true;
            return {
                status: 'invalid',
                error: 'This transaction has already been used for another deposit',
            };
        }

        await ensureReaderAccount(client, normalizedWallet);

        const accountQuery = await client.query(
            `SELECT credit_balance
             FROM reader_accounts
             WHERE wallet_address = $1
             FOR UPDATE`,
            [normalizedWallet]
        );

        const currentBalance = BigInt(String(accountQuery.rows[0].credit_balance ?? '0'));
        const creditedAmount = verification.amount;
        const newBalance = currentBalance + creditedAmount;

        await client.query(
            `UPDATE reader_accounts
             SET credit_balance = $2,
                 total_deposited = total_deposited + $3,
                 updated_at = NOW()
             WHERE wallet_address = $1`,
            [normalizedWallet, newBalance.toString(), creditedAmount.toString()]
        );

        await client.query(
            `INSERT INTO credit_transactions
                (wallet_address, tx_type, amount, balance_after, reference_id, chain_tx_hash, metadata)
             VALUES
                ($1, 'deposit', $2, $3, $4, $5, $6::jsonb)`,
            [
                normalizedWallet,
                creditedAmount.toString(),
                newBalance.toString(),
                intentId,
                verification.txHash,
                JSON.stringify({
                    intentMemo: currentIntent.memo,
                }),
            ]
        );

        await client.query(
            `UPDATE credit_deposit_intents
             SET status = 'confirmed',
                 amount = $3,
                 tx_hash = $2,
                 settled_at = NOW(),
                 last_error = NULL
             WHERE id = $1`,
            [intentId, verification.txHash, creditedAmount.toString()]
        );

        await client.query('COMMIT');

        return {
            status: 'confirmed',
            balance: newBalance.toString(),
            txHash: verification.txHash,
            amountCredited: creditedAmount.toString(),
        };
    } catch (error) {
        if (!rolledBack) {
            await client.query('ROLLBACK');
        }
        console.error('Failed to settle deposit intent:', error);
        return {
            status: 'invalid',
            txHash: submittedTxHash,
            error: error instanceof Error ? error.message : 'Failed to settle deposit',
        };
    } finally {
        client.release();
    }
}

export async function chargeCreditsForPage(input: PageChargeInput): Promise<CreditAccessResult> {
    const normalizedWallet = normalizeWalletAddress(input.walletAddress);

    if (input.pageNumber === 1) {
        const balance = await getReaderCreditBalance(normalizedWallet);
        return {
            status: 'granted',
            balance: balance.toString(),
            deductedAmount: '0',
            usedExistingUnlock: true,
        };
    }

    const client = await pool.connect();
    let rolledBack = false;
    try {
        await client.query('BEGIN');
        await ensureReaderAccount(client, normalizedWallet);

        const accountQuery = await client.query(
            `SELECT credit_balance
             FROM reader_accounts
             WHERE wallet_address = $1
             FOR UPDATE`,
            [normalizedWallet]
        );

        const currentBalance = BigInt(String(accountQuery.rows[0].credit_balance ?? '0'));

        const existingUnlock = await client.query(
            `SELECT id
             FROM reader_page_unlocks
             WHERE wallet_address = $1 AND book_id = $2 AND page_number = $3
             LIMIT 1`,
            [normalizedWallet, input.bookId, input.pageNumber]
        );

        if (existingUnlock.rows.length > 0 || await hasLegacyPageEntitlement(client, normalizedWallet, input.bookId, input.pageNumber, input.chapterNumber)) {
            await client.query('COMMIT');
            return {
                status: 'granted',
                balance: currentBalance.toString(),
                deductedAmount: '0',
                usedExistingUnlock: true,
            };
        }

        if (currentBalance < input.pagePrice) {
            const shortfall = input.pagePrice - currentBalance;
            await client.query('ROLLBACK');
            rolledBack = true;
            return insufficientCreditResult(input.pagePrice, currentBalance, shortfall);
        }

        const newBalance = currentBalance - input.pagePrice;

        await client.query(
            `UPDATE reader_accounts
             SET credit_balance = $2,
                 total_spent = total_spent + $3,
                 updated_at = NOW()
             WHERE wallet_address = $1`,
            [normalizedWallet, newBalance.toString(), input.pagePrice.toString()]
        );

        const transactionInsert = await client.query(
            `INSERT INTO credit_transactions
                (wallet_address, tx_type, amount, balance_after, book_id, page_number, chapter_number, metadata)
             VALUES
                ($1, 'deduction', $2, $3, $4, $5, $6, $7::jsonb)
             RETURNING id`,
            [
                normalizedWallet,
                (-input.pagePrice).toString(),
                newBalance.toString(),
                input.bookId,
                input.pageNumber,
                input.chapterNumber,
                JSON.stringify({
                    source: 'page_unlock',
                }),
            ]
        );

        const creditTransactionId = Number(transactionInsert.rows[0].id);
        const unlockInsert = await client.query(
            `INSERT INTO reader_page_unlocks
                (wallet_address, book_id, page_number, amount, credit_transaction_id)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (wallet_address, book_id, page_number) DO NOTHING
             RETURNING id`,
            [
                normalizedWallet,
                input.bookId,
                input.pageNumber,
                input.pagePrice.toString(),
                creditTransactionId,
            ]
        );

        if (unlockInsert.rows.length === 0) {
            throw new Error('Concurrent page unlock conflict');
        }

        await client.query(
            `INSERT INTO author_revenue_events
                (author_address, reader_address, book_id, page_number, amount, credit_transaction_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                input.authorAddress,
                normalizedWallet,
                input.bookId,
                input.pageNumber,
                input.pagePrice.toString(),
                creditTransactionId,
            ]
        );

        await client.query('COMMIT');
        return {
            status: 'granted',
            balance: newBalance.toString(),
            deductedAmount: input.pagePrice.toString(),
            usedExistingUnlock: false,
        };
    } catch (error) {
        if (!rolledBack) {
            await client.query('ROLLBACK');
        }
        throw error;
    } finally {
        client.release();
    }
}

export async function chargeCreditsForChapter(input: ChapterChargeInput): Promise<CreditAccessResult> {
    const normalizedWallet = normalizeWalletAddress(input.walletAddress);

    if (input.chapterNumber === 1) {
        const balance = await getReaderCreditBalance(normalizedWallet);
        return {
            status: 'granted',
            balance: balance.toString(),
            deductedAmount: '0',
            usedExistingUnlock: true,
        };
    }

    const client = await pool.connect();
    let rolledBack = false;
    try {
        await client.query('BEGIN');
        await ensureReaderAccount(client, normalizedWallet);

        const accountQuery = await client.query(
            `SELECT credit_balance
             FROM reader_accounts
             WHERE wallet_address = $1
             FOR UPDATE`,
            [normalizedWallet]
        );
        const currentBalance = BigInt(String(accountQuery.rows[0].credit_balance ?? '0'));

        const existingUnlock = await client.query(
            `SELECT id
             FROM reader_chapter_unlocks
             WHERE wallet_address = $1 AND book_id = $2 AND chapter_number = $3
             LIMIT 1`,
            [normalizedWallet, input.bookId, input.chapterNumber]
        );

        if (existingUnlock.rows.length > 0 || await hasLegacyChapterEntitlement(client, normalizedWallet, input.bookId, input.chapterNumber)) {
            await client.query('COMMIT');
            return {
                status: 'granted',
                balance: currentBalance.toString(),
                deductedAmount: '0',
                usedExistingUnlock: true,
            };
        }

        if (currentBalance < input.chapterPrice) {
            const shortfall = input.chapterPrice - currentBalance;
            await client.query('ROLLBACK');
            rolledBack = true;
            return insufficientCreditResult(input.chapterPrice, currentBalance, shortfall);
        }

        const newBalance = currentBalance - input.chapterPrice;

        await client.query(
            `UPDATE reader_accounts
             SET credit_balance = $2,
                 total_spent = total_spent + $3,
                 updated_at = NOW()
             WHERE wallet_address = $1`,
            [normalizedWallet, newBalance.toString(), input.chapterPrice.toString()]
        );

        const transactionInsert = await client.query(
            `INSERT INTO credit_transactions
                (wallet_address, tx_type, amount, balance_after, book_id, chapter_number, metadata)
             VALUES
                ($1, 'deduction', $2, $3, $4, $5, $6::jsonb)
             RETURNING id`,
            [
                normalizedWallet,
                (-input.chapterPrice).toString(),
                newBalance.toString(),
                input.bookId,
                input.chapterNumber,
                JSON.stringify({
                    source: 'chapter_unlock',
                }),
            ]
        );

        const creditTransactionId = Number(transactionInsert.rows[0].id);
        const unlockInsert = await client.query(
            `INSERT INTO reader_chapter_unlocks
                (wallet_address, book_id, chapter_number, amount, credit_transaction_id)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (wallet_address, book_id, chapter_number) DO NOTHING
             RETURNING id`,
            [
                normalizedWallet,
                input.bookId,
                input.chapterNumber,
                input.chapterPrice.toString(),
                creditTransactionId,
            ]
        );

        if (unlockInsert.rows.length === 0) {
            throw new Error('Concurrent chapter unlock conflict');
        }

        await client.query(
            `INSERT INTO author_revenue_events
                (author_address, reader_address, book_id, chapter_number, amount, credit_transaction_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                input.authorAddress,
                normalizedWallet,
                input.bookId,
                input.chapterNumber,
                input.chapterPrice.toString(),
                creditTransactionId,
            ]
        );

        await client.query('COMMIT');

        return {
            status: 'granted',
            balance: newBalance.toString(),
            deductedAmount: input.chapterPrice.toString(),
            usedExistingUnlock: false,
        };
    } catch (error) {
        if (!rolledBack) {
            await client.query('ROLLBACK');
        }
        throw error;
    } finally {
        client.release();
    }
}

export async function reconcilePendingDepositIntents(limit = 25): Promise<void> {
    const pendingIntents = await pool.query(
        `SELECT id, wallet_address, tx_hash
         FROM credit_deposit_intents
         WHERE status IN ('pending', 'expired')
           AND tx_hash IS NOT NULL
         ORDER BY created_at ASC
         LIMIT $1`,
        [limit]
    );

    for (const row of pendingIntents.rows) {
        const intent = row as {
            id: string;
            wallet_address: string;
            tx_hash: string;
        };
        try {
            await settleDepositIntent(intent.wallet_address, intent.id, intent.tx_hash);
        } catch (error) {
            console.error('Failed to reconcile pending deposit intent:', error);
        }
    }
}

export async function settleAuthorRevenueBatch(limit = 500): Promise<{ eventCount: number; totalAmount: bigint }> {
    const client = await pool.connect();
    let rolledBack = false;
    try {
        await client.query('BEGIN');
        const pending = await client.query(
            `SELECT id, amount
             FROM author_revenue_events
             WHERE settled = FALSE
             ORDER BY created_at ASC
             LIMIT $1
             FOR UPDATE SKIP LOCKED`,
            [limit]
        );

        if (pending.rows.length === 0) {
            await client.query('ROLLBACK');
            rolledBack = true;
            return { eventCount: 0, totalAmount: BigInt(0) };
        }

        const ids = pending.rows.map((row) => Number(row.id));
        const totalAmount = pending.rows.reduce((sum, row) => sum + BigInt(String(row.amount ?? '0')), BigInt(0));

        const batchInsert = await client.query(
            `INSERT INTO author_settlement_batches (total_amount, event_count)
             VALUES ($1, $2)
             RETURNING id`,
            [totalAmount.toString(), ids.length]
        );
        const batchId = Number(batchInsert.rows[0].id);

        await client.query(
            `UPDATE author_revenue_events
             SET settled = TRUE,
                 settled_at = NOW()
             WHERE id = ANY($1::int[])`,
            [ids]
        );

        await client.query('COMMIT');
        return { eventCount: ids.length, totalAmount };
    } catch (error) {
        if (!rolledBack) {
            await client.query('ROLLBACK');
        }
        console.error('Failed to settle author revenue batch:', error);
        return { eventCount: 0, totalAmount: BigInt(0) };
    } finally {
        client.release();
    }
}

export function getDefaultTopUpAmount(requiredAmount: bigint): bigint {
    return requiredAmount > DEFAULT_TOP_UP_AMOUNT ? requiredAmount : DEFAULT_TOP_UP_AMOUNT;
}

function insufficientCreditResult(requiredAmount: bigint, balance: bigint, shortfall: bigint): CreditAccessInsufficient {
    const suggestedTopUpAmount = getDefaultTopUpAmount(shortfall);
    return {
        status: 'insufficient',
        balance: balance.toString(),
        requiredAmount: requiredAmount.toString(),
        shortfall: shortfall.toString(),
        recipient: TREASURY_ADDRESS,
        network: toCaip2Network(STACKS_NETWORK),
        suggestedTopUpAmount: suggestedTopUpAmount.toString(),
    };
}

async function hasLegacyPageEntitlement(
    client: PoolClient,
    walletAddress: string,
    bookId: number,
    pageNumber: number,
    chapterNumber: number | null
): Promise<boolean> {
    const result = await client.query(
        `SELECT id
         FROM payment_logs
         WHERE reader_address = $1
           AND book_id = $2
           AND (
             page_number = $3
             OR ($4::integer IS NOT NULL AND chapter_number = $4)
           )
         LIMIT 1`,
        [walletAddress, bookId, pageNumber, chapterNumber]
    );

    return result.rows.length > 0;
}

async function hasLegacyChapterEntitlement(
    client: PoolClient,
    walletAddress: string,
    bookId: number,
    chapterNumber: number
): Promise<boolean> {
    const result = await client.query(
        `SELECT id
         FROM payment_logs
         WHERE reader_address = $1
           AND book_id = $2
           AND chapter_number = $3
         LIMIT 1`,
        [walletAddress, bookId, chapterNumber]
    );

    return result.rows.length > 0;
}

async function verifyDepositTransaction(
    txHash: string,
    expectedWalletAddress: string,
    expectedMinimumAmount: bigint,
    expectedMemo: string
): Promise<DepositVerificationResult> {
    try {
        const response = await transactionsApi.getTransactionById({ txId: txHash });
        const tx = response as Record<string, unknown>;
        const txStatus = String(tx.tx_status ?? '');
        const txType = String(tx.tx_type ?? '');

        if (txStatus !== 'success') {
            if (DEPOSIT_PENDING_STATUSES.has(txStatus)) {
                return {
                    status: 'pending',
                    txHash,
                    error: `transaction_pending:${txStatus}`,
                };
            }
            return {
                status: 'invalid',
                txHash,
                error: `transaction_not_confirmed:${txStatus || 'unknown'}`,
            };
        }

        if (txType !== 'token_transfer') {
            return {
                status: 'invalid',
                txHash,
                error: 'Deposit transaction must be a token transfer',
            };
        }

        const tokenTransfer = tx.token_transfer as Record<string, unknown> | undefined;
        const senderAddress = String(tx.sender_address ?? '');
        const recipientAddress = String(tokenTransfer?.recipient_address ?? '');
        const memo = normalizeTransferMemo(
            typeof tokenTransfer?.memo === 'string' ? tokenTransfer.memo : undefined
        );
        const amount = BigInt(String(tokenTransfer?.amount ?? '0'));

        if (!senderAddress || !recipientAddress) {
            return {
                status: 'invalid',
                txHash,
                error: 'Transaction payload is missing sender or recipient',
            };
        }

        if (!isSameAddress(senderAddress, expectedWalletAddress)) {
            return {
                status: 'invalid',
                txHash,
                error: 'Deposit sender does not match connected wallet',
            };
        }

        if (!TREASURY_ADDRESS || !isSameAddress(recipientAddress, TREASURY_ADDRESS)) {
            return {
                status: 'invalid',
                txHash,
                error: 'Deposit recipient does not match Stackpad treasury',
            };
        }

        if (amount < expectedMinimumAmount) {
            return {
                status: 'invalid',
                txHash,
                error: 'Deposit amount is below the required intent amount',
            };
        }

        if (memo !== expectedMemo) {
            return {
                status: 'invalid',
                txHash,
                error: 'Deposit memo does not match intent',
            };
        }

        return {
            status: 'confirmed',
            txHash,
            amount,
        };
    } catch (error) {
        return {
            status: 'pending',
            txHash,
            error: error instanceof Error ? error.message : 'Failed to fetch transaction',
        };
    }
}

async function ensureReaderAccount(client: PoolClient, walletAddress: string): Promise<void> {
    await client.query(
        `INSERT INTO reader_accounts (wallet_address)
         VALUES ($1)
         ON CONFLICT (wallet_address) DO NOTHING`,
        [walletAddress]
    );
}

function normalizeWalletAddress(address: string): string {
    const normalized = address.trim();
    if (!normalized) {
        throw new Error('Wallet address is required');
    }
    return normalized;
}

function isSameAddress(a: string, b: string): boolean {
    return a.trim().toUpperCase() === b.trim().toUpperCase();
}

function normalizeTxHash(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
        throw new Error('Transaction hash is required');
    }
    return trimmed.startsWith('0x') || trimmed.startsWith('0X')
        ? trimmed.slice(2)
        : trimmed;
}

function normalizeTransferMemo(rawMemo?: string): string {
    if (!rawMemo) {
        return '';
    }

    const trimmed = rawMemo.trim();
    if (!trimmed) {
        return '';
    }

    const decodedHex = decodeHexMemo(trimmed);
    const candidate = decodedHex ?? trimmed;
    return candidate.replace(/\u0000/g, '').trim();
}

function decodeHexMemo(value: string): string | null {
    const withoutPrefix = value.startsWith('0x') || value.startsWith('0X')
        ? value.slice(2)
        : value;

    if (!withoutPrefix || withoutPrefix.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(withoutPrefix)) {
        return null;
    }

    try {
        return Buffer.from(withoutPrefix, 'hex').toString('utf-8');
    } catch {
        return null;
    }
}

function toCaip2Network(network: 'mainnet' | 'testnet'): string {
    return network === 'mainnet' ? 'stacks:1' : 'stacks:2147483648';
}

function toBigIntSafe(value: string | undefined, fallback: bigint): bigint {
    if (!value) {
        return fallback;
    }

    try {
        const parsed = BigInt(value);
        if (parsed <= BigInt(0)) {
            return fallback;
        }
        return parsed;
    } catch {
        return fallback;
    }
}

function toNumberSafe(value: string | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return fallback;
    }

    return parsed;
}
