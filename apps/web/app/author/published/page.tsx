'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import type { Book } from '@stackpad/shared';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api';
import { WalletConnect } from '@/components/WalletConnect';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useToast } from '@/components/ToastProvider';
import { BrandLogo } from '@/components/BrandLogo';

interface EditableBook {
    id: number;
    title: string;
    coverImageUrl: string;
    pagePrice: string;
}

export default function PublishedBooksPage() {
    const { isAuthenticated, userAddress, connectWallet } = useAuth();
    const { pushToast } = useToast();

    const [authorBooks, setAuthorBooks] = useState<EditableBook[]>([]);
    const [booksLoading, setBooksLoading] = useState(false);
    const [booksSaving, setBooksSaving] = useState<Record<number, boolean>>({});

    const loadAuthorBooks = useCallback(async (authorAddress: string) => {
        try {
            setBooksLoading(true);
            const books = await apiClient.getAuthorBooks(authorAddress);
            setAuthorBooks(books.map(toEditableBook));
        } catch (error) {
            console.error(error);
            pushToast({
                tone: 'error',
                title: 'Load failed',
                message: 'Could not load your published books.',
            });
        } finally {
            setBooksLoading(false);
        }
    }, [pushToast]);

    useEffect(() => {
        if (!userAddress) {
            setAuthorBooks([]);
            return;
        }

        void loadAuthorBooks(userAddress);
    }, [loadAuthorBooks, userAddress]);

    function updateAuthorBookField(
        bookId: number,
        field: keyof Omit<EditableBook, 'id'>,
        value: string
    ) {
        setAuthorBooks((prev) => prev.map((book) => (
            book.id === bookId
                ? { ...book, [field]: value }
                : book
        )));
    }

    async function saveAuthorBook(bookId: number) {
        if (!userAddress) {
            return;
        }

        const target = authorBooks.find((book) => book.id === bookId);
        if (!target) {
            return;
        }

        const parsedPrice = parseMicroStx(target.pagePrice);
        if (parsedPrice === null) {
            pushToast({
                tone: 'error',
                title: 'Invalid page price',
                message: `Book #${bookId} has an invalid microSTX price.`,
            });
            return;
        }

        setBooksSaving((prev) => ({ ...prev, [bookId]: true }));
        try {
            await apiClient.updateAuthorBook(bookId, userAddress, {
                title: target.title.trim(),
                coverImageUrl: target.coverImageUrl.trim() || null,
                pagePrice: parsedPrice.toString(),
                chapterPrice: (parsedPrice * BigInt(5)).toString(),
            });
            pushToast({
                tone: 'success',
                title: 'Update successful',
                message: `Book #${bookId} settings were saved.`,
            });
            await loadAuthorBooks(userAddress);
        } catch (error) {
            console.error(error);
            pushToast({
                tone: 'error',
                title: 'Update failed',
                message: `Could not save changes for book #${bookId}.`,
            });
        } finally {
            setBooksSaving((prev) => ({ ...prev, [bookId]: false }));
        }
    }

    if (!isAuthenticated) {
        return (
            <div className="app-shell">
                <header className="topbar">
                    <div className="layout-wrap flex h-20 items-center justify-between">
                        <BrandLogo />
                        <ThemeToggle />
                    </div>
                </header>
                <main className="layout-wrap flex min-h-[72vh] items-center justify-center py-16">
                    <div className="surface w-full max-w-xl p-10 text-center md:p-12">
                        <h1 className="font-display text-4xl text-slate-900">Connect to view books</h1>
                        <p className="mt-5 text-lg leading-8 text-slate-600">
                            Connect your author wallet to manage published titles.
                        </p>
                        <div className="mt-10 flex justify-center">
                            <button onClick={connectWallet} className="btn-primary">Connect wallet</button>
                        </div>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className="app-shell">
            <header className="topbar">
                <div className="layout-wrap flex h-20 items-center justify-between">
                    <BrandLogo />
                    <div className="flex items-center gap-3">
                        <Link href="/author" className="btn-secondary">Author</Link>
                        <Link href="/library" className="btn-secondary">Library</Link>
                        <ThemeToggle />
                        <WalletConnect />
                    </div>
                </div>
            </header>

            <main className="layout-wrap py-14 md:py-20">
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35 }}
                    className="mx-auto max-w-4xl"
                >
                    <section className="card">
                        <div className="mb-6 flex items-center justify-between gap-4">
                            <h1 className="font-display text-4xl text-slate-900 md:text-5xl">Published books</h1>
                            <button
                                type="button"
                                onClick={() => userAddress && void loadAuthorBooks(userAddress)}
                                className="btn-secondary"
                            >
                                Refresh
                            </button>
                        </div>

                        {booksLoading ? (
                            <p className="text-sm text-slate-600">Loading your books...</p>
                        ) : authorBooks.length === 0 ? (
                            <p className="text-sm text-slate-600">No books published yet.</p>
                        ) : (
                            <div className="space-y-5">
                                {authorBooks.map((book) => (
                                    <article key={book.id} className="rounded-xl border border-slate-200 p-4">
                                        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Book #{book.id}</p>
                                        <div className="mt-3 grid gap-4 md:grid-cols-2">
                                            <div>
                                                <label className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
                                                    Title
                                                </label>
                                                <input
                                                    type="text"
                                                    value={book.title}
                                                    onChange={(event) => updateAuthorBookField(book.id, 'title', event.target.value)}
                                                    className="input-base"
                                                />
                                            </div>
                                            <div>
                                                <label className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
                                                    Cover URL
                                                </label>
                                                <input
                                                    type="url"
                                                    value={book.coverImageUrl}
                                                    onChange={(event) => updateAuthorBookField(book.id, 'coverImageUrl', event.target.value)}
                                                    className="input-base"
                                                    placeholder="https://example.com/cover.jpg"
                                                />
                                            </div>
                                            <div>
                                                <label className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
                                                    Page price (microSTX)
                                                </label>
                                                <input
                                                    type="number"
                                                    min={0}
                                                    step={100}
                                                    value={book.pagePrice}
                                                    onChange={(event) => updateAuthorBookField(book.id, 'pagePrice', event.target.value)}
                                                    className="input-base"
                                                />
                                            </div>
                                            <div className="flex items-end">
                                                <button
                                                    type="button"
                                                    onClick={() => void saveAuthorBook(book.id)}
                                                    disabled={!!booksSaving[book.id]}
                                                    className="btn-primary w-full"
                                                >
                                                    {booksSaving[book.id] ? 'Saving...' : 'Save updates'}
                                                </button>
                                            </div>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        )}
                    </section>
                </motion.div>
            </main>
        </div>
    );
}

function parseMicroStx(value: string): bigint | null {
    if (!value.trim()) {
        return null;
    }

    try {
        const parsed = BigInt(value);
        if (parsed < BigInt(0)) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

function toEditableBook(book: Book): EditableBook {
    return {
        id: book.id,
        title: book.title,
        coverImageUrl: book.coverImageUrl || '',
        pagePrice: typeof book.pagePrice === 'bigint' ? book.pagePrice.toString() : String(book.pagePrice),
    };
}
