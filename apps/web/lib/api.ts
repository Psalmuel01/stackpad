import type { Book, ContentResponse, BookListResponse } from '@stackpad/shared';
import {
    is402Response,
    parsePaymentRequiredHeader,
    parsePaymentResponseHeader,
    type X402V2PaymentRequired,
    type X402V2PaymentResponse,
} from '@stackpad/x402-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

class ApiClient {
    private baseUrl: string;

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl;
    }

    async getBooks(): Promise<Book[]> {
        const response = await fetch(`${this.baseUrl}/api/books`);
        const data: BookListResponse = await response.json();
        return data.books;
    }

    async getBook(id: number): Promise<Book> {
        const response = await fetch(`${this.baseUrl}/api/books/${id}`);
        const data = await response.json();
        return data.book;
    }

    async getPage(
        bookId: number,
        pageNum: number,
        userAddress: string
    ): Promise<{
        content?: ContentResponse;
        requires402?: boolean;
        insufficientCredit?: InsufficientCreditPayload;
        paymentRequired?: X402V2PaymentRequired;
        error?: string;
        details?: string;
    }> {
        const headers: Record<string, string> = {
            'X-Stacks-Address': userAddress,
        };

        const response = await fetch(`${this.baseUrl}/api/content/${bookId}/page/${pageNum}`, {
            headers,
        });

        if (is402Response(response)) {
            const paymentRequired = parsePaymentRequiredHeader(response.headers);
            if (paymentRequired?.accepts?.[0]) {
                const accepted = paymentRequired.accepts[0];
                console.info('[x402] payment-required header', {
                    network: accepted.network,
                    amount: accepted.amount,
                    asset: accepted.asset,
                    payTo: accepted.payTo,
                    resource: paymentRequired.resource?.url,
                });
            }

            let errorBody: Record<string, unknown> | null = null;
            try {
                errorBody = await response.json();
            } catch {
                errorBody = null;
            }

            return {
                requires402: true,
                insufficientCredit: asInsufficientCreditPayload(errorBody),
                paymentRequired: paymentRequired || undefined,
                error: asString(errorBody?.error),
                details: asString(errorBody?.details),
            };
        }

        if (!response.ok) {
            const error = await response.json();
            return { error: error.error || 'Failed to fetch page' };
        }

        const data = await response.json();
        return { content: data };
    }

    async getCreditBalance(walletAddress: string): Promise<{ balance: string; topUp?: CreditFundingPayload }> {
        const response = await fetch(
            `${this.baseUrl}/api/credits/balance?address=${encodeURIComponent(walletAddress)}`
        );

        if (!response.ok) {
            throw new Error('Failed to fetch credit balance');
        }

        const data = await response.json() as {
            balance: string;
            topUp?: {
                recipient: string;
                network: string;
                suggestedAmount: string;
            };
        };
        return {
            balance: data.balance,
            topUp: data.topUp,
        };
    }

    async getReadingProgress(
        bookId: number,
        walletAddress: string
    ): Promise<{ lastPage: number | null }> {
        const response = await fetch(
            `${this.baseUrl}/api/content/${bookId}/progress?address=${encodeURIComponent(walletAddress)}`
        );

        if (!response.ok) {
            throw new Error('Failed to fetch reading progress');
        }

        const data = await response.json() as { lastPage?: number | null };
        return {
            lastPage: Number.isInteger(data.lastPage) ? Number(data.lastPage) : null,
        };
    }

    async createDepositIntent(
        walletAddress: string,
        amount: string
    ): Promise<DepositIntentResponse> {
        const response = await fetch(`${this.baseUrl}/api/credits/deposit-intent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                walletAddress,
                amount,
            }),
        });

        if (!response.ok) {
            const error = await safeParseError(response);
            throw new Error(error || 'Failed to create deposit intent');
        }

        const data = await response.json() as { intent: DepositIntentResponse };
        return data.intent;
    }

    async settleDeposit(
        walletAddress: string,
        intentId: string,
        txHash?: string
    ): Promise<DepositSettlementResponse> {
        const response = await fetch(`${this.baseUrl}/api/credits/settle`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                walletAddress,
                intentId,
                txHash: txHash || undefined,
            }),
        });

        const paymentResponse = parsePaymentResponseHeader(response.headers);
        if (paymentResponse) {
            console.info('[x402] payment-response header', paymentResponse);
        }

        const data = await response.json() as DepositSettlementResponse & { error?: string };
        data.x402PaymentResponse = paymentResponse || undefined;

        if (!response.ok) {
            if (data.status === 'pending' || data.status === 'invalid') {
                return data;
            }
            throw new Error(data.error || 'Failed to settle deposit');
        }

        return data;
    }

    async uploadBook(book: UploadBookInput, pages: UploadPageInput[]): Promise<{ bookId: number }> {
        const response = await fetch(`${this.baseUrl}/api/author/upload`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ book, pages }),
        });

        if (!response.ok) {
            throw new Error('Failed to upload book');
        }

        const data = await response.json();
        return { bookId: data.bookId };
    }

    async getAuthorEarnings(authorAddress: string): Promise<AuthorEarningsResult> {
        const response = await fetch(`${this.baseUrl}/api/author/earnings?address=${authorAddress}`);
        const data = await response.json() as AuthorEarningsApiResponse;
        return {
            totalEarnings: BigInt(data.totalEarnings),
            bookEarnings: data.bookEarnings.map((b) => ({
                ...b,
                earnings: BigInt(b.earnings),
            })),
        };
    }

    async getAuthorBooks(authorAddress: string): Promise<Book[]> {
        const response = await fetch(`${this.baseUrl}/api/author/books?address=${encodeURIComponent(authorAddress)}`);
        if (!response.ok) {
            throw new Error('Failed to fetch author books');
        }

        const data = await response.json() as { books: Book[] };
        return data.books;
    }

    async updateAuthorBook(
        bookId: number,
        authorAddress: string,
        updates: {
            title?: string;
            coverImageUrl?: string | null;
            pagePrice?: string;
            chapterPrice?: string;
        }
    ): Promise<Book> {
        const response = await fetch(`${this.baseUrl}/api/author/books/${bookId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                authorAddress,
                ...updates,
            }),
        });

        if (!response.ok) {
            throw new Error('Failed to update book');
        }

        const data = await response.json() as { book: Book };
        return data.book;
    }
}

