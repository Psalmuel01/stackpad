// Book types
export interface Book {
    id: number;
    authorAddress: string;
    title: string;
    coverImageUrl?: string;
    totalPages: number;
    totalChapters: number;
    pagePrice: bigint | string;      // µSTX
    chapterPrice: bigint | string;   // µSTX
    contractBookId?: number;
    createdAt: Date | string;
}

export interface Page {
    id: number;
    bookId: number;
    pageNumber: number;
    chapterNumber?: number;
    content: string;
}

export interface Chapter {
    number: number;
    title: string;
    startPage: number;
    endPage: number;
}

// Payment types
export interface PaymentProof {
    txHash: string;
    bookId: number;
    pageNumber?: number;
    chapterNumber?: number;
    amount: bigint;
    timestamp: Date;
}

export interface PaymentInstructions {
    amount: string;        // µSTX as string
    recipient: string;     // Contract address
    memo: string;          // "book:X:page:Y" or "book:X:chapter:Y"
    network: 'mainnet' | 'testnet' | 'devnet';
}

// Entitlement types
export interface Entitlement {
    readerAddress: string;
    bookId: number;
    pageNumber?: number;
    chapterNumber?: number;
    unlockedAt: Date;
}

export interface UserProgress {
    bookId: number;
    unlockedPages: number[];
    unlockedChapters: number[];
    lastRead?: number; // Last page number
    progressPercentage: number;
}

// API Response types
export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}

export interface BookListResponse {
    books: Book[];
    total: number;
}

export interface ContentResponse {
    content: string;
    pageNumber: number;
    chapterNumber?: number;
    nextPage?: number;
    prevPage?: number;
}

// x402 specific types
export interface X402Response {
    statusCode: 402;
    headers: {
        'WWW-Authenticate': string;
        'X-Payment-Required': string;
    };
    paymentInstructions: PaymentInstructions;
}

export interface AuthorEarnings {
    totalEarnings: bigint;
    bookEarnings: {
        bookId: number;
        bookTitle: string;
        earnings: bigint;
        pagesSold: number;
        chaptersSold: number;
    }[];
}

// Prepaid reading wallet and bundle unlock types
export interface ReaderBalance {
    readerAddress: string;
    availableBalance: bigint | string;
    totalDeposited: bigint | string;
    totalSpent: bigint | string;
}

export type UnlockBundleType = 'single-page' | 'next-5-pages' | 'next-10-percent' | 'chapter';

export interface UnlockOption {
    bundleType: UnlockBundleType;
    label: string;
    description: string;
    startPage: number;
    endPage: number;
    chapterNumber?: number;
    pageCount: number;
    amount: bigint | string;
    remainingPages: number;
    effectiveAmount: bigint | string;
    fullyUnlocked: boolean;
}

export interface UnlockPreview {
    bookId: number;
    pageNumber: number;
    suggestedTopUp: bigint | string;
    balance: ReaderBalance;
    options: UnlockOption[];
}
