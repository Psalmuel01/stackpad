import { Request, Response, NextFunction } from 'express';
import { verifyPayment, recordPayment, hasExistingPayment } from '../services/payment-verifier';
import pool from '../db/client';
import { createPaymentMemo } from '@stackpad/x402-client';

export interface X402Request extends Request {
    bookId?: number;
    pageNumber?: number;
    chapterNumber?: number;
    readerAddress?: string;
}

/**
 * x402 Payment Gating Middleware
 * 
 * Checks if user has paid for content. If not, returns 402 with payment instructions.
 * If payment proof is provided, verifies it and grants access.
 */
export async function x402PaymentGate(
    req: X402Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { bookId, pageNumber, chapterNumber } = req;

        if (!bookId) {
            res.status(400).json({ error: 'Book ID required' });
            return;
        }

        // Page 1 is always free
        if (pageNumber === 1) {
            next();
            return;
        }

        // Get reader address from header or session
        const readerAddress = req.header('X-Stacks-Address');

        if (!readerAddress) {
            res.status(401).json({ error: 'Stacks address required' });
            return;
        }

        req.readerAddress = readerAddress;

        // Check for payment proof in headers
        const paymentProof = req.header('X-Payment-Proof');

        // If payment proof provided, verify it
        if (paymentProof) {
            const verification = await verifyPayment(
                paymentProof,
                bookId,
                pageNumber,
                chapterNumber
            );

            if (!verification.valid) {
                res.status(402).json({
                    error: 'Payment verification failed',
                    details: verification.error,
                });
                return;
            }

            // Record the payment
            await recordPayment(
                paymentProof,
                verification.readerAddress!,
                verification.bookId!,
                verification.amount!,
                verification.pageNumber,
                verification.chapterNumber
            );

            // Payment verified, continue to content delivery
            next();
            return;
        }

        // Check if user has already paid for this content
        const alreadyPaid = await hasExistingPayment(
            readerAddress,
            bookId,
            pageNumber,
            chapterNumber
        );

        if (alreadyPaid) {
            // Already paid, grant access
            next();
            return;
        }

        // No payment found, return 402 Payment Required
        await send402Response(res, bookId, pageNumber, chapterNumber);
    } catch (error) {
        console.error('x402 middleware error:', error);
        res.status(500).json({ error: 'Payment gateway error' });
    }
}

/**
 * Send HTTP 402 Payment Required response with x402 payment instructions
 */
async function send402Response(
    res: Response,
    bookId: number,
    pageNumber?: number,
    chapterNumber?: number
): Promise<void> {
    // Fetch pricing and author from database
    const bookQuery = await pool.query(
        'SELECT page_price, chapter_price, author_address FROM books WHERE id = $1',
        [bookId]
    );

    if (bookQuery.rows.length === 0) {
        res.status(404).json({ error: 'Book not found' });
        return;
    }

    const { page_price, chapter_price, author_address } = bookQuery.rows[0];
    const amount = pageNumber !== undefined ? page_price : chapter_price;

    // Create payment memo
    const memo = createPaymentMemo(bookId, pageNumber, chapterNumber);

    // Payment instructions for x402
    const paymentInstructions = {
        amount: amount.toString(), // microSTX
        recipient: author_address, // Pay directly to author
        memo,
        network: process.env.STACKS_NETWORK || 'testnet',
    };

    res.status(402)
        .set({
            'WWW-Authenticate': 'Stacks-Payment',
            'X-Payment-Required': JSON.stringify(paymentInstructions),
        })
        .json({
            error: 'Payment required',
            paymentInstructions,
            message: pageNumber
                ? `Please pay ${amount} microSTX to unlock page ${pageNumber}`
                : `Please pay ${amount} microSTX to unlock chapter ${chapterNumber}`,
        });
}
