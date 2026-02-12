'use client';

import { useEffect, useState } from 'react';
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
    const { isAuthenticated, connectWallet } = useAuth();
    const [books, setBooks] = useState<Book[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isAuthenticated) {
            setLoading(false);
            return;
        }

        void loadBooks();
    }, [isAuthenticated]);

    async function loadBooks() {
        setLoading(true);
        try {
            const booksData = await apiClient.getBooks();
            setBooks(booksData);
        } catch (error) {
            console.error('Failed to load books:', error);
        } finally {
            setLoading(false);
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
                        <h1 className="font-display text-4xl text-slate-900">Connect to open your library</h1>
                        <p className="mt-5 text-lg leading-8 text-slate-600">
                            Stackpad uses your wallet address to request protected pages and verify x402 unlocks.
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
                        Each book includes transparent page pricing and direct author payout details before unlock.
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
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {books.map((book, index) => (
                            <motion.div
                                key={book.id}
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
                                        </div>

                                        <h3 className="mt-6 font-display text-2xl leading-tight text-slate-900 line-clamp-2">{book.title}</h3>
                                        <p className="mt-2 text-sm tracking-wide text-slate-500">{shortAddress(book.authorAddress)}</p>

                                        <div className="mt-6 flex items-center justify-between border-t border-slate-200 pt-4 text-sm">
                                            <span className="text-slate-500">{book.totalPages} pages</span>
                                            <span className="font-medium text-[hsl(var(--accent))]">{formatStxAmount(book.pagePrice)}/page</span>
                                        </div>
                                    </article>
                                </Link>
                            </motion.div>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}

function defaultCoverForBook(bookId: number): string {
    return `${DEFAULT_COVER_BASE}/stackpad-book-${bookId}/400/600`;
}
