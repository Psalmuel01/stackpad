import type { Book, ContentResponse, BookListResponse } from '@stackpad/shared';
import { is402Response, parsePaymentInstructions, formatPaymentProofHeader } from '@stackpad/x402-client';

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
        paymentProof?: string
    ): Promise<{
        content?: ContentResponse;
        requires402?: boolean;
        paymentInstructions?: any;
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

        // Check for 402 Payment Required
        if (is402Response(response)) {
            console.log('402 Response Headers:', Object.fromEntries(response.headers.entries()));
            const headerVal = response.headers.get('X-Payment-Required');
            console.log('X-Payment-Required value:', headerVal);

            let paymentInstructions = parsePaymentInstructions(response.headers);

            // If header parsing failed, try reading the body (fallback)
            if (!paymentInstructions) {
                try {
                    const errorBody = await response.json();
                    if (errorBody.paymentInstructions) {
                        console.log('Found payment instructions in body');
                        paymentInstructions = errorBody.paymentInstructions;
                    } else if (errorBody.error) {
                        // Return the specific error from the body (e.g. Verification failed)
                        return {
                            requires402: true,
                            error: errorBody.error,
                            details: errorBody.details
                        };
                    }
                } catch (e) {
                    console.error('Failed to parse 402 body:', e);
                }
            }

            return {
                requires402: true,
                paymentInstructions,
            };
        }

        if (!response.ok) {
            const error = await response.json();
            return { error: error.error || 'Failed to fetch page' };
        }

        const data = await response.json();
        return { content: data };
    }

    async uploadBook(book: any, pages: any[]): Promise<{ bookId: number }> {
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

    async getAuthorEarnings(authorAddress: string): Promise<any> {
        const response = await fetch(`${this.baseUrl}/api/author/earnings?address=${authorAddress}`);
        const data = await response.json();
        return {
            totalEarnings: BigInt(data.totalEarnings),
            bookEarnings: data.bookEarnings.map((b: any) => ({
                ...b,
                earnings: BigInt(b.earnings),
            })),
        };
    }
}

export const apiClient = new ApiClient(API_URL);
