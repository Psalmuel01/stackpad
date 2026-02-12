'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api';
import { WalletConnect } from '@/components/WalletConnect';

const CHARS_PER_PAGE = 1500;

type NoticeTone = 'success' | 'error';

interface Notice {
    text: string;
    tone: NoticeTone;
}

export default function AuthorPage() {
    const { isAuthenticated, userAddress, connectWallet } = useAuth();
    const [uploading, setUploading] = useState(false);

    const [bookTitle, setBookTitle] = useState('');
    const [coverUrl, setCoverUrl] = useState('');
    const [bookContent, setBookContent] = useState('');
    const [pagePrice, setPagePrice] = useState('100000');
    const [contractBookId, setContractBookId] = useState('');

    const [notice, setNotice] = useState<Notice | null>(null);

    const totalPages = useMemo(() => Math.max(1, Math.ceil(bookContent.length / CHARS_PER_PAGE)), [bookContent.length]);

    async function handleUpload(event: React.FormEvent) {
        event.preventDefault();
        if (!userAddress) {
            return;
        }

        if (!bookContent.trim()) {
            setNotice({ text: 'Please add content before publishing.', tone: 'error' });
            return;
        }

        setUploading(true);
        setNotice(null);

        try {
            const pages = [];
            for (let i = 0; i < totalPages; i += 1) {
                const start = i * CHARS_PER_PAGE;
                const end = start + CHARS_PER_PAGE;
                pages.push({
                    pageNumber: i + 1,
                    chapterNumber: 1,
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
                    chapterPrice: String(BigInt(pagePrice) * BigInt(5)),
                    contractBookId: contractBookId ? Number(contractBookId) : undefined,
                },
                pages
            );

            setNotice({ text: 'Book uploaded successfully.', tone: 'success' });
            setBookTitle('');
            setCoverUrl('');
            setBookContent('');
            setContractBookId('');
        } catch (error) {
            console.error(error);
            setNotice({ text: 'Upload failed. Check server logs and try again.', tone: 'error' });
        } finally {
            setUploading(false);
        }
    }

    function handleSampleContent() {
        const sample = `It was the best of times, it was the worst of times.\n\nThis sample content is used to create enough text for multiple pages in Stackpad.\n\n`.repeat(140);
        setBookTitle('A Tale of Two Cities (Sample)');
        setBookContent(sample);
    }

    if (!isAuthenticated) {
        return (
            <div className="app-shell">
                <header className="topbar">
                    <div className="layout-wrap flex h-20 items-center justify-between">
                        <Link href="/" className="font-display text-3xl tracking-tight text-slate-900">Stackpad</Link>
                    </div>
                </header>
                <main className="layout-wrap flex min-h-[72vh] items-center justify-center py-16">
                    <div className="surface w-full max-w-xl p-10 text-center md:p-12">
                        <h1 className="font-display text-4xl text-slate-900">Connect to publish</h1>
                        <p className="mt-5 text-lg leading-8 text-slate-600">
                            Your wallet address is used as the default author payout destination for newly uploaded books.
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
                    <Link href="/" className="font-display text-3xl tracking-tight text-slate-900">Stackpad</Link>
                    <div className="flex items-center gap-3">
                        <Link href="/library" className="btn-secondary">Library</Link>
                        <WalletConnect />
                    </div>
                </div>
            </header>

            <main className="layout-wrap py-14 md:py-20">
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35 }}
                    className="mx-auto max-w-3xl"
                >
                    <div className="mb-11">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Author</p>
                        <h1 className="mt-5 font-display text-5xl leading-tight text-slate-900 md:text-6xl">
                            Publish chapters with page-level pricing.
                        </h1>
                        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
                            Upload raw text, set microSTX pricing, and connect off-chain metadata to your on-chain book ID.
                        </p>
                    </div>

                    <section className="card">
                        <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
                            <h2 className="font-display text-3xl text-slate-900">New book</h2>
                            <button type="button" onClick={handleSampleContent} className="btn-secondary">Load sample text</button>
                        </div>

                        <form onSubmit={handleUpload} className="space-y-7">
                            <div>
                                <label htmlFor="book-title" className="mb-2 block text-sm font-medium text-slate-700">
                                    Book title
                                </label>
                                <input
                                    id="book-title"
                                    type="text"
                                    value={bookTitle}
                                    onChange={(event) => setBookTitle(event.target.value)}
                                    required
                                    className="input-base"
                                    placeholder="Enter title"
                                />
                            </div>

                            <div>
                                <label htmlFor="cover-url" className="mb-2 block text-sm font-medium text-slate-700">
                                    Cover image URL (optional)
                                </label>
                                <input
                                    id="cover-url"
                                    type="url"
                                    value={coverUrl}
                                    onChange={(event) => setCoverUrl(event.target.value)}
                                    className="input-base"
                                    placeholder="https://example.com/cover.jpg"
                                />
                            </div>

                            <div>
                                <label htmlFor="book-content" className="mb-2 block text-sm font-medium text-slate-700">
                                    Book content
                                </label>
                                <textarea
                                    id="book-content"
                                    value={bookContent}
                                    onChange={(event) => setBookContent(event.target.value)}
                                    required
                                    rows={14}
                                    className="input-base font-mono text-sm leading-relaxed"
                                    placeholder="Paste full text"
                                />
                                <p className="mt-2 text-right text-xs text-slate-500">
                                    {bookContent.length} characters · about {totalPages} pages
                                </p>
                            </div>

                            <div>
                                <label htmlFor="page-price" className="mb-2 block text-sm font-medium text-slate-700">
                                    Price per page (microSTX)
                                </label>
                                <input
                                    id="page-price"
                                    type="number"
                                    value={pagePrice}
                                    onChange={(event) => setPagePrice(event.target.value)}
                                    required
                                    min={0}
                                    step={100}
                                    className="input-base"
                                />
                                <p className="mt-2 text-xs text-slate-500">1 STX = 1,000,000 microSTX.</p>
                            </div>

                            <div>
                                <label htmlFor="contract-book-id" className="mb-2 block text-sm font-medium text-slate-700">
                                    On-chain book ID (optional)
                                </label>
                                <input
                                    id="contract-book-id"
                                    type="number"
                                    value={contractBookId}
                                    onChange={(event) => setContractBookId(event.target.value)}
                                    min={1}
                                    step={1}
                                    className="input-base"
                                    placeholder="Book ID from contract"
                                />
                            </div>

                            {notice && (
                                <div
                                    className={[
                                        'rounded-xl border px-4 py-3 text-sm',
                                        notice.tone === 'success'
                                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                            : 'border-rose-200 bg-rose-50 text-rose-700',
                                    ].join(' ')}
                                >
                                    {notice.text}
                                </div>
                            )}

                            <button type="submit" disabled={uploading} className="btn-primary w-full py-3 text-base">
                                {uploading ? 'Uploading...' : 'Publish book'}
                            </button>
                        </form>
                    </section>
                </motion.div>
            </main>
        </div>
    );
}
