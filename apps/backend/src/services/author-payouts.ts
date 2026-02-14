import * as dotenv from 'dotenv';
import {
    broadcastTransaction,
    getAddressFromPrivateKey,
    makeSTXTokenTransfer,
    TransactionVersion,
    validateStacksAddress,
} from '@stacks/transactions';
import pool from '../db/client';
import { accountsApi, transactionsApi } from './stacks';

dotenv.config();

const STACKS_NETWORK = (process.env.STACKS_NETWORK || 'testnet') as 'mainnet' | 'testnet';
const TREASURY_ADDRESS = (process.env.STACKPAD_TREASURY_ADDRESS || process.env.SERVER_ADDRESS || '').trim();
const TREASURY_PRIVATE_KEY = (process.env.STACKPAD_TREASURY_PRIVATE_KEY || '').trim();
const AUTHOR_PAYOUT_MIN_MICROSTX = toBigIntSafe(process.env.AUTHOR_PAYOUT_MIN_MICROSTX, BigInt(1));
const AUTHOR_SETTLEMENT_TIMEOUT_MS = toNumberSafe(process.env.AUTHOR_SETTLEMENT_TIMEOUT_MS, 15 * 60_000);
const AUTHOR_SETTLEMENT_RECONCILE_LIMIT = toNumberSafe(process.env.AUTHOR_SETTLEMENT_RECONCILE_LIMIT, 50);
const AUTHOR_PAYOUT_MEMO_PREFIX = (process.env.AUTHOR_PAYOUT_MEMO_PREFIX || 'spd:auth').trim();
const AUTHOR_PAYOUT_FEE_MICROSTX = toOptionalBigInt(process.env.AUTHOR_PAYOUT_FEE_MICROSTX);

const PENDING_TX_STATUSES = new Set(['pending', 'queued', 'processing']);
const LOCK_CLASS_ID = 402;
const LOCK_OBJECT_ID = 2;

let missingConfigWarningShown = false;

interface ClaimedRevenueEvent {
    id: number;
    author_address: string;
    amount: string;
}

interface AuthorGroup {
    authorAddress: string;
    eventIds: number[];
    totalAmount: bigint;
}

interface BroadcastAttemptResult {
    ok: boolean;
    txHash?: string;
    usedNonce: bigint;
    error?: string;
    shouldRefreshNonce?: boolean;
}

interface SettlementTxState {
    status: 'pending' | 'confirmed' | 'failed';
    error?: string;
}

interface PayoutConfig {
    treasuryAddress: string;
    treasuryPrivateKey: string;
}

export async function settleAuthorPayoutBatch(limit = 500): Promise<{ eventCount: number; totalAmount: bigint }> {
    try {
        return await withSettlementAdvisoryLock(async () => {
            await reclaimStaleProcessingEvents();
            await reconcileAuthorSettlementBatches(AUTHOR_SETTLEMENT_RECONCILE_LIMIT);

            const config = resolvePayoutConfig();
            if (!config) {
                return { eventCount: 0, totalAmount: BigInt(0) };
            }

            const claimedEvents = await claimRevenueEvents(limit);
            if (claimedEvents.length === 0) {
                return { eventCount: 0, totalAmount: BigInt(0) };
            }

            const grouped = groupEventsByAuthor(claimedEvents);
            let nextNonce = await fetchNextTreasuryNonce(config.treasuryAddress);
            let eventCount = 0;
            let totalAmount = BigInt(0);

            for (const group of grouped) {
                if (!validateStacksAddress(group.authorAddress)) {
                    await markGroupFailed(group.eventIds, null, `Invalid author payout address: ${group.authorAddress}`);
                    continue;
                }

                if (group.totalAmount < AUTHOR_PAYOUT_MIN_MICROSTX) {
                    await markGroupFailed(
                        group.eventIds,
                        null,
                        `Payout amount below threshold (${AUTHOR_PAYOUT_MIN_MICROSTX.toString()} microSTX)`
                    );
                    continue;
                }

                const batchId = await createSettlementBatch(group.authorAddress, group.totalAmount, group.eventIds.length);
                await linkEventsToBatch(group.eventIds, batchId);

                const memo = buildPayoutMemo(batchId);
                let attempt = await broadcastAuthorPayout(
                    config,
                    group.authorAddress,
                    group.totalAmount,
                    nextNonce,
                    memo
                );

                if (!attempt.ok && attempt.shouldRefreshNonce) {
                    try {
                        nextNonce = await fetchNextTreasuryNonce(config.treasuryAddress);
                        attempt = await broadcastAuthorPayout(
                            config,
                            group.authorAddress,
                            group.totalAmount,
                            nextNonce,
                            memo
                        );
                    } catch (error) {
                        attempt = {
                            ok: false,
                            usedNonce: nextNonce,
                            error: error instanceof Error ? error.message : 'Failed to refresh nonce',
                        };
                    }
                }

                if (!attempt.ok || !attempt.txHash) {
                    await markGroupFailed(group.eventIds, batchId, attempt.error || 'Author payout broadcast failed');
                    continue;
                }

                await markGroupBroadcasted(group.eventIds, batchId, attempt.txHash, attempt.usedNonce);
                nextNonce = attempt.usedNonce + BigInt(1);
                eventCount += group.eventIds.length;
                totalAmount += group.totalAmount;
            }

            return { eventCount, totalAmount };
        });
    } catch (error) {
        if (error instanceof SettlementLockUnavailableError) {
            return { eventCount: 0, totalAmount: BigInt(0) };
        }
        throw error;
    }
}

