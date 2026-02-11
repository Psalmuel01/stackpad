'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { WalletConnect } from '@/components/WalletConnect';

const CHARS_PER_PAGE = 1500;

export default function AuthorPage() {
    const { isAuthenticated, userAddress } = useAuth();
    const [uploading, setUploading] = useState(false);

    // Form State
    const [bookTitle, setBookTitle] = useState('');
    const [coverUrl, setCoverUrl] = useState('');
    const [bookContent, setBookContent] = useState('');
    const [pagePrice, setPagePrice] = useState('100000'); // microSTX

    // Calculated State
    const totalPages = Math.ceil(bookContent.length / CHARS_PER_PAGE) || 1;
    const [message, setMessage] = useState('');

    const handleUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!userAddress) return;

        if (!bookContent.trim()) {
            setMessage('❌ Please enter book content');
            return;
        }

        setUploading(true);
        setMessage('');

        try {
            // Chunk content into pages
            const pages = [];
            for (let i = 0; i < totalPages; i++) {
                const start = i * CHARS_PER_PAGE;
                const end = start + CHARS_PER_PAGE;
                pages.push({
                    pageNumber: i + 1,
                    chapterNumber: 1, // Simple single chapter for now
                    content: bookContent.slice(start, end),
                });
            }

            await apiClient.uploadBook(
                {
                    authorAddress: userAddress,
                    title: bookTitle,
                    coverImageUrl: coverUrl || undefined,
                    totalPages,
                    totalChapters: 1,
                    pagePrice,
                    chapterPrice: String(BigInt(pagePrice) * BigInt(5)), // Auto-calc chapter price
                },
                pages
            );

            setMessage('✅ Book uploaded successfully!');
            // Reset form
            setBookTitle('');
            setCoverUrl('');
            setBookContent('');
        } catch (error) {
            setMessage('❌ Failed to upload book');
            console.error(error);
        } finally {
            setUploading(false);
        }
    };

    const handleSampleContent = () => {
        const sample = `It was the best of times, it was the worst of times... 
    
(This is a sample book content that is long enough to span multiple pages. In a real application, this would be the actual text of the book that you want to sell.)

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

[... repeating content for demo ...]
    `.repeat(50);
        setBookTitle("A Tale of Two Cities (Sample)");
        setBookContent(sample);
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
            <header className="glass sticky top-0 z-10 border-b border-white/20">
                <div className="container mx-auto px-4 py-4">
                    <div className="flex justify-between items-center">
                        <Link href="/" className="text-2xl font-display font-bold bg-gradient-to-r from-primary-600 to-accent-600 bg-clip-text text-transparent">
                            Stackpad
                        </Link>
                        <div className="flex items-center gap-4">
                            <Link href="/library" className="btn-secondary text-sm">
                                Back to Library
                            </Link>
                            <WalletConnect />
                        </div>
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-4 py-12">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="max-w-3xl mx-auto"
                >
                    <h1 className="text-4xl font-display font-bold mb-8 text-slate-900 dark:text-white">
                        ✍️ Author Dashboard
                    </h1>

                    <div className="card">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-2xl font-bold">Upload New Book</h2>
                            <button
                                type="button"
                                onClick={handleSampleContent}
                                className="text-sm text-primary-600 hover:text-primary-700 font-semibold"
                            >
                                Auto-fill Sample
                            </button>
                        </div>

                        <form onSubmit={handleUpload} className="space-y-6">
                            {/* Title */}
                            <div>
                                <label className="block text-sm font-semibold mb-2 text-slate-700 dark:text-slate-300">
                                    Book Title
                                </label>
                                <input
                                    type="text"
                                    value={bookTitle}
                                    onChange={(e) => setBookTitle(e.target.value)}
                                    required
                                    className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:border-primary-500 focus:ring-2 focus:ring-primary-200 dark:focus:ring-primary-900 transition-colors"
                                    placeholder="Enter book title..."
                                />
                            </div>

                            {/* Cover Image URL */}
                            <div>
                                <label className="block text-sm font-semibold mb-2 text-slate-700 dark:text-slate-300">
                                    Cover Image URL (Optional)
                                </label>
                                <input
                                    type="url"
                                    value={coverUrl}
                                    onChange={(e) => setCoverUrl(e.target.value)}
                                    className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:border-primary-500 transition-colors"
                                    placeholder="https://example.com/cover.jpg"
                                />
                            </div>

                            {/* Content Input */}
                            <div>
                                <label className="block text-sm font-semibold mb-2 text-slate-700 dark:text-slate-300">
                                    Book Content (Text)
                                </label>
                                <textarea
                                    value={bookContent}
                                    onChange={(e) => setBookContent(e.target.value)}
                                    required
                                    rows={12}
                                    className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:border-primary-500 transition-colors font-mono text-sm leading-relaxed"
                                    placeholder="Paste your book content here..."
                                />
                                <p className="text-xs text-slate-500 mt-2 text-right">
                                    {bookContent.length} characters • ~{totalPages} pages
                                </p>
                            </div>

                            {/* Pricing */}
                            <div>
                                <label className="block text-sm font-semibold mb-2 text-slate-700 dark:text-slate-300">
                                    Price per Page (microSTX)
                                </label>
                                <input
                                    type="number"
                                    value={pagePrice}
                                    onChange={(e) => setPagePrice(e.target.value)}
                                    min={0}
                                    step={100}
                                    required
                                    className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:border-primary-500 transition-colors"
                                />
                                <p className="text-xs text-slate-500 mt-1">
                                    1 STX = 1,000,000 microSTX. Example: 100000 = 0.1 STX
                                </p>
                            </div>

                            {/* Status Message */}
                            {message && (
                                <div className={`p-4 rounded-xl ${message.startsWith('✅') ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'}`}>
                                    {message}
                                </div>
                            )}

                            {/* Submit Button */}
                            <button
                                type="submit"
                                disabled={uploading}
                                className="btn-primary w-full text-lg py-4"
                            >
                                {uploading ? 'Processing & Uploading...' : 'Publish Book'}
                            </button>
                        </form>
                    </div>
                </motion.div>
            </main>
        </div>
    );
}
