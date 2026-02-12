import type { QueryResult } from 'pg';
import pool from '../db/client';
import { transactionsApi } from './stacks';

export type BundleType = 'single-page' | 'next-5-pages' | 'next-10-percent' | 'chapter';

export interface ReaderBalance {
    readerAddress: string;
    availableBalance: bigint;
    totalDeposited: bigint;
    totalSpent: bigint;
}

export interface UnlockOption {
    bundleType: BundleType;
    label: string;
    description: string;
    startPage: number;
    endPage: number;
    chapterNumber?: number;
    pageCount: number;
    amount: bigint;
    remainingPages: number;
    effectiveAmount: bigint;
    fullyUnlocked: boolean;
}

export interface UnlockPreview {
    bookId: number;
    pageNumber: number;
    balance: ReaderBalance;
    options: UnlockOption[];
    suggestedTopUp: bigint;
}

export interface UnlockPurchaseResult {
    success: boolean;
    alreadyUnlocked: boolean;
    balance: ReaderBalance;
    bundleType: BundleType;
    debitedAmount: bigint;
    unlockedRange?: {
        startPage: number;
        endPage: number;
        chapterNumber?: number;
        pagesUnlocked: number;
    };
}

export interface DepositClaimResult {
    success: boolean;
    amount: bigint;
    balance: ReaderBalance;
    txHash: string;
    readerAddress: string;
}

interface Queryable {
    query: (text: string, params?: unknown[]) => Promise<QueryResult>;
}

interface BookPricingContext {
    bookId: number;
    pageNumber: number;
    totalPages: number;
    pagePrice: bigint;
    chapterPrice: bigint;
    chapterNumber?: number;
    chapterStartPage?: number;
    chapterEndPage?: number;
}

const READING_WALLET_ADDRESS = process.env.READING_WALLET_ADDRESS || process.env.READING_WALLET_CONTRACT || '';

export async function getReaderBalance(readerAddress: string, db: Queryable = pool): Promise<ReaderBalance> {
    const normalizedAddress = readerAddress.trim();
    await db.query(
        `INSERT INTO reader_balances (reader_address)
         VALUES ($1)
         ON CONFLICT (reader_address) DO NOTHING`,
        [normalizedAddress]
    );

    const result = await db.query(
        `SELECT reader_address, available_balance, total_deposited, total_spent
         FROM reader_balances
         WHERE reader_address = $1`,
        [normalizedAddress]
    );

    const row = result.rows[0] as {
        reader_address: string;
        available_balance: string;
        total_deposited: string;
        total_spent: string;
    };

    return {
        readerAddress: row.reader_address,
        availableBalance: BigInt(row.available_balance),
        totalDeposited: BigInt(row.total_deposited),
        totalSpent: BigInt(row.total_spent),
    };
}

export async function hasReaderEntitlement(
    readerAddress: string,
    bookId: number,
    pageNumber: number
): Promise<boolean> {
    const entitlementResult = await pool.query(
        `SELECT 1
         FROM unlock_entitlements
         WHERE reader_address = $1
           AND book_id = $2
           AND $3 BETWEEN start_page AND end_page
         LIMIT 1`,
        [readerAddress, bookId, pageNumber]
    );

    if (entitlementResult.rows.length > 0) {
        return true;
    }

    const legacyResult = await pool.query(
        `SELECT 1
         FROM payment_logs pl
         LEFT JOIN pages p
           ON p.book_id = pl.book_id
          AND p.page_number = $3
         WHERE pl.reader_address = $1
           AND pl.book_id = $2
           AND (
             pl.page_number = $3
             OR (
               pl.chapter_number IS NOT NULL
               AND p.chapter_number IS NOT NULL
               AND pl.chapter_number = p.chapter_number
             )
           )
         LIMIT 1`,
        [readerAddress, bookId, pageNumber]
    );

    return legacyResult.rows.length > 0;
}