export async function reconcileAuthorSettlementBatches(limit = 50): Promise<void> {
    const cappedLimit = Math.max(1, limit);
    const lookup = await pool.query(
        `SELECT id, payout_tx_hash
         FROM author_settlement_batches
         WHERE status = 'broadcasted'
           AND payout_tx_hash IS NOT NULL
         ORDER BY broadcast_at ASC NULLS LAST, created_at ASC
         LIMIT $1`,
        [cappedLimit]
    );

    for (const row of lookup.rows) {
        const batch = row as {
            id: number;
            payout_tx_hash: string;
        };
        const txState = await resolveSettlementTxState(batch.payout_tx_hash);

        if (txState.status === 'pending') {
            continue;
        }

        if (txState.status === 'confirmed') {
            await finalizeBroadcastedBatch(batch.id, batch.payout_tx_hash);
            continue;
        }

        await failBroadcastedBatch(batch.id, txState.error || 'Settlement transaction failed');
    }
}

async function withSettlementAdvisoryLock<T>(run: () => Promise<T>): Promise<T> {
    const client = await pool.connect();
    let acquired = false;
    try {
        const lockResult = await client.query('SELECT pg_try_advisory_lock($1, $2) AS acquired', [
            LOCK_CLASS_ID,
            LOCK_OBJECT_ID,
        ]);
        acquired = Boolean(lockResult.rows[0]?.acquired);
        if (!acquired) {
            throw new SettlementLockUnavailableError();
        }

        return await run();
    } finally {
        if (acquired) {
            try {
                await client.query('SELECT pg_advisory_unlock($1, $2)', [LOCK_CLASS_ID, LOCK_OBJECT_ID]);
            } catch (error) {
                console.error('Failed to release author settlement advisory lock:', error);
            }
        }
        client.release();
    }
}

class SettlementLockUnavailableError extends Error {
    constructor() {
        super('Author settlement lock is currently held by another worker');
    }
}

async function reclaimStaleProcessingEvents(): Promise<void> {
    const timeoutSeconds = AUTHOR_SETTLEMENT_TIMEOUT_MS / 1000;
    await pool.query(
        `UPDATE author_revenue_events
         SET settlement_status = 'pending',
             settlement_batch_id = NULL,
             processing_started_at = NULL,
             payout_tx_hash = NULL,
             settled = FALSE,
             settled_at = NULL,
             last_error = COALESCE(last_error, 'Settlement timed out and was requeued')
         WHERE settlement_status = 'processing'
           AND (
                settlement_batch_id IS NULL
                OR settlement_batch_id IN (
                    SELECT id
                    FROM author_settlement_batches
                    WHERE status IN ('created', 'failed')
                )
           )
           AND processing_started_at IS NOT NULL
           AND processing_started_at < NOW() - ($1::double precision * INTERVAL '1 second')`,
        [timeoutSeconds]
    );
}

