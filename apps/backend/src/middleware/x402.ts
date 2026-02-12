import { Request, Response, NextFunction } from 'express';
import { paymentMiddleware, getPayment, networkToCAIP2, type PaymentRequirementsV2 } from 'x402-stacks';
import { recordPayment, hasExistingPayment, verifyPayment } from '../services/payment-verifier';
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

        const txHashProof = extractPaymentProofTxHash(req);
        if (txHashProof) {
            const verification = await verifyPayment(
                txHashProof,
                context.bookId,
                context.pageNumber,
                context.chapterNumber,
                context.authorAddress,
                context.expectedAmount
            );

            if (verification.valid) {
                const requestedReader = req.readerAddress;
                const verifiedReader = verification.readerAddress;

                if (requestedReader && verifiedReader && requestedReader !== verifiedReader) {
                    sendPaymentRequiredWithError(
                        req,
                        res,
                        context,
                        'Payment sender does not match the requested reader address'
                    );
                    return;
                }

                const entitlementReader = verifiedReader || requestedReader;
                if (!entitlementReader) {
                    sendPaymentRequiredWithError(req, res, context, 'Unable to determine payment sender');
                    return;
                }

                req.readerAddress = entitlementReader;
                await recordPayment(
                    txHashProof,
                    entitlementReader,
                    context.bookId,
                    verification.amount ?? context.expectedAmount,
                    context.pageNumber,
                    context.chapterNumber
                );

                res.setHeader('payment-response', Buffer.from(JSON.stringify({
                    success: true,
                    transaction: txHashProof,
                    payer: verifiedReader || entitlementReader,
                    network: context.v2Requirement.network,
                })).toString('base64'));

                next();
                return;
            }

            sendPaymentRequiredWithError(req, res, context, verification.error || 'Payment proof is invalid');
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

            if (requestedReader && payer && requestedReader !== payer) {
                sendPaymentRequiredWithError(
                    req,
                    res,
                    context,
                    'Payment sender does not match the requested reader address'
                );
                return;
            }

            const entitlementReader = payer || requestedReader;
            if (!entitlementReader) {
                sendPaymentRequiredWithError(req, res, context, 'Unable to determine payment sender');
                return;
            }

            req.readerAddress = entitlementReader;

            if (!transaction) {
                sendPaymentRequiredWithError(req, res, context, 'Missing settlement transaction');
                return;
            }

            await recordPayment(
                transaction,
                entitlementReader,
                context.bookId,
                context.expectedAmount,
                context.pageNumber,
                context.chapterNumber,
                payer
            );

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

function extractPaymentProofTxHash(req: Request): string | null {
    const directHeader = req.header('x-payment-proof');
    if (directHeader?.trim()) {
        return normalizeTxHash(directHeader);
    }

    const legacyResponse = req.header('x-payment-response');
    if (!legacyResponse?.trim()) {
        return null;
    }

    try {
        const parsed = JSON.parse(legacyResponse) as { txHash?: string };
        if (typeof parsed.txHash === 'string' && parsed.txHash.trim()) {
            return normalizeTxHash(parsed.txHash);
        }
    } catch {
        // ignore malformed legacy headers
    }

    return null;
}

function normalizeTxHash(value: string): string {
    const trimmed = value.trim();
    return trimmed.startsWith('0x') || trimmed.startsWith('0X')
        ? trimmed.slice(2)
        : trimmed;
}

function sendPaymentRequiredWithError(
    req: Request,
    res: Response,
    context: BookPaymentContext,
    error: string
): void {
    const paymentRequired = {
        x402Version: 2 as const,
        resource: {
            url: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
            description: context.description,
            mimeType: 'application/json',
        },
        accepts: [context.v2Requirement],
    };

    res.setHeader('payment-required', Buffer.from(JSON.stringify(paymentRequired)).toString('base64'));
    res.status(402).json({
        ...paymentRequired,
        error,
    });
}
