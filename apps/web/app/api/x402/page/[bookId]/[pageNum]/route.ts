import { NextRequest, NextResponse } from 'next/server';
import { AnchorMode, makeSTXTokenTransfer } from '@stacks/transactions';
import {
    decodePaymentRequired,
    decodePaymentResponse,
    encodePaymentPayload,
    networkFromCAIP2,
    privateKeyToAccount,
    type SettlementResponseV2,
} from 'x402-stacks';

export const runtime = 'nodejs';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const BUYER_NETWORK = (process.env.X402_BUYER_NETWORK || process.env.NEXT_PUBLIC_STACKS_NETWORK || 'testnet') as 'mainnet' | 'testnet';
const CLIENT_PRIVATE_KEY = process.env.CLIENT_PRIVATE_KEY || process.env.X402_CLIENT_PRIVATE_KEY;

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ bookId: string; pageNum: string }> }
) {
    if (!CLIENT_PRIVATE_KEY) {
        return NextResponse.json(
            {
                error: 'CLIENT_PRIVATE_KEY is not configured for strict x402 buyer mode',
                diagnostics: {
                    error: 'CLIENT_PRIVATE_KEY is not configured for strict x402 buyer mode',
                },
            },
            { status: 500 }
        );
    }

    const { bookId: bookIdRaw, pageNum: pageNumRaw } = await context.params;
    const bookId = parseInt(bookIdRaw, 10);
    const pageNum = parseInt(pageNumRaw, 10);

    if (Number.isNaN(bookId) || Number.isNaN(pageNum) || pageNum < 1) {
        return NextResponse.json({ error: 'Invalid book or page number' }, { status: 400 });
    }

    const account = privateKeyToAccount(CLIENT_PRIVATE_KEY, BUYER_NETWORK);
    const readerAddress = request.nextUrl.searchParams.get('readerAddress')?.trim();
    const entitlementAddress = readerAddress || account.address;

    const endpoint = `${API_URL}/api/content/${bookId}/page/${pageNum}`;
    const baseHeaders = {
        'X-Stacks-Address': entitlementAddress,
    };

    try {
        const initialResponse = await fetch(endpoint, {
            method: 'GET',
            headers: baseHeaders,
            cache: 'no-store',
        });

        if (initialResponse.status !== 402) {
            return await forwardResponse(initialResponse, {
                readerAddress: entitlementAddress,
                buyerAddress: account.address,
                httpStatus: initialResponse.status,
            });
        }

        const paymentRequired = decodePaymentRequired(
            initialResponse.headers.get('payment-required')
        ) as X402PaymentRequired | null;

        if (!paymentRequired?.accepts?.length) {
            return NextResponse.json(
                {
                    error: 'Invalid x402 payment-required response',
                    readerAddress: entitlementAddress,
                    buyerAddress: account.address,
                    diagnostics: {
                        readerAddress: entitlementAddress,
                        buyerAddress: account.address,
                        httpStatus: 402,
                        error: 'Invalid x402 payment-required response',
                    },
                },
                { status: 502 }
            );
        }

        const accepted = selectAcceptedRequirement(paymentRequired.accepts, BUYER_NETWORK);
        if (!accepted) {
            return NextResponse.json(
                {
                    error: `No compatible payment option found for ${BUYER_NETWORK}`,
                    readerAddress: entitlementAddress,
                    buyerAddress: account.address,
                    diagnostics: {
                        readerAddress: entitlementAddress,
                        buyerAddress: account.address,
                        httpStatus: 402,
                        error: `No compatible payment option found for ${BUYER_NETWORK}`,
                    },
                },
                { status: 400 }
            );
        }

        const acceptedPayment = {
            ...accepted,
            maxTimeoutSeconds: accepted.maxTimeoutSeconds ?? 300,
        };
        const requirementSummary = summarizeRequirement(acceptedPayment);

        const signedTransaction = await signStxPayment(acceptedPayment, account.privateKey);
        const resource = {
            url: paymentRequired.resource?.url || endpoint,
            description: paymentRequired.resource?.description,
            mimeType: paymentRequired.resource?.mimeType,
        };
        const paymentSignature = encodePaymentPayload({
            x402Version: 2,
            resource,
            accepted: acceptedPayment,
            payload: {
                transaction: signedTransaction,
            },
        });

        const paidResponse = await fetch(endpoint, {
            method: 'GET',
            headers: {
                ...baseHeaders,
                'payment-signature': paymentSignature,
            },
            cache: 'no-store',
        });

        return await forwardResponse(paidResponse, {
            readerAddress: entitlementAddress,
            buyerAddress: account.address,
            paymentRequired: requirementSummary,
            httpStatus: paidResponse.status,
        });
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : 'Failed to process x402 payment',
                readerAddress: entitlementAddress,
                buyerAddress: account.address,
                diagnostics: {
                    readerAddress: entitlementAddress,
                    buyerAddress: account.address,
                },
            },
            { status: 500 }
        );
    }
}