async function claimRevenueEvents(limit: number): Promise<ClaimedRevenueEvent[]> {
    const safeLimit = Math.max(1, limit);
    const client = await pool.connect();
    let rolledBack = false;
    try {
        await client.query('BEGIN');

        const claimResult = await client.query(
            `WITH candidates AS (
                SELECT id
                FROM author_revenue_events
                WHERE settled = FALSE
                  AND settlement_status = 'pending'
                ORDER BY created_at ASC
                LIMIT $1
                FOR UPDATE SKIP LOCKED
            )
            UPDATE author_revenue_events ev
            SET settlement_status = 'processing',
                processing_started_at = NOW(),
                payout_attempts = ev.payout_attempts + 1,
                last_error = NULL
            FROM candidates
            WHERE ev.id = candidates.id
            RETURNING ev.id, ev.author_address, ev.amount`,
            [safeLimit]
        );

        await client.query('COMMIT');
        return claimResult.rows as ClaimedRevenueEvent[];
    } catch (error) {
        if (!rolledBack) {
            await client.query('ROLLBACK');
            rolledBack = true;
        }
        throw error;
    } finally {
        client.release();
    }
}

function groupEventsByAuthor(events: ClaimedRevenueEvent[]): AuthorGroup[] {
    const grouped = new Map<string, AuthorGroup>();

    for (const event of events) {
        const author = event.author_address.trim();
        const amount = BigInt(String(event.amount ?? '0'));

        if (!grouped.has(author)) {
            grouped.set(author, {
                authorAddress: author,
                eventIds: [],
                totalAmount: BigInt(0),
            });
        }

        const group = grouped.get(author)!;
        group.eventIds.push(Number(event.id));
        group.totalAmount += amount;
    }

    return Array.from(grouped.values());
}

async function createSettlementBatch(authorAddress: string, totalAmount: bigint, eventCount: number): Promise<number> {
    const insert = await pool.query(
        `INSERT INTO author_settlement_batches (author_address, total_amount, event_count, network, status)
         VALUES ($1, $2, $3, $4, 'created')
         RETURNING id`,
        [authorAddress, totalAmount.toString(), eventCount, toCaip2Network(STACKS_NETWORK)]
    );

    return Number(insert.rows[0].id);
}

async function linkEventsToBatch(eventIds: number[], batchId: number): Promise<void> {
    await pool.query(
        `UPDATE author_revenue_events
         SET settlement_batch_id = $2
         WHERE id = ANY($1::int[])`,
        [eventIds, batchId]
    );
}

