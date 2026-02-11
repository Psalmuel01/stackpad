import type { PaymentInstructions, X402Response } from '@stackpad/shared';

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
 * Check if response is a 402 Payment Required
 */
export function is402Response(response: Response): boolean {
    return response.status === 402;
}

/**
 * Format payment proof header for retry request
 */
export function formatPaymentProofHeader(txHash: string): Record<string, string> {
    return {
        'X-Payment-Proof': txHash,
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
export function formatStxAmount(microStx: bigint): string {
    const stx = microStxToStx(microStx);
    return `${stx.toFixed(6)} STX`;
}
