import { Request, Response, NextFunction } from 'express';
import {
    deserializeTransaction,
    isTokenTransferPayload,
    principalToString,
    addressHashModeToVersion,
    addressFromVersionHash,
    addressToString,
} from '@stacks/transactions';
import { X402PaymentVerifier, networkToCAIP2, type PaymentRequirementsV2, type PaymentPayloadV2 } from 'x402-stacks';
import { verifyPayment, recordPayment, hasExistingPayment } from '../services/payment-verifier';
import pool from '../db/client';
import { createPaymentMemo } from '@stackpad/x402-client';

export interface X402Request extends Request {
    bookId?: number;
    pageNumber?: number;
    chapterNumber?: number;
    readerAddress?: string;
}

const FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://facilitator.stacksx402.com';
const v2Verifier = new X402PaymentVerifier(FACILITATOR_URL);

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

        const paymentSignature = req.header('payment-signature');
        if (paymentSignature) {
            await handleV2Payment(req, res, next, context, paymentSignature);
            return;
        }

        const legacyPaymentData = getLegacyPaymentDataFromHeaders(req);
        if (legacyPaymentData) {
            const verifiedRaw = legacyPaymentData.txRaw
                ? verifyRawTokenTransfer(legacyPaymentData.txRaw, context)
                : null;

            if (verifiedRaw?.valid) {
                req.readerAddress = verifiedRaw.payer;
                await recordPayment(
                    legacyPaymentData.txHash || verifiedRaw.txHash,
                    verifiedRaw.payer,
                    context.bookId,
                    context.expectedAmount,
                    context.pageNumber,
                    context.chapterNumber
                );
                next();
                return;
            }

            if (!legacyPaymentData.txHash) {
                await send402Response(res, context, {
                    error: 'Payment verification failed',
                    details: verifiedRaw?.reason || 'invalid_payment_payload',
                });
                return;
            }

            const verification = await verifyPayment(
                legacyPaymentData.txHash,
                bookId,
                pageNumber,
                chapterNumber,
                context.authorAddress,
                context.expectedAmount
            );

            if (!verification.valid) {
                await send402Response(res, context, {
                    error: 'Payment verification failed',
                    details: verification.error,
                });
                return;
            }

            req.readerAddress = verification.readerAddress || req.readerAddress;

            if (!verification.alreadyRecorded) {
                await recordPayment(
                    legacyPaymentData.txHash,
                    verification.readerAddress!,
                    verification.bookId!,
                    verification.amount!,
                    verification.pageNumber,
                    verification.chapterNumber
                );
            }

            next();
            return;
        }

        if (!req.readerAddress) {
            res.status(401).json({
                error: 'Stacks address required',
                message: 'Provide X-Stacks-Address for entitlement checks or payment-signature/payment proof headers.',
            });
            return;
        }

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

        await send402Response(res, context);
    } catch (error) {
        console.error('x402 middleware error:', error);
        res.status(500).json({ error: 'Payment gateway error' });
    }
}

async function handleV2Payment(
    req: X402Request,
    res: Response,
    next: NextFunction,
    context: BookPaymentContext,
    paymentSignatureHeader: string
): Promise<void> {
    const paymentPayload = decodePaymentSignature(paymentSignatureHeader);
    if (!paymentPayload) {
        res.status(400).json({
            error: 'invalid_payment_signature',
            message: 'payment-signature must be base64-encoded JSON with x402Version=2',
        });
        return;
    }

    const accepted = paymentPayload.accepted;
    if (
        accepted.amount !== context.v2Requirement.amount
        || accepted.payTo !== context.v2Requirement.payTo
        || accepted.network !== context.v2Requirement.network
        || accepted.asset.toUpperCase() !== context.v2Requirement.asset.toUpperCase()
    ) {
        await send402Response(res, context, {
            error: 'Payment verification failed',
            details: 'invalid_payment_requirements',
        });
        return;
    }

    const rawVerification = verifyRawTokenTransfer(paymentPayload.payload.transaction, context);
    if (!rawVerification?.valid) {
        await send402Response(res, context, {
            error: 'Payment verification failed',
            details: rawVerification?.reason || 'invalid_payment_payload',
        });
        return;
    }

    const facilitatorVerification = await v2Verifier.verify(paymentPayload, {
        paymentRequirements: context.v2Requirement,
    });

    if (!facilitatorVerification.isValid) {
        await send402Response(res, context, {
            error: 'Payment verification failed',
            details: facilitatorVerification.invalidReason || 'facilitator_verify_failed',
        });
        return;
    }

    req.readerAddress = rawVerification.payer;
    await recordPayment(
        rawVerification.txHash,
        rawVerification.payer,
        context.bookId,
        context.expectedAmount,
        context.pageNumber,
        context.chapterNumber
    );

    const paymentResponse = {
        success: true,
        payer: rawVerification.payer,
        transaction: rawVerification.txHash,
        network: context.v2Requirement.network,
    };

    res.setHeader('payment-response', Buffer.from(JSON.stringify(paymentResponse)).toString('base64'));
    next();
}

