import type { PaymentInstructions, X402Response } from '@stackpad/shared';

export interface X402PaymentRequirement {
    x402Version?: number;
    scheme?: string;
    network?: string;
    maxAmountRequired?: string;
    payTo?: string;
    asset?: string;
    resource?: string;
    description?: string;
    mimeType?: string;
    extra?: {
        memo?: string;
        bookId?: number;
        pageNumber?: number;
        chapterNumber?: number;
    };
}

export interface X402V2PaymentRequired {
    x402Version: 2;
    resource?: {
        url?: string;
        description?: string;
        mimeType?: string;
    };
    accepts: Array<{
        scheme: string;
        network: string;
        amount: string;
        asset: string;
        payTo: string;
        maxTimeoutSeconds?: number;
        extra?: {
            memo?: string;
            bookId?: number;
            pageNumber?: number;
            chapterNumber?: number;
        };
    }>;
}

export interface PaymentProofData {
    txHash: string;
    txRaw?: string;
    paymentSignature?: string;
}

/**
 * Parse payment instructions from HTTP 402 response headers
 */
export function parsePaymentInstructions(headers: Headers): PaymentInstructions | null {
    const paymentHeader = headers.get('X-Payment-Required');

    if (!paymentHeader) {
        return null;
    }

    try {
        return JSON.parse(paymentHeader) as PaymentInstructions;
    } catch (error) {
        console.error('Failed to parse payment instructions:', error);
        return null;
    }
}

/**
 * Parse standardized x402 payment requirements from 402 headers.
 */
export function parseXPaymentRequirements(headers: Headers): X402PaymentRequirement[] | null {
    const header = headers.get('x-payment');

    if (!header) {
        return null;
    }

    try {
        const parsed = JSON.parse(header) as unknown;
        if (!Array.isArray(parsed)) {
            return null;
        }
        return parsed as X402PaymentRequirement[];
    } catch (error) {
        console.error('Failed to parse x-payment requirements:', error);
        return null;
    }
}

/**
 * Parse payment-required header from x402 v2 (base64 JSON payload).
 */
export function parsePaymentRequiredHeader(headers: Headers): X402V2PaymentRequired | null {
    const encoded = headers.get('payment-required');
    if (!encoded) {
        return null;
    }

    try {
        const json = decodeBase64(encoded);
        const parsed = JSON.parse(json) as X402V2PaymentRequired;
        if (parsed.x402Version !== 2 || !Array.isArray(parsed.accepts)) {
            return null;
        }
        return parsed;
    } catch (error) {
        console.error('Failed to parse payment-required header:', error);
        return null;
    }
}

function decodeBase64(value: string): string {
    const maybeAtob = (globalThis as { atob?: (input: string) => string }).atob;
    if (typeof maybeAtob === 'function') {
        return maybeAtob(value);
    }

    const maybeBuffer = (globalThis as { Buffer?: { from: (input: string, encoding: string) => { toString: (encoding: string) => string } } }).Buffer;
    if (maybeBuffer) {
        return maybeBuffer.from(value, 'base64').toString('utf-8');
    }

    throw new Error('No base64 decoder available');
}

export function encodeBase64(value: string): string {
    const maybeBtoa = (globalThis as { btoa?: (input: string) => string }).btoa;
    if (typeof maybeBtoa === 'function') {
        return maybeBtoa(value);
    }

    const maybeBuffer = (globalThis as {
        Buffer?: { from: (input: string, encoding?: string) => { toString: (encoding: string) => string } };
    }).Buffer;
    if (maybeBuffer) {
        return maybeBuffer.from(value, 'utf-8').toString('base64');
    }

    throw new Error('No base64 encoder available');
}

/**
 * Check if response is a 402 Payment Required
 */
export function is402Response(response: Response): boolean {
    return response.status === 402;
}

/**
 * Format payment proof header for retry request
 */
export function formatPaymentProofHeader(proof: string | PaymentProofData): Record<string, string> {
    const normalized = typeof proof === 'string' ? { txHash: proof } : proof;
    if (normalized.paymentSignature) {
        return {
            'payment-signature': normalized.paymentSignature,
        };
    }

    // Legacy fallback for non-V2 servers.
    const payload = JSON.stringify({
        x402Version: 1,
        txHash: normalized.txHash,
        txRaw: normalized.txRaw,
    });

    return {
        'x-payment-response': payload,
        'X-Payment-Proof': normalized.txHash,
    };
}

/**
 * Create a payment memo string for transaction
 */
export function createPaymentMemo(
    bookId: number,
    pageNumber?: number,
    chapterNumber?: number
): string {
    if (pageNumber !== undefined) {
        return `book:${bookId}:page:${pageNumber}`;
    } else if (chapterNumber !== undefined) {
        return `book:${bookId}:chapter:${chapterNumber}`;
    }
    return `book:${bookId}`;
}

/**
 * Parse payment memo to extract book and content identifiers
 */
export function parsePaymentMemo(memo: string): {
    bookId: number;
    pageNumber?: number;
    chapterNumber?: number;
} | null {
    const regex = /^book:(\d+)(?::(?:page|chapter):(\d+))?$/;
    const match = memo.match(regex);

    if (!match) {
        return null;
    }

    const bookId = parseInt(match[1], 10);
    const contentNum = match[2] ? parseInt(match[2], 10) : undefined;

    if (memo.includes(':page:')) {
        return { bookId, pageNumber: contentNum };
    } else if (memo.includes(':chapter:')) {
        return { bookId, chapterNumber: contentNum };
    }

    return { bookId };
}

/**
 * Convert STX to microSTX (µSTX)
 */
export function stxToMicroStx(stx: number): bigint {
    return BigInt(Math.floor(stx * 1_000_000));
}

/**
 * Convert microSTX to STX
 */
export function microStxToStx(microStx: bigint): number {
    return Number(microStx) / 1_000_000;
}

/**
 * Format STX amount for display
 */
export function formatStxAmount(microStx: bigint | number | string): string {
    const normalizedMicroStx = toMicroStx(microStx);
    const zero = BigInt(0);
    const oneStx = BigInt(1_000_000);
    const sign = normalizedMicroStx < zero ? '-' : '';
    const absoluteMicroStx = normalizedMicroStx < zero ? -normalizedMicroStx : normalizedMicroStx;
    const whole = absoluteMicroStx / oneStx;
    const fractionalRaw = (absoluteMicroStx % oneStx).toString().padStart(6, '0');
    const fractional = fractionalRaw.replace(/0+$/, '');

    if (!fractional) {
        return `${sign}${whole.toString()} STX`;
    }

    return `${sign}${whole.toString()}.${fractional} STX`;
}

function toMicroStx(value: bigint | number | string): bigint {
    if (typeof value === 'bigint') {
        return value;
    }

    if (typeof value === 'number') {
        return BigInt(Math.floor(value));
    }

    return BigInt(value);
}
