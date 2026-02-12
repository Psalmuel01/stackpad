import { Request, Response, NextFunction } from 'express';
import { paymentMiddleware, getPayment, networkToCAIP2, type PaymentRequirementsV2 } from 'x402-stacks';
import { recordPayment, hasExistingPayment } from '../services/payment-verifier';
import pool from '../db/client';
import { createPaymentMemo } from '@stackpad/x402-client';

export interface X402Request extends Request {
    bookId?: number;
    pageNumber?: number;
    chapterNumber?: number;
    readerAddress?: string;
}

const FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://facilitator.stacksx402.com';
const STACKS_NETWORK = (process.env.STACKS_NETWORK || 'testnet') as 'mainnet' | 'testnet';

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

        if (pageNumber === 1) {
            next();
            return;
        }

        const readerAddress = req.header('X-Stacks-Address');
        if (readerAddress) {
            req.readerAddress = readerAddress;
        }

        const context = await getBookPaymentContext(bookId, pageNumber, chapterNumber, req);
        if (!context) {
            res.status(404).json({ error: 'Book not found' });
            return;
        }

        if (req.readerAddress) {
            const alreadyPaid = await hasExistingPayment(
                req.readerAddress,
                bookId,
                pageNumber,
                chapterNumber
            );

            if (alreadyPaid) {
                next();
                return;
            }
        }

        const middleware = paymentMiddleware({
            scheme: 'exact',
            network: context.v2Requirement.network,
            amount: context.v2Requirement.amount,
            asset: context.v2Requirement.asset,
            payTo: context.v2Requirement.payTo,
            maxTimeoutSeconds: context.v2Requirement.maxTimeoutSeconds,
            facilitatorUrl: FACILITATOR_URL,
            description: context.description,
            mimeType: 'application/json',
            extra: context.v2Requirement.extra,
        });

        await middleware(req, res, async () => {
            const requestedReader = req.readerAddress;
            const settledPayment = getPayment(req);
            const payer = settledPayment?.payer;
            const transaction = settledPayment?.transaction;

            if (!req.readerAddress && payer) {
                req.readerAddress = payer;
            }

            const entitlementReader = requestedReader || req.readerAddress || payer;

            if (entitlementReader && transaction) {
                await recordPayment(
                    transaction,
                    entitlementReader,
                    context.bookId,
                    context.expectedAmount,
                    context.pageNumber,
                    context.chapterNumber,
                    payer
                );
            }

            next();
        });
    } catch (error) {
        console.error('x402 middleware error:', error);
        res.status(500).json({ error: 'Payment gateway error' });
    }
}

async function getBookPaymentContext(
    bookId: number,
    pageNumber: number | undefined,
    chapterNumber: number | undefined,
    req: Request
): Promise<BookPaymentContext | null> {
    const bookQuery = await pool.query(
        'SELECT page_price, chapter_price, author_address FROM books WHERE id = $1',
        [bookId]
    );

    if (bookQuery.rows.length === 0) {
        return null;
    }

    const { page_price, chapter_price, author_address } = bookQuery.rows[0] as {
        page_price: string;
        chapter_price: string;
        author_address: string;
    };

    const amount = pageNumber !== undefined ? page_price : chapter_price;
    const memo = createPaymentMemo(bookId, pageNumber, chapterNumber);
    const caip2Network = networkToCAIP2(STACKS_NETWORK);
    const description = pageNumber !== undefined
        ? `Unlock page ${pageNumber}`
        : `Unlock chapter ${chapterNumber}`;

    return {
        bookId,
        pageNumber,
        chapterNumber,
        amount: amount.toString(),
        expectedAmount: BigInt(amount),
        authorAddress: author_address,
        memo,
        description,
        resourceUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
        v2Requirement: {
            scheme: 'exact',
            network: caip2Network,
            amount: amount.toString(),
            asset: 'STX',
            payTo: author_address,
            maxTimeoutSeconds: 300,
            extra: {
                bookId,
                pageNumber,
                chapterNumber,
                memo,
            },
        },
    };
}

interface BookPaymentContext {
    bookId: number;
    pageNumber?: number;
    chapterNumber?: number;
    amount: string;
    expectedAmount: bigint;
    authorAddress: string;
    memo: string;
    description: string;
    resourceUrl: string;
    v2Requirement: PaymentRequirementsV2;
}
