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

export type BundleType = 'single-page' | 'next-5-pages' | 'next-10-percent' | 'chapter';

export interface ReaderBalance {
    readerAddress: string;
    availableBalance: string;
    totalDeposited: string;
    totalSpent: string;
}

export interface UnlockOption {
    bundleType: BundleType;
    label: string;
    description: string;
    startPage: number;
    endPage: number;
    chapterNumber?: number;
    pageCount: number;
    amount: string;
    remainingPages: number;
    effectiveAmount: string;
    fullyUnlocked: boolean;
}

export interface UnlockPreview {
    bookId: number;
    pageNumber: number;
    suggestedTopUp: string;
    balance: ReaderBalance;
    options: UnlockOption[];
}

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
        unlockPreview?: UnlockPreview;
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
                unlockPreview: asUnlockPreview(errorBody?.unlockPreview),
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

    async getReaderBalance(readerAddress: string): Promise<ReaderBalance> {
        const response = await fetch(`${this.baseUrl}/api/wallet/balance?address=${encodeURIComponent(readerAddress)}`);
        if (!response.ok) {
            throw new Error('Failed to fetch balance');
        }
        const data = await response.json();
        return data.balance as ReaderBalance;
    }

    async getUnlockPreview(readerAddress: string, bookId: number, pageNumber: number): Promise<UnlockPreview> {
        const response = await fetch(
            `${this.baseUrl}/api/wallet/unlock-options?address=${encodeURIComponent(readerAddress)}&bookId=${bookId}&pageNumber=${pageNumber}`
        );

        if (!response.ok) {
            throw new Error('Failed to fetch unlock options');
        }

        const data = await response.json();
        return data.preview as UnlockPreview;
    }

    async getDepositIntent(readerAddress: string, minAmount?: string): Promise<{
        recipient: string;
        memo: string;
        network: string;
        recommendedAmount: string;
    }> {
        const query = new URLSearchParams({ address: readerAddress });
        if (minAmount) {
            query.set('minAmount', minAmount);
        }

        const response = await fetch(`${this.baseUrl}/api/wallet/deposit-intent?${query.toString()}`);
        if (!response.ok) {
            throw new Error('Failed to create deposit intent');
        }

        const data = await response.json();
        return {
            recipient: data.recipient,
            memo: data.memo,
            network: data.network,
            recommendedAmount: data.recommendedAmount,
        };
    }

    async claimDeposit(readerAddress: string, txHash: string): Promise<{
        amount: string;
        balance: ReaderBalance;
        txHash: string;
    }> {
        const response = await fetch(`${this.baseUrl}/api/wallet/claim-deposit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ readerAddress, txHash }),
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to claim deposit');
        }

        return {
            amount: data.claim.amount,
            balance: data.claim.balance,
            txHash: data.claim.txHash,
        };
    }

    async unlockBundle(
        readerAddress: string,
        bookId: number,
        pageNumber: number,
        bundleType: BundleType
    ): Promise<{
        debitedAmount: string;
        alreadyUnlocked: boolean;
        balance: ReaderBalance;
        unlockedRange?: {
            startPage: number;
            endPage: number;
            chapterNumber?: number;
            pagesUnlocked: number;
        };
    }> {
        const response = await fetch(`${this.baseUrl}/api/wallet/unlock`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ readerAddress, bookId, pageNumber, bundleType }),
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to unlock content');
        }

        return data.result;
    }

    async requestWithdrawal(readerAddress: string, amount: string): Promise<{ requestId: number; balance: ReaderBalance }> {
        const response = await fetch(`${this.baseUrl}/api/wallet/withdraw`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ readerAddress, amount }),
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to request withdrawal');
        }

        return {
            requestId: data.requestId,
            balance: data.balance,
        };
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
            legacyEarnings: BigInt(data.legacyEarnings || '0'),
            prepaidEarnings: BigInt(data.prepaidEarnings || '0'),
            bookEarnings: data.bookEarnings.map((b) => ({
                ...b,
                earnings: BigInt(b.earnings),
            })),
        };
    }

    async getAuthorAnalytics(authorAddress: string): Promise<AuthorAnalyticsResult> {
        const response = await fetch(`${this.baseUrl}/api/author/analytics?address=${authorAddress}`);
        if (!response.ok) {
            throw new Error('Failed to fetch analytics');
        }
        const data = await response.json();
        return data.analytics as AuthorAnalyticsResult;
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

function asUnlockPreview(value: unknown): UnlockPreview | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const candidate = value as Record<string, unknown>;
    if (!candidate.balance || !Array.isArray(candidate.options)) {
        return undefined;
    }

    return candidate as unknown as UnlockPreview;
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
    legacyEarnings?: string;
    prepaidEarnings?: string;
    bookEarnings: Array<{
        book_id: number;
        title: string;
        earnings: string;
        unlock_events: number;
        page_views: number;
        active_readers: number;
    }>;
}

interface AuthorEarningsResult {
    totalEarnings: bigint;
    legacyEarnings: bigint;
    prepaidEarnings: bigint;
    bookEarnings: Array<{
        book_id: number;
        title: string;
        earnings: bigint;
        unlock_events: number;
        page_views: number;
        active_readers: number;
    }>;
}

interface AuthorAnalyticsResult {
    pagesReadPerWallet: Array<{
        reader_address: string;
        pages_read: number;
        revenue_contributed: string;
    }>;
    completionRates: Array<{
        book_id: number;
        title: string;
        readers: number;
        average_completion_pct: string | number;
        max_page_reached: number;
        total_pages: number;
    }>;
    dropOffPoints: Array<{
        book_id: number;
        title: string;
        page_number: number;
        reader_count: number;
    }>;
    revenueHeatmap: Array<{
        book_id: number;
        title: string;
        chapter_number: number;
        revenue: string;
        unlock_events: number;
        readers: number;
    }>;
    topBooks: Array<{
        book_id: number;
        title: string;
        revenue: string;
        unique_readers: number;
    }>;
}