async function broadcastAuthorPayout(
    config: PayoutConfig,
    authorAddress: string,
    amount: bigint,
    nonce: bigint,
    memo: string
): Promise<BroadcastAttemptResult> {
    try {
        const transferOptions: {
            recipient: string;
            amount: bigint;
            senderKey: string;
            network: 'mainnet' | 'testnet';
            nonce: bigint;
            anchorMode: 'any';
            memo: string;
            fee?: bigint;
        } = {
            recipient: authorAddress,
            amount,
            senderKey: config.treasuryPrivateKey,
            network: STACKS_NETWORK,
            nonce,
            anchorMode: 'any',
            memo,
        };

        if (AUTHOR_PAYOUT_FEE_MICROSTX !== null) {
            transferOptions.fee = AUTHOR_PAYOUT_FEE_MICROSTX;
        }

        const transaction = await makeSTXTokenTransfer(transferOptions);
        const broadcast = await broadcastTransaction(transaction, STACKS_NETWORK);

        if (isBroadcastSuccess(broadcast)) {
            return {
                ok: true,
                txHash: normalizeTxHash(broadcast.txid),
                usedNonce: nonce,
            };
        }

        const error = formatBroadcastError(broadcast);
        return {
            ok: false,
            usedNonce: nonce,
            error,
            shouldRefreshNonce: isNonceConflict(error),
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to broadcast payout transaction';
        return {
            ok: false,
            usedNonce: nonce,
            error: message,
            shouldRefreshNonce: isNonceConflict(message),
        };
    }
}

async function fetchNextTreasuryNonce(treasuryAddress: string): Promise<bigint> {
    const nonces = await accountsApi.getAccountNonces({ principal: treasuryAddress });
    return BigInt(nonces.possible_next_nonce);
}

async function markGroupBroadcasted(
    eventIds: number[],
    batchId: number,
    txHash: string,
    nonce: bigint
): Promise<void> {
    const client = await pool.connect();
    let rolledBack = false;
    try {
        await client.query('BEGIN');
        await client.query(
            `UPDATE author_settlement_batches
             SET status = 'broadcasted',
                 payout_tx_hash = $2,
                 nonce = $3,
                 last_error = NULL,
                 broadcast_at = NOW()
             WHERE id = $1`,
            [batchId, txHash, nonce.toString()]
        );
        await client.query(
            `UPDATE author_revenue_events
             SET payout_tx_hash = $2,
                 last_error = NULL
             WHERE id = ANY($1::int[])`,
            [eventIds, txHash]
        );
        await client.query('COMMIT');
    } catch (error) {
        if (!rolledBack) {
            await client.query('ROLLBACK');
            rolledBack = true;
        }
        throw error;
    } finally {
        client.release();
    }
}

async function markGroupFailed(eventIds: number[], batchId: number | null, reason: string): Promise<void> {
    const client = await pool.connect();
    let rolledBack = false;
    try {
        await client.query('BEGIN');

        if (batchId !== null) {
            await client.query(
                `UPDATE author_settlement_batches
                 SET status = 'failed',
                     last_error = $2
                 WHERE id = $1`,
                [batchId, reason]
            );
        }

        await client.query(
            `UPDATE author_revenue_events
             SET settlement_status = 'pending',
                 settlement_batch_id = NULL,
                 processing_started_at = NULL,
                 payout_tx_hash = NULL,
                 settled = FALSE,
                 settled_at = NULL,
                 last_error = $2
             WHERE id = ANY($1::int[])`,
            [eventIds, reason]
        );

        await client.query('COMMIT');
    } catch (error) {
        if (!rolledBack) {
            await client.query('ROLLBACK');
            rolledBack = true;
        }
        throw error;
    } finally {
        client.release();
    }
}

async function finalizeBroadcastedBatch(batchId: number, txHash: string): Promise<void> {
    const client = await pool.connect();
    let rolledBack = false;
    try {
        await client.query('BEGIN');
        await client.query(
            `UPDATE author_settlement_batches
             SET status = 'confirmed',
                 confirmed_at = NOW(),
                 last_error = NULL
             WHERE id = $1`,
            [batchId]
        );
        await client.query(
            `UPDATE author_revenue_events
             SET settlement_status = 'settled',
                 settled = TRUE,
                 settled_at = NOW(),
                 processing_started_at = NULL,
                 payout_tx_hash = $2,
                 last_error = NULL
             WHERE settlement_batch_id = $1
               AND settlement_status = 'processing'`,
            [batchId, txHash]
        );
        await client.query('COMMIT');
    } catch (error) {
        if (!rolledBack) {
            await client.query('ROLLBACK');
            rolledBack = true;
        }
        throw error;
    } finally {
        client.release();
    }
}

async function failBroadcastedBatch(batchId: number, reason: string): Promise<void> {
    const client = await pool.connect();
    let rolledBack = false;
    try {
        await client.query('BEGIN');
        await client.query(
            `UPDATE author_settlement_batches
             SET status = 'failed',
                 last_error = $2
             WHERE id = $1`,
            [batchId, reason]
        );
        await client.query(
            `UPDATE author_revenue_events
             SET settlement_status = 'pending',
                 settlement_batch_id = NULL,
                 payout_tx_hash = NULL,
                 processing_started_at = NULL,
                 settled = FALSE,
                 settled_at = NULL,
                 last_error = $2
             WHERE settlement_batch_id = $1
               AND settlement_status = 'processing'`,
            [batchId, reason]
        );
        await client.query('COMMIT');
    } catch (error) {
        if (!rolledBack) {
            await client.query('ROLLBACK');
            rolledBack = true;
        }
        throw error;
    } finally {
        client.release();
    }
}

async function resolveSettlementTxState(txHash: string): Promise<SettlementTxState> {
    try {
        const tx = await transactionsApi.getTransactionById({ txId: normalizeTxHash(txHash) }) as Record<string, unknown>;
        const status = String(tx.tx_status ?? '');
        if (status === 'success') {
            return { status: 'confirmed' };
        }
        if (PENDING_TX_STATUSES.has(status)) {
            return { status: 'pending' };
        }
        return {
            status: 'failed',
            error: `payout_tx_failed:${status || 'unknown'}`,
        };
    } catch (error) {
        return {
            status: 'pending',
            error: error instanceof Error ? error.message : 'Failed to fetch payout transaction status',
        };
    }
}

function resolvePayoutConfig(): PayoutConfig | null {
    if (!TREASURY_ADDRESS || !TREASURY_PRIVATE_KEY) {
        if (!missingConfigWarningShown) {
            console.warn(
                'Author payout broadcaster disabled: set STACKPAD_TREASURY_ADDRESS and STACKPAD_TREASURY_PRIVATE_KEY to enable on-chain author payouts.'
            );
            missingConfigWarningShown = true;
        }
        return null;
    }

    const normalizedPrivateKey = normalizePrivateKey(TREASURY_PRIVATE_KEY);
    const txVersion = STACKS_NETWORK === 'mainnet'
        ? TransactionVersion.Mainnet
        : TransactionVersion.Testnet;
    const derivedAddress = getAddressFromPrivateKey(normalizedPrivateKey, txVersion);
    if (!isSameAddress(derivedAddress, TREASURY_ADDRESS)) {
        throw new Error(
            `Treasury key/address mismatch: STACKPAD_TREASURY_PRIVATE_KEY derives ${derivedAddress}, expected ${TREASURY_ADDRESS}`
        );
    }

    if (!validateStacksAddress(TREASURY_ADDRESS)) {
        throw new Error(`Invalid STACKPAD_TREASURY_ADDRESS: ${TREASURY_ADDRESS}`);
    }

    return {
        treasuryAddress: TREASURY_ADDRESS,
        treasuryPrivateKey: normalizedPrivateKey,
    };
}

function normalizePrivateKey(privateKey: string): string {
    const trimmed = privateKey.trim();
    if (!trimmed) {
        throw new Error('Treasury private key is required');
    }
    return trimmed.startsWith('0x') || trimmed.startsWith('0X')
        ? trimmed.slice(2)
        : trimmed;
}

function buildPayoutMemo(batchId: number): string {
    const fallbackPrefix = 'spd:auth';
    const prefix = AUTHOR_PAYOUT_MEMO_PREFIX || fallbackPrefix;
    const raw = `${prefix}:${batchId}`;
    const maxBytes = 34;
    return raw.length <= maxBytes ? raw : raw.slice(0, maxBytes);
}

function isBroadcastSuccess(value: unknown): value is { txid: string } {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return typeof candidate.txid === 'string' && candidate.txid.length > 0;
}

function formatBroadcastError(value: unknown): string {
    if (!value || typeof value !== 'object') {
        return 'Unknown broadcast rejection';
    }
    const candidate = value as Record<string, unknown>;
    const parts = [
        asString(candidate.error),
        asString(candidate.reason),
        asString(candidate.reason_data),
    ].filter((item): item is string => Boolean(item && item.trim()));
    return parts.length > 0 ? parts.join(' | ') : 'Transaction broadcast rejected';
}

function isNonceConflict(error: string): boolean {
    const normalized = error.toLowerCase();
    return normalized.includes('conflictingnonce')
        || normalized.includes('conflicting nonce')
        || normalized.includes('bad nonce')
        || normalized.includes('nonce');
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function normalizeTxHash(value: string): string {
    const trimmed = value.trim();
    return trimmed.startsWith('0x') || trimmed.startsWith('0X')
        ? trimmed.slice(2)
        : trimmed;
}

function isSameAddress(a: string, b: string): boolean {
    return a.trim().toUpperCase() === b.trim().toUpperCase();
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
        return parsed >= BigInt(0) ? parsed : fallback;
    } catch {
        return fallback;
    }
}

function toOptionalBigInt(value: string | undefined): bigint | null {
    if (!value) {
        return null;
    }
    try {
        const parsed = BigInt(value);
        return parsed >= BigInt(0) ? parsed : null;
    } catch {
        return null;
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
