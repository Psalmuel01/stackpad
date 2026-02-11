// Book types
export interface Book {
    id: number;
    authorAddress: string;
    title: string;
    coverImageUrl?: string;
    totalPages: number;
    totalChapters: number;
    pagePrice: bigint;      // µSTX
    chapterPrice: bigint;   // µSTX
    contractBookId?: number;
    createdAt: Date;
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
