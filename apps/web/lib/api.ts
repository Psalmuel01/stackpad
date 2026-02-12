import type { Book, ContentResponse, BookListResponse } from '@stackpad/shared';
import {
    is402Response,
    parsePaymentInstructions,
    parseXPaymentRequirements,
    parsePaymentRequiredHeader,
    formatPaymentProofHeader,
    type X402PaymentRequirement,
    type X402V2PaymentRequired,
    type PaymentProofData,
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
        userAddress: string,
        paymentProof?: PaymentProofData
    ): Promise<{
        content?: ContentResponse;
        requires402?: boolean;
        paymentInstructions?: {
            amount: string;
            recipient: string;
            memo: string;
            network: string;
        };
        paymentRequirements?: X402PaymentRequirement[];
        paymentRequiredV2?: X402V2PaymentRequired;
        error?: string;
        details?: string;
    }> {
        const headers: Record<string, string> = {
            'X-Stacks-Address': userAddress,
        };

        if (paymentProof) {
            Object.assign(headers, formatPaymentProofHeader(paymentProof));
        }

        const response = await fetch(`${this.baseUrl}/api/content/${bookId}/page/${pageNum}`, {
            headers,
        });

        if (is402Response(response)) {
            let errorBody: Record<string, unknown> | null = null;
            try {
                errorBody = await response.json();
            } catch {
                errorBody = null;
            }

            const paymentRequirements = parseXPaymentRequirements(response.headers)
                || asPaymentRequirements(errorBody?.paymentRequirements);

            const v2PaymentRequired = parsePaymentRequiredHeader(response.headers);
            const v2Requirements = v2PaymentRequired?.accepts.map((item) => ({
                scheme: item.scheme,
                network: item.network,
                maxAmountRequired: item.amount,
                payTo: item.payTo,
                asset: item.asset,
                description: v2PaymentRequired.resource?.description,
                mimeType: v2PaymentRequired.resource?.mimeType,
                extra: item.extra,
            } as X402PaymentRequirement));

            let paymentInstructions = parsePaymentInstructions(response.headers)
                || asPaymentInstructions(errorBody?.paymentInstructions);

            const effectiveRequirements = paymentRequirements || v2Requirements;

            if (!paymentInstructions && effectiveRequirements && effectiveRequirements.length > 0) {
                paymentInstructions = requirementToInstructions(effectiveRequirements[0]);
            }

            return {
                requires402: true,
                paymentInstructions,
                paymentRequirements: effectiveRequirements,
                paymentRequiredV2: v2PaymentRequired || undefined,
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
}

export const apiClient = new ApiClient(API_URL);

function asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function asPaymentRequirements(value: unknown): X402PaymentRequirement[] | undefined {
    return Array.isArray(value) ? (value as X402PaymentRequirement[]) : undefined;
}

function asPaymentInstructions(value: unknown): {
    amount: string;
    recipient: string;
    memo: string;
    network: string;
} | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const candidate = value as Record<string, unknown>;
    if (
        typeof candidate.amount === 'string' &&
        typeof candidate.recipient === 'string' &&
        typeof candidate.memo === 'string' &&
        typeof candidate.network === 'string'
    ) {
        return {
            amount: candidate.amount,
            recipient: candidate.recipient,
            memo: candidate.memo,
            network: candidate.network,
        };
    }

    return undefined;
}

function requirementToInstructions(requirement: X402PaymentRequirement): {
    amount: string;
    recipient: string;
    memo: string;
    network: string;
} | undefined {
    if (!requirement.maxAmountRequired || !requirement.payTo || !requirement.network) {
        return undefined;
    }

    return {
        amount: requirement.maxAmountRequired,
        recipient: requirement.payTo,
        memo: requirement.extra?.memo || '',
        network: requirement.network,
    };
}

interface UploadBookInput {
    authorAddress: string;
    title: string;
    coverImageUrl?: string;
    totalPages: number;
    totalChapters: number;
    pagePrice: string;
    chapterPrice: string;
    contractBookId?: number;
}

interface UploadPageInput {
    pageNumber: number;
    chapterNumber?: number;
    content: string;
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

export interface X402Diagnostics {
    readerAddress?: string;
    httpStatus?: number;
    paymentRequired?: {
        amount?: string;
        asset?: string;
        network?: string;
        payTo?: string;
        maxTimeoutSeconds?: number;
        memo?: string;
    };
    paymentResponse?: {
        success?: boolean;
        transaction?: string;
        payer?: string;
        network?: string;
    };
    error?: string;
    details?: string;
}
