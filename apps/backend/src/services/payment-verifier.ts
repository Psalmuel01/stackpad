import { transactionsApi, smartContractsApi, ENTITLEMENT_CONTRACT } from './stacks';
import pool from '../db/client';
import { parsePaymentMemo } from '@stackpad/x402-client';

export interface PaymentVerificationResult {
    valid: boolean;
    readerAddress?: string;
    bookId?: number;
    pageNumber?: number;
    chapterNumber?: number;
    amount?: bigint;
    error?: string;
}

/**
 * Verify a payment transaction on the Stacks blockchain
 */
export async function verifyPayment(
    txHash: string,
    expectedBookId: number,
    expectedPageNumber?: number,
    expectedChapterNumber?: number
): Promise<PaymentVerificationResult> {
    try {
        // Fetch transaction from Stacks blockchain
        const txResponse = await transactionsApi.getTransactionById({ txId: txHash });

        // Check if transaction exists and is complete
        if (!txResponse || txResponse.tx_status !== 'success') {
            return {
                valid: false,
                error: 'Transaction not found or not confirmed',
            };
        }

        // Verify it's an STX transfer or contract call
        if (txResponse.tx_type !== 'token_transfer' && txResponse.tx_type !== 'contract_call') {
            return {
                valid: false,
                error: 'Invalid transaction type',
            };
        }

        let senderAddress: string;
        let amount: bigint;
        let memo: string | undefined;

        if (txResponse.tx_type === 'token_transfer') {
            senderAddress = txResponse.sender_address;
            amount = BigInt(txResponse.token_transfer.amount);
            memo = txResponse.token_transfer.memo;
        } else {
            // Handle contract call (e.g., unlock-page call)
            senderAddress = txResponse.sender_address;
            // For contract calls, we'd need to parse the function args
            // For now, we'll assume token transfer is the primary flow
            return {
                valid: false,
                error: 'Contract call verification not yet implemented',
            };
        }

        // Parse memo to extract book/page/chapter info
        const parsedMemo = memo ? parsePaymentMemo(memo) : null;

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
            'SELECT id FROM payment_logs WHERE tx_hash = $1',
            [txHash]
        );

        if (existingPayment.rows.length > 0) {
            return {
                valid: false,
                error: 'Payment already processed',
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
    chapterNumber?: number
): Promise<void> {
    await pool.query(
        `INSERT INTO payment_logs (reader_address, book_id, page_number, chapter_number, tx_hash, amount)
     VALUES ($1, $2, $3, $4, $5, $6)`,
        [readerAddress, bookId, pageNumber || null, chapterNumber || null, txHash, amount.toString()]
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
        ? 'SELECT id FROM payment_logs WHERE reader_address = $1 AND book_id = $2 AND page_number = $3'
        : 'SELECT id FROM payment_logs WHERE reader_address = $1 AND book_id = $2 AND chapter_number = $3';

    const params = pageNumber !== undefined
        ? [readerAddress, bookId, pageNumber]
        : [readerAddress, bookId, chapterNumber];

    const result = await pool.query(query, params);
    return result.rows.length > 0;
}