export async function getUnlockPreview(
    readerAddress: string,
    bookId: number,
    pageNumber: number
): Promise<UnlockPreview> {
    const context = await getBookPricingContext(pool, bookId, pageNumber);
    const balance = await getReaderBalance(readerAddress);

    const baseOptions = buildBaseUnlockOptions(context);
    const options = await Promise.all(baseOptions.map(async (option) => {
        const remainingPages = await countRemainingPages(readerAddress, bookId, option.startPage, option.endPage);
        const effectiveAmount = prorate(option.amount, option.pageCount, remainingPages);

        return {
            ...option,
            remainingPages,
            effectiveAmount,
            fullyUnlocked: remainingPages === 0,
        } as UnlockOption;
    }));

    const payable = options.filter((option) => option.remainingPages > 0);
    const cheapest = payable.reduce<bigint | null>((min, option) => {
        if (min === null || option.effectiveAmount < min) {
            return option.effectiveAmount;
        }
        return min;
    }, null);

    const suggestedTopUp = cheapest && cheapest > balance.availableBalance
        ? cheapest - balance.availableBalance
        : 0n;

    return {
        bookId,
        pageNumber,
        balance,
        options,
        suggestedTopUp,
    };
}

export async function purchaseUnlockBundle(
    readerAddress: string,
    bookId: number,
    pageNumber: number,
    bundleType: BundleType
): Promise<UnlockPurchaseResult> {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const context = await getBookPricingContext(client, bookId, pageNumber);
        const baseOptions = buildBaseUnlockOptions(context);
        const option = baseOptions.find((candidate) => candidate.bundleType === bundleType);

        if (!option) {
            throw new Error('Invalid unlock bundle');
        }

        const lockResult = await client.query(
            `INSERT INTO reader_balances (reader_address)
             VALUES ($1)
             ON CONFLICT (reader_address) DO NOTHING`,
            [readerAddress]
        );
        void lockResult;

        const balanceRow = await client.query(
            `SELECT available_balance, total_deposited, total_spent
             FROM reader_balances
             WHERE reader_address = $1
             FOR UPDATE`,
            [readerAddress]
        );

        if (balanceRow.rows.length === 0) {
            throw new Error('Reader balance not found');
        }

        const currentBalance = BigInt(String(balanceRow.rows[0].available_balance));
        const totalDeposited = BigInt(String(balanceRow.rows[0].total_deposited));
        const totalSpent = BigInt(String(balanceRow.rows[0].total_spent));

        const pagesResult = await client.query(
            `SELECT page_number, chapter_number
             FROM pages
             WHERE book_id = $1
               AND page_number BETWEEN $2 AND $3
             ORDER BY page_number ASC`,
            [bookId, option.startPage, option.endPage]
        );

        if (pagesResult.rows.length === 0) {
            throw new Error('No pages found for selected bundle');
        }

        const unlockedRows = await client.query(
            `SELECT p.page_number
             FROM pages p
             WHERE p.book_id = $2
               AND p.page_number BETWEEN $3 AND $4
               AND (
                   EXISTS (
                     SELECT 1
                     FROM unlock_entitlements ue
                     WHERE ue.reader_address = $1
                       AND ue.book_id = p.book_id
                       AND p.page_number BETWEEN ue.start_page AND ue.end_page
                   )
                   OR EXISTS (
                     SELECT 1
                     FROM payment_logs pl
                     WHERE pl.reader_address = $1
                       AND pl.book_id = p.book_id
                       AND (
                         pl.page_number = p.page_number
                         OR (pl.chapter_number IS NOT NULL AND pl.chapter_number = p.chapter_number)
                       )
                   )
               )`,
            [readerAddress, bookId, option.startPage, option.endPage]
        );

        const unlockedSet = new Set(unlockedRows.rows.map((row) => Number(row.page_number)));
        const allPages = pagesResult.rows.map((row) => Number(row.page_number));
        const pagesToUnlock = allPages.filter((candidate) => !unlockedSet.has(candidate));

        if (pagesToUnlock.length === 0) {
            await client.query('ROLLBACK');
            return {
                success: true,
                alreadyUnlocked: true,
                bundleType,
                debitedAmount: 0n,
                balance: {
                    readerAddress,
                    availableBalance: currentBalance,
                    totalDeposited,
                    totalSpent,
                },
                unlockedRange: {
                    startPage: option.startPage,
                    endPage: option.endPage,
                    chapterNumber: option.chapterNumber,
                    pagesUnlocked: 0,
                },
            };
        }

        const effectiveAmount = prorate(option.amount, option.pageCount, pagesToUnlock.length);

        if (effectiveAmount > currentBalance) {
            await client.query('ROLLBACK');
            throw new Error('INSUFFICIENT_BALANCE');
        }

        const updatedAvailable = currentBalance - effectiveAmount;
        const updatedSpent = totalSpent + effectiveAmount;

        await client.query(
            `UPDATE reader_balances
             SET available_balance = $2,
                 total_spent = $3,
                 updated_at = NOW()
             WHERE reader_address = $1`,
            [readerAddress, updatedAvailable.toString(), updatedSpent.toString()]
        );

        const rangeStart = Math.min(...pagesToUnlock);
        const rangeEnd = Math.max(...pagesToUnlock);

        const ledgerResult = await client.query(
            `INSERT INTO balance_ledger (
                reader_address,
                delta,
                reason,
                book_id,
                page_number,
                chapter_number,
                bundle_type,
                metadata
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
            [
                readerAddress,
                (-effectiveAmount).toString(),
                'bundle_unlock',
                bookId,
                pageNumber,
                option.chapterNumber || null,
                bundleType,
                JSON.stringify({
                    startPage: option.startPage,
                    endPage: option.endPage,
                    unlockedStartPage: rangeStart,
                    unlockedEndPage: rangeEnd,
                    pagesUnlocked: pagesToUnlock.length,
                }),
            ]
        );

        const sourceLedgerId = Number(ledgerResult.rows[0].id);

        const entitlementResult = await client.query(
            `INSERT INTO unlock_entitlements (
                reader_address,
                book_id,
                start_page,
                end_page,
                chapter_number,
                bundle_type,
                cost,
                source_ledger_id
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
            [
                readerAddress,
                bookId,
                rangeStart,
                rangeEnd,
                option.chapterNumber || null,
                bundleType,
                effectiveAmount.toString(),
                sourceLedgerId,
            ]
        );

        const entitlementId = Number(entitlementResult.rows[0].id);
        const chapterRows = await client.query(
            `SELECT page_number, chapter_number
             FROM pages
             WHERE book_id = $1
               AND page_number = ANY($2::int[])`,
            [bookId, pagesToUnlock]
        );

        const baseRevenue = effectiveAmount / BigInt(pagesToUnlock.length);
        let remainder = effectiveAmount % BigInt(pagesToUnlock.length);

        for (const row of chapterRows.rows as Array<{ page_number: number; chapter_number: number | null }>) {
            let allocation = baseRevenue;
            if (remainder > 0n) {
                allocation += 1n;
                remainder -= 1n;
            }

            await client.query(
                `INSERT INTO reading_events (
                    reader_address,
                    book_id,
                    page_number,
                    chapter_number,
                    event_type,
                    revenue_amount,
                    unlock_entitlement_id
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    readerAddress,
                    bookId,
                    row.page_number,
                    row.chapter_number,
                    'unlock',
                    allocation.toString(),
                    entitlementId,
                ]
            );
        }

        await client.query('COMMIT');

        return {
            success: true,
            alreadyUnlocked: false,
            bundleType,
            debitedAmount: effectiveAmount,
            balance: {
                readerAddress,
                availableBalance: updatedAvailable,
                totalDeposited,
                totalSpent: updatedSpent,
            },
            unlockedRange: {
                startPage: rangeStart,
                endPage: rangeEnd,
                chapterNumber: option.chapterNumber,
                pagesUnlocked: pagesToUnlock.length,
            },
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export async function claimDeposit(
    txHash: string,
    readerAddressHint?: string
): Promise<DepositClaimResult> {
    if (!READING_WALLET_ADDRESS) {
        throw new Error('READING_WALLET_ADDRESS is not configured');
    }

    const normalizedHash = normalizeTxHash(txHash);
    const txResponse = await transactionsApi.getTransactionById({ txId: normalizedHash });
    const tx = txResponse as Record<string, unknown>;

    if (!txResponse || tx.tx_status !== 'success') {
        throw new Error(`Deposit transaction is not confirmed (${String(tx.tx_status || 'unknown')})`);
    }

    if (tx.tx_type !== 'token_transfer') {
        throw new Error('Deposit transaction must be an STX token transfer');
    }

    const tokenTransfer = (tx.token_transfer || {}) as Record<string, unknown>;
    const recipient = String(tokenTransfer.recipient_address || '');
    const sender = String(tx.sender_address || '');
    const amount = BigInt(String(tokenTransfer.amount || '0'));

    if (!sender) {
        throw new Error('Could not determine deposit sender');
    }

    if (recipient !== READING_WALLET_ADDRESS) {
        throw new Error('Deposit recipient does not match configured reading wallet address');
    }

    if (amount <= 0n) {
        throw new Error('Deposit amount must be greater than zero');
    }

    if (readerAddressHint && readerAddressHint.trim() !== sender) {
        throw new Error('Deposit can only be claimed by the sending wallet address');
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const existingLedger = await client.query(
            `SELECT id
             FROM balance_ledger
             WHERE reference_tx_hash = $1
             LIMIT 1`,
            [normalizedHash]
        );

        if (existingLedger.rows.length > 0) {
            const balance = await getReaderBalance(sender, client);
            await client.query('COMMIT');
            return {
                success: true,
                amount,
                balance,
                txHash: normalizedHash,
                readerAddress: sender,
            };
        }

        await client.query(
            `INSERT INTO reader_balances (reader_address)
             VALUES ($1)
             ON CONFLICT (reader_address) DO NOTHING`,
            [sender]
        );

        const balanceResult = await client.query(
            `SELECT available_balance, total_deposited, total_spent
             FROM reader_balances
             WHERE reader_address = $1
             FOR UPDATE`,
            [sender]
        );

        if (balanceResult.rows.length === 0) {
            throw new Error('Failed to load reader balance');
        }

        const currentAvailable = BigInt(String(balanceResult.rows[0].available_balance));
        const currentDeposited = BigInt(String(balanceResult.rows[0].total_deposited));
        const currentSpent = BigInt(String(balanceResult.rows[0].total_spent));

        const newAvailable = currentAvailable + amount;
        const newDeposited = currentDeposited + amount;

        await client.query(
            `UPDATE reader_balances
             SET available_balance = $2,
                 total_deposited = $3,
                 updated_at = NOW()
             WHERE reader_address = $1`,
            [sender, newAvailable.toString(), newDeposited.toString()]
        );

        await client.query(
            `INSERT INTO balance_ledger (
                reader_address,
                delta,
                reason,
                reference_tx_hash,
                metadata
             ) VALUES ($1, $2, $3, $4, $5)`,
            [
                sender,
                amount.toString(),
                'deposit_claim',
                normalizedHash,
                JSON.stringify({ source: 'stacks-token-transfer' }),
            ]
        );

        await client.query('COMMIT');

        return {
            success: true,
            amount,
            txHash: normalizedHash,
            readerAddress: sender,
            balance: {
                readerAddress: sender,
                availableBalance: newAvailable,
                totalDeposited: newDeposited,
                totalSpent: currentSpent,
            },
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export async function createWithdrawalRequest(
    readerAddress: string,
    amount: bigint
): Promise<{ requestId: number; balance: ReaderBalance }> {
    if (amount <= 0n) {
        throw new Error('Withdrawal amount must be greater than zero');
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const balance = await getReaderBalance(readerAddress, client);

        if (amount > balance.availableBalance) {
            throw new Error('INSUFFICIENT_BALANCE');
        }

        const updatedBalance = balance.availableBalance - amount;

        await client.query(
            `UPDATE reader_balances
             SET available_balance = $2,
                 updated_at = NOW()
             WHERE reader_address = $1`,
            [readerAddress, updatedBalance.toString()]
        );

        await client.query(
            `INSERT INTO balance_ledger (reader_address, delta, reason, metadata)
             VALUES ($1, $2, $3, $4)`,
            [readerAddress, (-amount).toString(), 'withdraw_request', JSON.stringify({ amount: amount.toString() })]
        );

        const requestResult = await client.query(
            `INSERT INTO withdrawal_requests (reader_address, amount)
             VALUES ($1, $2)
             RETURNING id`,
            [readerAddress, amount.toString()]
        );

        await client.query('COMMIT');

        return {
            requestId: Number(requestResult.rows[0].id),
            balance: {
                ...balance,
                availableBalance: updatedBalance,
            },
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export async function markWithdrawalProcessed(requestId: number, txHash: string): Promise<void> {
    const result = await pool.query(
        `UPDATE withdrawal_requests
         SET status = 'processed',
             tx_hash = $2,
             processed_at = NOW()
         WHERE id = $1
           AND status = 'pending'`,
        [requestId, normalizeTxHash(txHash)]
    );

    if (result.rowCount === 0) {
        throw new Error('Withdrawal request not found or already processed');
    }
}

export async function recordPageView(
    readerAddress: string,
    bookId: number,
    pageNumber: number
): Promise<void> {
    const pageResult = await pool.query(
        `SELECT chapter_number
         FROM pages
         WHERE book_id = $1
           AND page_number = $2`,
        [bookId, pageNumber]
    );

    const chapterNumber = pageResult.rows[0]?.chapter_number as number | null | undefined;

    await pool.query(
        `INSERT INTO reading_events (
            reader_address,
            book_id,
            page_number,
            chapter_number,
            event_type,
            revenue_amount
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [readerAddress, bookId, pageNumber, chapterNumber || null, 'view', '0']
    );
}

export async function getReadingWalletAddress(): Promise<string> {
    return READING_WALLET_ADDRESS;
}

async function getBookPricingContext(db: Queryable, bookId: number, pageNumber: number): Promise<BookPricingContext> {
    const bookResult = await db.query(
        `SELECT id, total_pages, page_price, chapter_price
         FROM books
         WHERE id = $1`,
        [bookId]
    );

    if (bookResult.rows.length === 0) {
        throw new Error('Book not found');
    }

    const book = bookResult.rows[0] as {
        id: number;
        total_pages: number;
        page_price: string;
        chapter_price: string;
    };

    const pageResult = await db.query(
        `SELECT chapter_number
         FROM pages
         WHERE book_id = $1
           AND page_number = $2`,
        [bookId, pageNumber]
    );

    if (pageResult.rows.length === 0) {
        throw new Error('Page not found');
    }

    const chapterNumber = pageResult.rows[0].chapter_number as number | null;

    const context: BookPricingContext = {
        bookId: book.id,
        pageNumber,
        totalPages: Number(book.total_pages),
        pagePrice: BigInt(book.page_price),
        chapterPrice: BigInt(book.chapter_price),
        chapterNumber: chapterNumber ?? undefined,
    };

    if (chapterNumber !== null && chapterNumber !== undefined) {
        const chapterRange = await db.query(
            `SELECT MIN(page_number) AS start_page,
                    MAX(page_number) AS end_page
             FROM pages
             WHERE book_id = $1
               AND chapter_number = $2`,
            [bookId, chapterNumber]
        );

        if (chapterRange.rows.length > 0 && chapterRange.rows[0].start_page) {
            context.chapterStartPage = Number(chapterRange.rows[0].start_page);
            context.chapterEndPage = Number(chapterRange.rows[0].end_page);
        }
    }

    return context;
}

function buildBaseUnlockOptions(context: BookPricingContext): Array<Omit<UnlockOption, 'remainingPages' | 'effectiveAmount' | 'fullyUnlocked'>> {
    const { pageNumber, totalPages, pagePrice, chapterPrice } = context;

    const nextFiveEnd = Math.min(totalPages, pageNumber + 4);
    const nextFiveCount = nextFiveEnd - pageNumber + 1;

    const tenPercentWindow = Math.max(1, Math.ceil(totalPages * 0.1));
    const tenPercentEnd = Math.min(totalPages, pageNumber + tenPercentWindow - 1);
    const tenPercentCount = tenPercentEnd - pageNumber + 1;

    const options: Array<Omit<UnlockOption, 'remainingPages' | 'effectiveAmount' | 'fullyUnlocked'>> = [
        {
            bundleType: 'single-page',
            label: 'Unlock this page',
            description: 'Smallest unlock, immediate continuation.',
            startPage: pageNumber,
            endPage: pageNumber,
            pageCount: 1,
            amount: pagePrice,
        },
        {
            bundleType: 'next-5-pages',
            label: 'Unlock next 5 pages',
            description: 'Recommended for smoother reading flow.',
            startPage: pageNumber,
            endPage: nextFiveEnd,
            pageCount: nextFiveCount,
            amount: applyDiscount(pagePrice * BigInt(nextFiveCount), 95),
        },
        {
            bundleType: 'next-10-percent',
            label: 'Unlock next 10% of book',
            description: 'Best value for deep reading sessions.',
            startPage: pageNumber,
            endPage: tenPercentEnd,
            pageCount: tenPercentCount,
            amount: applyDiscount(pagePrice * BigInt(tenPercentCount), 90),
        },
    ];

    if (
        context.chapterNumber !== undefined
        && context.chapterStartPage !== undefined
        && context.chapterEndPage !== undefined
        && context.chapterEndPage >= context.chapterStartPage
    ) {
        options.push({
            bundleType: 'chapter',
            label: 'Unlock full chapter',
            description: 'One purchase for the rest of this chapter.',
            startPage: context.chapterStartPage,
            endPage: context.chapterEndPage,
            chapterNumber: context.chapterNumber,
            pageCount: context.chapterEndPage - context.chapterStartPage + 1,
            amount: chapterPrice,
        });
    }

    return dedupeOptions(options);
}

function dedupeOptions(options: Array<Omit<UnlockOption, 'remainingPages' | 'effectiveAmount' | 'fullyUnlocked'>>): Array<Omit<UnlockOption, 'remainingPages' | 'effectiveAmount' | 'fullyUnlocked'>> {
    const seen = new Set<string>();

    return options.filter((option) => {
        const key = `${option.bundleType}:${option.startPage}:${option.endPage}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

async function countRemainingPages(
    readerAddress: string,
    bookId: number,
    startPage: number,
    endPage: number
): Promise<number> {
    const totalResult = await pool.query(
        `SELECT COUNT(*)::int AS total
         FROM pages
         WHERE book_id = $1
           AND page_number BETWEEN $2 AND $3`,
        [bookId, startPage, endPage]
    );

    const total = Number(totalResult.rows[0]?.total || 0);
    if (total === 0) {
        return 0;
    }

    const unlockedResult = await pool.query(
        `SELECT COUNT(*)::int AS unlocked
         FROM pages p
         WHERE p.book_id = $2
           AND p.page_number BETWEEN $3 AND $4
           AND (
               EXISTS (
                   SELECT 1
                   FROM unlock_entitlements ue
                   WHERE ue.reader_address = $1
                     AND ue.book_id = p.book_id
                     AND p.page_number BETWEEN ue.start_page AND ue.end_page
               )
               OR EXISTS (
                   SELECT 1
                   FROM payment_logs pl
                   WHERE pl.reader_address = $1
                     AND pl.book_id = p.book_id
                     AND (
                       pl.page_number = p.page_number
                       OR (pl.chapter_number IS NOT NULL AND pl.chapter_number = p.chapter_number)
                     )
               )
           )`,
        [readerAddress, bookId, startPage, endPage]
    );

    const unlocked = Number(unlockedResult.rows[0]?.unlocked || 0);
    return Math.max(0, total - unlocked);
}

function applyDiscount(amount: bigint, percent: number): bigint {
    return (amount * BigInt(percent)) / 100n;
}

function prorate(totalAmount: bigint, totalPages: number, remainingPages: number): bigint {
    if (remainingPages <= 0) {
        return 0n;
    }

    if (remainingPages >= totalPages) {
        return totalAmount;
    }

    const numerator = totalAmount * BigInt(remainingPages);
    const denominator = BigInt(totalPages);

    return (numerator + denominator - 1n) / denominator;
}

function normalizeTxHash(value: string): string {
    const trimmed = value.trim();
    if (trimmed.startsWith('0x')) {
        return trimmed;
    }
    return `0x${trimmed}`;
}