async function forwardResponse(
    response: Response,
    context: {
        readerAddress: string;
        buyerAddress: string;
        paymentRequired?: PaymentRequirementSummary;
        httpStatus: number;
    }
) {
    const body = await parseJson(response);
    const payment = decodePaymentResponse(response.headers.get('payment-response')) as SettlementResponseV2 | null;
    const bodyRecord = asRecord(body);
    const fallbackTx = asString(bodyRecord?.transaction);
    const fallbackPayer = asString(bodyRecord?.payer);
    const effectiveTx = payment?.transaction || fallbackTx;
    const effectivePayer = payment?.payer || fallbackPayer;
    const effectiveNetwork = payment?.network;
    const responseError = asString(bodyRecord?.error) || `Request failed with status ${response.status}`;
    const responseDetails = asString(bodyRecord?.details)
        || asString(bodyRecord?.message)
        || ((effectivePayer || effectiveTx)
            ? `payer=${effectivePayer || 'unknown'} tx=${effectiveTx || 'unknown'}`
            : undefined);

    const diagnostics: AdapterDiagnostics = {
        readerAddress: context.readerAddress,
        buyerAddress: context.buyerAddress,
        httpStatus: context.httpStatus,
        paymentRequired: context.paymentRequired,
        paymentResponse: (effectiveTx || effectivePayer || effectiveNetwork)
            ? {
                transaction: effectiveTx,
                payer: effectivePayer,
                network: effectiveNetwork,
                success: payment?.success,
            }
            : undefined,
        error: response.ok ? undefined : responseError,
        details: response.ok ? undefined : responseDetails,
    };

    if (response.ok) {
        return NextResponse.json({
            success: true,
            data: body,
            payment,
            readerAddress: context.readerAddress,
            buyerAddress: context.buyerAddress,
            diagnostics,
        });
    }

    return NextResponse.json(
        {
            error: responseError,
            details: responseDetails,
            readerAddress: context.readerAddress,
            buyerAddress: context.buyerAddress,
            diagnostics,
        },
        { status: response.status }
    );
}

async function parseJson(response: Response): Promise<unknown> {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

function selectAcceptedRequirement(
    accepts: X402PaymentRequirement[],
    network: 'mainnet' | 'testnet'
): X402PaymentRequirement | null {
    for (const requirement of accepts) {
        if (requirement.asset !== 'STX') {
            continue;
        }

        if (networkFromCAIP2(requirement.network) === network) {
            return requirement;
        }
    }

    return null;
}

async function signStxPayment(requirement: X402PaymentRequirement, senderKey: string): Promise<string> {
    const network = networkFromCAIP2(requirement.network);
    if (network !== 'mainnet' && network !== 'testnet') {
        throw new Error(`Unsupported CAIP-2 network: ${requirement.network}`);
    }

    const transaction = await makeSTXTokenTransfer({
        recipient: requirement.payTo,
        amount: BigInt(requirement.amount),
        senderKey,
        network,
        anchorMode: AnchorMode.Any,
        memo: normalizeMemo(requirement.extra?.memo),
    });

    return Buffer.from(transaction.serialize()).toString('hex');
}

function normalizeMemo(memo: string | undefined): string {
    if (!memo) {
        return '';
    }

    return memo.slice(0, 34);
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function summarizeRequirement(requirement: X402PaymentRequirement): PaymentRequirementSummary {
    return {
        amount: requirement.amount,
        asset: requirement.asset,
        network: requirement.network,
        payTo: requirement.payTo,
        maxTimeoutSeconds: requirement.maxTimeoutSeconds,
        memo: requirement.extra?.memo,
    };
}

interface X402PaymentRequired {
    x402Version: 2;
    resource?: {
        url?: string;
        description?: string;
        mimeType?: string;
    };
    accepts: X402PaymentRequirement[];
}

interface X402PaymentRequirement {
    scheme: string;
    network: `stacks:${string}`;
    amount: string;
    asset: string;
    payTo: string;
    maxTimeoutSeconds?: number;
    extra?: {
        memo?: string;
    };
}

interface PaymentRequirementSummary {
    amount: string;
    asset: string;
    network: `stacks:${string}`;
    payTo: string;
    maxTimeoutSeconds?: number;
    memo?: string;
}

interface AdapterDiagnostics {
    readerAddress: string;
    buyerAddress: string;
    httpStatus: number;
    paymentRequired?: PaymentRequirementSummary;
    paymentResponse?: {
        success?: boolean;
        transaction?: string;
        payer?: string;
        network?: string;
    };
    error?: string;
    details?: string;
}