async function send402Response(
    res: Response,
    context: BookPaymentContext,
    verificationError?: { error: string; details?: string }
): Promise<void> {
    const v2Payload = {
        x402Version: 2,
        resource: {
            url: context.resourceUrl,
            description: context.description,
            mimeType: 'application/json',
        },
        accepts: [context.v2Requirement],
    };

    const legacyInstructions = {
        amount: context.amount,
        recipient: context.authorAddress,
        memo: context.memo,
        network: process.env.STACKS_NETWORK || 'testnet',
    };

    res.status(402)
        .set({
            'WWW-Authenticate': 'x402',
            'payment-required': Buffer.from(JSON.stringify(v2Payload)).toString('base64'),
            'x-payment': JSON.stringify([toLegacyXPayment(context)]),
            'X-Payment-Required': JSON.stringify(legacyInstructions),
        })
        .json({
            error: verificationError?.error || 'Payment required',
            details: verificationError?.details,
            ...v2Payload,
            acceptsHeaders: ['payment-signature', 'x-payment-response', 'X-Payment-Proof'],
            paymentInstructions: legacyInstructions,
            message: context.description,
            facilitatorUrl: FACILITATOR_URL,
        });
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
    const caip2Network = networkToCAIP2((process.env.STACKS_NETWORK || 'testnet') as 'mainnet' | 'testnet');
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

function decodePaymentSignature(header: string): PaymentPayloadV2 | null {
    try {
        const decoded = Buffer.from(header, 'base64').toString('utf-8');
        const payload = JSON.parse(decoded) as PaymentPayloadV2;
        if (payload.x402Version !== 2 || !payload.accepted || !payload.payload?.transaction) {
            return null;
        }
        return payload;
    } catch {
        return null;
    }
}

function getLegacyPaymentDataFromHeaders(req: Request): LegacyPaymentData | undefined {
    const legacyProof = req.header('X-Payment-Proof');
    const xPaymentResponse = req.header('x-payment-response') || req.header('X-Payment-Response');

    if (!legacyProof && !xPaymentResponse) {
        return undefined;
    }

    let txHash = legacyProof || '';
    let txRaw: string | undefined;

    if (xPaymentResponse) {
        try {
            const parsed = JSON.parse(xPaymentResponse) as Record<string, unknown>;
            txHash = txHash || getStringField(parsed, ['txHash', 'txId', 'transactionHash', 'transaction']) || '';
            txRaw = getStringField(parsed, ['txRaw', 'rawTx', 'rawTransaction']);
        } catch {
            txRaw = undefined;
        }
    }

    if (!txHash && !txRaw) {
        return undefined;
    }

    return { txHash, txRaw };
}

function verifyRawTokenTransfer(txRaw: string, context: BookPaymentContext):
    | { valid: true; txHash: string; payer: string }
    | { valid: false; reason: string } {
    try {
        const tx = deserializeTransaction(txRaw);
        const payload = tx.payload;

        if (!isTokenTransferPayload(payload)) {
            return { valid: false, reason: 'raw_tx_not_token_transfer' };
        }

        const recipient = principalToString(payload.recipient);
        if (recipient !== context.authorAddress) {
            return { valid: false, reason: 'recipient_mismatch' };
        }

        if (payload.amount < context.expectedAmount) {
            return { valid: false, reason: 'amount_insufficient' };
        }

        const memo = payload.memo?.content?.replace(/\u0000/g, '').trim() || '';
        if (memo !== context.memo) {
            return { valid: false, reason: 'memo_mismatch' };
        }

        const txHash = tx.txid();
        const spendingCondition = tx.auth.spendingCondition;
        const version = addressHashModeToVersion(spendingCondition.hashMode as never, tx.version);
        const payer = addressToString(addressFromVersionHash(version, spendingCondition.signer));

        return { valid: true, txHash, payer };
    } catch {
        return { valid: false, reason: 'invalid_raw_transaction' };
    }
}

function toLegacyXPayment(context: BookPaymentContext): Record<string, unknown> {
    return {
        x402Version: 1,
        scheme: 'exact',
        network: context.v2Requirement.network,
        asset: 'stx',
        maxAmountRequired: context.amount,
        resource: context.pageNumber !== undefined
            ? `/api/content/${context.bookId}/page/${context.pageNumber}`
            : `/api/content/${context.bookId}/chapter/${context.chapterNumber}`,
        description: context.description,
        mimeType: 'application/json',
        payTo: context.authorAddress,
        maxTimeoutSeconds: 300,
        extra: {
            bookId: context.bookId,
            pageNumber: context.pageNumber,
            chapterNumber: context.chapterNumber,
            memo: context.memo,
        },
    };
}

function getStringField(source: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
    }
    return undefined;
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

interface LegacyPaymentData {
    txHash: string;
    txRaw?: string;
}
