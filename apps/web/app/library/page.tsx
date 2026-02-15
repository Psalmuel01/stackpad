'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import type { Book } from '@stackpad/shared';
import { formatStxAmount } from '@stackpad/x402-client';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api';
import { WalletConnect } from '@/components/WalletConnect';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BrandLogo } from '@/components/BrandLogo';

const DEFAULT_COVER_BASE = 'https://picsum.photos/seed';

function shortAddress(address?: string) {
    if (!address) {
        return 'Unknown author';
    }
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function LibraryPage() {
    const { isAuthenticated, userAddress, connectWallet } = useAuth();
    const [books, setBooks] = useState<Book[]>([]);
    const [progressMap, setProgressMap] = useState<Record<number, number>>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isAuthenticated || !userAddress) {
            setLoading(false);
            setProgressMap({});
            return;
        }

        void loadBooksAndProgress(userAddress);
    }, [isAuthenticated, userAddress]);

    async function loadBooksAndProgress(address: string) {
        setLoading(true);
        try {
            const [booksData, progressData] = await Promise.all([
                apiClient.getBooks(),
                apiClient.getLibraryProgress(address),
            ]);
            setBooks(booksData);

            const byBookId: Record<number, number> = {};
            for (const progress of progressData) {
                byBookId[progress.bookId] = progress.lastPage;
            }
            setProgressMap(byBookId);
        } catch (error) {
            console.error('Failed to load books:', error);
            setProgressMap({});
        } finally {
            setLoading(false);
        }
    }

    const booksWithProgress = useMemo(() => {
        return books.map((book) => {
            const lastPage = progressMap[book.id] || 0;
            const completionPercentage = calculateCompletion(lastPage, book.totalPages);
            return {
                book,
                lastPage,
                completionPercentage,
            };
        });
    }, [books, progressMap]);

    const inProgressBooks = booksWithProgress.filter((item) => item.completionPercentage > 0 && item.completionPercentage < 100);
    const completedBooks = booksWithProgress.filter((item) => item.completionPercentage >= 100);
    const unstartedBooks = booksWithProgress.filter((item) => item.completionPercentage === 0);

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
                        <h1 className="font-display text-4xl text-slate-900">Connect to open your library</h1>
                        <p className="mt-5 text-lg leading-8 text-slate-600">
                            Stackpad uses your wallet address to manage reading credits and unlock protected pages.
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
                    className="mb-12 md:mb-16"
                >
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Library</p>
                    <h1 className="mt-5 max-w-3xl font-display text-5xl leading-tight text-slate-900 md:text-6xl">
                        Pick a title and continue where you left off.
                    </h1>
                    <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
                        Each book includes transparent page pricing with automatic deduction from your prepaid balance.
                    </p>
                </motion.div>

                {loading ? (
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {Array.from({ length: 8 }).map((_, index) => (
                            <div key={index} className="card animate-pulse">
                                <div className="h-64 rounded-xl bg-slate-100" />
                                <div className="mt-6 h-6 w-3/4 rounded bg-slate-100" />
                                <div className="mt-3 h-4 w-1/2 rounded bg-slate-100" />
                                <div className="mt-6 h-4 w-full rounded bg-slate-100" />
                            </div>
                        ))}
                    </div>
                ) : books.length === 0 ? (
                    <div className="surface p-12 text-center md:p-16">
                        <h2 className="font-display text-4xl text-slate-900">No books yet</h2>
                        <p className="mx-auto mt-5 max-w-xl text-lg leading-8 text-slate-600">
                            Publish your first title from the author view to start testing pay-per-page access.
                        </p>
                        <div className="mt-9">
                            <Link href="/author" className="btn-primary">Open author view</Link>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-10">
                        {inProgressBooks.length > 0 && (
                            <section>
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="font-display text-3xl text-slate-900">Continue reading</h2>
                                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">{inProgressBooks.length} in progress</p>
                                </div>
                                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                    {inProgressBooks.map((item, index) => (
                                        <BookCard
                                            key={item.book.id}
                                            book={item.book}
                                            index={index}
                                            completionPercentage={item.completionPercentage}
                                            lastPage={item.lastPage}
                                        />
                                    ))}
                                </div>
                            </section>
                        )}

                        {completedBooks.length > 0 && (
                            <section>
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="font-display text-3xl text-slate-900">Completed</h2>
                                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Reread anytime</p>
                                </div>
                                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                    {completedBooks.map((item, index) => (
                                        <BookCard
                                            key={item.book.id}
                                            book={item.book}
                                            index={index}
                                            completionPercentage={item.completionPercentage}
                                            lastPage={item.lastPage}
                                            completed
                                        />
                                    ))}
                                </div>
                            </section>
                        )}

                        {unstartedBooks.length > 0 && (
                            <section>
                                <div className="mb-4 flex items-center justify-between">
                                    <h2 className="font-display text-3xl text-slate-900">Discover more</h2>
                                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">{unstartedBooks.length} not started</p>
                                </div>
                                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                    {unstartedBooks.map((item, index) => (
                                        <BookCard
                                            key={item.book.id}
                                            book={item.book}
                                            index={index}
                                            completionPercentage={item.completionPercentage}
                                            lastPage={item.lastPage}
                                        />
                                    ))}
                                </div>
                            </section>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}

function defaultCoverForBook(bookId: number): string {
    return `${DEFAULT_COVER_BASE}/stackpad-book-${bookId}/400/600`;
}

function calculateCompletion(lastPage: number, totalPages: number): number {
    if (!Number.isInteger(totalPages) || totalPages < 1) {
        return 0;
    }

    if (!Number.isInteger(lastPage) || lastPage < 1) {
        return 0;
    }

    const raw = Math.round((Math.min(lastPage, totalPages) / totalPages) * 100);
    return Math.min(100, Math.max(0, raw));
}

function BookCard({
    book,
    index,
    completionPercentage,
    lastPage,
    completed = false,
}: {
    book: Book;
    index: number;
    completionPercentage: number;
    lastPage: number;
    completed?: boolean;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, delay: index * 0.04 }}
        >
            <Link href={`/reader/${book.id}`} className="group block h-full">
                <article className="card h-full transition-shadow duration-200 group-hover:shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
                    <div className="relative h-64 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                        <Image
                            src={book.coverImageUrl || defaultCoverForBook(book.id)}
                            alt={book.title}
                            fill
                            unoptimized
                            className="object-cover transition duration-500 group-hover:scale-[1.02]"
                        />
                        {completed && (
                            <div className="absolute left-3 top-3 rounded-full border border-slate-200 bg-white/90 px-2 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-700">
                                Completed
                            </div>
                        )}
                    </div>

                    <h3 className="mt-6 font-display text-2xl leading-tight text-slate-900 line-clamp-2">{book.title}</h3>
                    <p className="mt-2 text-sm tracking-wide text-slate-500">{shortAddress(book.authorAddress)}</p>

                    <div className="mt-4">
                        <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.12em] text-slate-500">
                            <span>{completed ? 'Ready to reread' : (completionPercentage > 0 ? `Page ${Math.min(lastPage, book.totalPages)} reached` : 'Not started')}</span>
                            <span>{completionPercentage}%</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                            <div
                                className="h-full rounded-full bg-[hsl(var(--accent))] transition-all duration-300"
                                style={{ width: `${completionPercentage}%` }}
                            />
                        </div>
                    </div>

                    <div className="mt-6 flex items-center justify-between border-t border-slate-200 pt-4 text-sm">
                        <span className="text-slate-500">{book.totalPages} pages</span>
                        <span className="font-medium text-[hsl(var(--accent))]">{formatStxAmount(book.pagePrice)}/page</span>
                    </div>
                </article>
            </Link>
        </motion.div>
    );
}