export const apiClient = new ApiClient(API_URL);

function asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function asInsufficientCreditPayload(value: unknown): InsufficientCreditPayload | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const candidate = value as Record<string, unknown>;
    if (
        candidate.code === 'INSUFFICIENT_CREDIT' &&
        typeof candidate.requiredAmount === 'string' &&
        typeof candidate.currentBalance === 'string' &&
        typeof candidate.shortfall === 'string' &&
        candidate.topUp &&
        typeof candidate.topUp === 'object'
    ) {
        const topUp = candidate.topUp as Record<string, unknown>;
        if (
            typeof topUp.recipient === 'string' &&
            typeof topUp.network === 'string' &&
            typeof topUp.suggestedAmount === 'string'
        ) {
            return {
                requiredAmount: candidate.requiredAmount,
                currentBalance: candidate.currentBalance,
                shortfall: candidate.shortfall,
                topUp: {
                    recipient: topUp.recipient,
                    network: topUp.network,
                    suggestedAmount: topUp.suggestedAmount,
                },
            };
        }
    }

    return undefined;
}

async function safeParseError(response: Response): Promise<string | null> {
    try {
        const body = await response.json() as { error?: string };
        return typeof body.error === 'string' ? body.error : null;
    } catch {
        return null;
    }
}

interface UploadBookInput {
    authorAddress: string;
    title: string;
    coverImageUrl?: string;
    totalPages: number;
    totalChapters: number;
    pagePrice: string;
    chapterPrice: string;
}

interface UploadPageInput {
    pageNumber: number;
    chapterNumber?: number;
    content: string;
    pdfPageBase64?: string;
}

interface AuthorEarningsApiResponse {
    totalEarnings: string;
    bookEarnings: Array<{
        book_id: number;
        title: string;
        earnings: string;
        pages_sold: number;
        chapters_sold: number;
    }>;
}

interface AuthorEarningsResult {
    totalEarnings: bigint;
    bookEarnings: Array<{
        book_id: number;
        title: string;
        earnings: bigint;
        pages_sold: number;
        chapters_sold: number;
    }>;
}

interface DepositIntentResponse {
    intentId: string;
    walletAddress: string;
    amount: string;
    recipient: string;
    memo: string;
    network: string;
    expiresAt: string;
}

interface DepositSettlementResponse {
    success: boolean;
    status: 'pending' | 'confirmed' | 'invalid';
    txHash?: string;
    amountCredited?: string;
    balance?: string;
    error?: string;
    x402PaymentResponse?: X402V2PaymentResponse;
}

interface InsufficientCreditPayload {
    requiredAmount: string;
    currentBalance: string;
    shortfall: string;
    topUp: {
        recipient: string;
        network: string;
        suggestedAmount: string;
    };
}

interface CreditFundingPayload {
    recipient: string;
    network: string;
    suggestedAmount: string;
}

export type ReaderPageResult = Awaited<ReturnType<ApiClient['getPage']>>;
export type ReaderDepositIntent = DepositIntentResponse;
export type ReaderDepositSettlement = DepositSettlementResponse;

export interface X402Diagnostics {
    readerAddress?: string;
    httpStatus?: number;
    error?: string;
    details?: string;
}
