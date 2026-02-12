'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api';
import type { Book } from '@stackpad/shared';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { WalletConnect } from '@/components/WalletConnect';
import { formatStxAmount } from '@stackpad/x402-client';

export default function LibraryPage() {
    const { isAuthenticated } = useAuth();
    const [books, setBooks] = useState<Book[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (isAuthenticated) {
            loadBooks();
        }
    }, [isAuthenticated]);

    const loadBooks = async () => {
        try {
            const booksData = await apiClient.getBooks();
            setBooks(booksData);
        } catch (error) {
            console.error('Failed to load books:', error);
        } finally {
            setLoading(false);
        }
    };

    if (!isAuthenticated) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-indigo-950">
                <div className="text-center">
                    <h1 className="text-3xl font-bold mb-4">Please connect your wallet</h1>
                    <Link href="/" className="btn-primary">
                        Go to Home
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-slate-900 dark:via-slate-800 dark:to-indigo-950">
            {/* Header */}
            <header className="glass sticky top-0 z-10 border-b border-white/20">
                <div className="container mx-auto px-4 py-4">
                    <div className="flex justify-between items-center">
                        <Link href="/" className="text-2xl font-display font-bold bg-gradient-to-r from-primary-600 to-accent-600 bg-clip-text text-transparent">
                            Stackpad
                        </Link>
                        <div className="flex items-center gap-4">
                            <Link href="/author" className="btn-secondary text-sm">
                                Author Dashboard
                            </Link>
                            <WalletConnect />
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="container mx-auto px-4 py-12">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                >
                    <h1 className="text-4xl font-display font-bold mb-8 text-slate-900 dark:text-white">
                        📚 Your Library
                    </h1>

                    {loading ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {[...Array(8)].map((_, i) => (
                                <div key={i} className="card h-96 animate-pulse">
                                    <div className="bg-slate-200 dark:bg-slate-700 h-64 rounded-lg mb-4"></div>
                                    <div className="bg-slate-200 dark:bg-slate-700 h-6 rounded mb-2"></div>
                                    <div className="bg-slate-200 dark:bg-slate-700 h-4 rounded w-2/3"></div>
                                </div>
                            ))}
                        </div>
                    ) : books.length === 0 ? (
                        <div className="card text-center py-20">
                            <div className="text-6xl mb-4">📖</div>
                            <h2 className="text-2xl font-bold mb-2">No books available yet</h2>
                            <p className="text-slate-600 dark:text-slate-300 mb-6">
                                Check back soon for new releases or become an author!
                            </p>
                            <Link href="/author" className="btn-primary inline-block">
                                Become an Author
                            </Link>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {books.map((book, index) => (
                                <motion.div
                                    key={book.id}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.4, delay: index * 0.05 }}
                                >
                                    <Link href={`/reader/${book.id}`}>
                                        <div className="card group hover:shadow-2xl transition-all duration-300 hover:scale-105 cursor-pointer h-full">
                                            {/* Cover Image */}
                                            <div className="relative h-64 rounded-lg overflow-hidden mb-4 bg-gradient-to-br from-primary-100 to-accent-100 dark:from-primary-900 dark:to-accent-900">
                                                {book.coverImageUrl ? (
                                                    <Image
                                                        src={book.coverImageUrl}
                                                        alt={book.title}
                                                        fill
                                                        unoptimized
                                                        className="object-cover"
                                                    />
                                                ) : (
                                                    <div className="flex items-center justify-center h-full text-6xl">
                                                        📖
                                                    </div>
                                                )}
                                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                                                    <span className="text-white font-semibold">Read Now →</span>
                                                </div>
                                            </div>

                                            {/* Book Info */}
                                            <h3 className="text-lg font-bold mb-2 line-clamp-2 text-slate-900 dark:text-white">
                                                {book.title}
                                            </h3>
                                            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                                                By {book.authorAddress ? `${book.authorAddress.slice(0, 6)}...${book.authorAddress.slice(-4)}` : 'Unknown Author'}
                                            </p>

                                            {/* Pricing */}
                                            <div className="flex justify-between items-center text-sm">
                                                <span className="text-slate-600 dark:text-slate-300">
                                                    {book.totalPages} pages
                                                </span>
                                                <span className="font-semibold text-primary-600 dark:text-primary-400">
                                                    {formatStxAmount(book.pagePrice)}/page
                                                </span>
                                            </div>
                                        </div>
                                    </Link>
                                </motion.div>
                            ))}
                        </div>
                    )}
                </motion.div>
            </main>
        </div>
    );
}
