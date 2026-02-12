import { transactionsApi } from './stacks';
import pool from '../db/client';
import { parsePaymentMemo } from '@stackpad/x402-client';

export interface PaymentVerificationResult {
    valid: boolean;
    readerAddress?: string;
    bookId?: number;
    pageNumber?: number;
    chapterNumber?: number;
    amount?: bigint;
    alreadyRecorded?: boolean;
    error?: string;
}

/**
 * Verify a payment transaction on the Stacks blockchain
 */
export async function verifyPayment(
    txHash: string,
    expectedBookId: number,
    expectedPageNumber?: number,
    expectedChapterNumber?: number,
    expectedRecipient?: string,
    expectedAmount?: bigint
): Promise<PaymentVerificationResult> {
    try {
        // Fetch transaction from Stacks blockchain
        const txResponse = await transactionsApi.getTransactionById({ txId: txHash });
        const tx = txResponse as Record<string, unknown>;
        const txStatus = tx.tx_status;
        const txType = tx.tx_type;

        // Check if transaction exists and is complete
        if (!txResponse || txStatus !== 'success') {
            const statusString = typeof txStatus === 'string' ? txStatus : 'unknown';
            const pendingStatuses = new Set(['pending', 'queued', 'processing']);
            return {
                valid: false,
                error: pendingStatuses.has(statusString)
                    ? `transaction_pending:${statusString}`
                    : `transaction_not_confirmed:${statusString}`,
            };
        }

        // Verify it's an STX transfer or contract call
        if (txType !== 'token_transfer' && txType !== 'contract_call') {
            return {
                valid: false,
                error: 'Invalid transaction type',
            };
        }

        let senderAddress: string;
        let amount: bigint;
        let memo: string | undefined;

        if (txType === 'token_transfer') {
            const tokenTransfer = tx.token_transfer as Record<string, unknown> | undefined;
            senderAddress = String(tx.sender_address ?? '');
            amount = BigInt(String(tokenTransfer?.amount ?? '0'));
            memo = typeof tokenTransfer?.memo === 'string' ? tokenTransfer.memo : undefined;

            if (!senderAddress || !tokenTransfer) {
                return {
                    valid: false,
                    error: 'Transaction payload missing required fields',
                };
            }

            if (expectedRecipient) {
                const recipient = String(tokenTransfer.recipient_address ?? '');
                if (recipient !== expectedRecipient) {
                    return {
                        valid: false,
                        error: 'Payment recipient does not match book author',
                    };
                }
            }

            if (expectedAmount !== undefined && amount < expectedAmount) {
                return {
                    valid: false,
                    error: 'Payment amount is below required price',
                };
            }
        } else {
            // Handle contract call (e.g., unlock-page call)
            senderAddress = String(tx.sender_address ?? '');
            // For contract calls, we'd need to parse the function args
            // For now, we'll assume token transfer is the primary flow
            return {
                valid: false,
                error: 'Contract call verification not yet implemented',
            };
        }

        // Parse memo to extract book/page/chapter info
        const normalizedMemo = memo ? memo.replace(/\u0000/g, '').trim() : '';
        const parsedMemo = normalizedMemo ? parsePaymentMemo(normalizedMemo) : null;

        if (!parsedMemo || parsedMemo.bookId !== expectedBookId) {
            return {
                valid: false,
                error: 'Payment memo does not match expected book',
            };
        }

        // Verify page or chapter number matches
        if (expectedPageNumber !== undefined && parsedMemo.pageNumber !== expectedPageNumber) {
            return {
                valid: false,
                error: 'Payment memo does not match expected page',
            };
        }

        if (expectedChapterNumber !== undefined && parsedMemo.chapterNumber !== expectedChapterNumber) {
            return {
                valid: false,
                error: 'Payment memo does not match expected chapter',
            };
        }

        // Check if payment has already been processed
        const existingPayment = await pool.query(
            `SELECT reader_address, book_id, page_number, chapter_number, amount
             FROM payment_logs
             WHERE tx_hash = $1`,
            [txHash]
        );

        if (existingPayment.rows.length > 0) {
            const existing = existingPayment.rows[0] as {
                reader_address: string;
                book_id: number;
                page_number: number | null;
                chapter_number: number | null;
                amount: string;
            };

            const hasExpectedPage = expectedPageNumber !== undefined
                ? existing.page_number === expectedPageNumber
                : existing.page_number === null;

            const hasExpectedChapter = expectedChapterNumber !== undefined
                ? existing.chapter_number === expectedChapterNumber
                : existing.chapter_number === null;

            if (existing.book_id === expectedBookId && hasExpectedPage && hasExpectedChapter) {
                return {
                    valid: true,
                    readerAddress: existing.reader_address,
                    bookId: existing.book_id,
                    pageNumber: existing.page_number ?? undefined,
                    chapterNumber: existing.chapter_number ?? undefined,
                    amount: BigInt(existing.amount),
                    alreadyRecorded: true,
                };
            }

            return {
                valid: false,
                error: 'Payment already processed for different content',
            };
        }

        return {
            valid: true,
            readerAddress: senderAddress,
            bookId: parsedMemo.bookId,
            pageNumber: parsedMemo.pageNumber,
            chapterNumber: parsedMemo.chapterNumber,
            amount,
        };
    } catch (error) {
        console.error('Payment verification error:', error);
        return {
            valid: false,
            error: 'Failed to verify payment: ' + (error instanceof Error ? error.message : 'Unknown error'),
        };
    }
}

/**
 * Record a verified payment in the database
 */
export async function recordPayment(
    txHash: string,
    readerAddress: string,
    bookId: number,
    amount: bigint,
    pageNumber?: number,
    chapterNumber?: number,
    _payerAddress?: string
): Promise<void> {
    await pool.query(
        `INSERT INTO payment_logs (reader_address, book_id, page_number, chapter_number, tx_hash, amount)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tx_hash) DO NOTHING`,
        [
            readerAddress,
            bookId,
            pageNumber || null,
            chapterNumber || null,
            txHash,
            amount.toString(),
        ]
    );
}

/**
 * Check if a user has already paid for content
 */
export async function hasExistingPayment(
    readerAddress: string,
    bookId: number,
    pageNumber?: number,
    chapterNumber?: number
): Promise<boolean> {
    const query = pageNumber !== undefined
        ? `SELECT id
           FROM payment_logs
           WHERE reader_address = $1
             AND book_id = $2
             AND (
               page_number = $3
               OR chapter_number = (
                   SELECT chapter_number
                   FROM pages
                   WHERE book_id = $2
                     AND page_number = $3
               )
             )
           LIMIT 1`
        : `SELECT id
           FROM payment_logs
           WHERE reader_address = $1
             AND book_id = $2
             AND chapter_number = $3
           LIMIT 1`;

    const params = pageNumber !== undefined
        ? [readerAddress, bookId, pageNumber]
        : [readerAddress, bookId, chapterNumber];

    const result = await pool.query(query, params);
    return result.rows.length > 0;
}
