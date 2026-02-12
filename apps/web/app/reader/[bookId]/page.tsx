'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import type { Book } from '@stackpad/shared';
import { formatStxAmount } from '@stackpad/x402-client';
import { apiClient, type X402Diagnostics } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { WalletConnect } from '@/components/WalletConnect';
import { ThemeToggle } from '@/components/ThemeToggle';

type ReaderState = 'idle' | 'loading' | 'locked' | 'error' | 'ready';

interface PaymentInstructions {
    amount: string;
    recipient: string;
    memo: string;
    network: string;
}

export default function ReaderPage() {
    const params = useParams();
    const bookId = parseInt(params.bookId as string, 10);

    const { isAuthenticated, userAddress, connectWallet } = useAuth();

    const [book, setBook] = useState<Book | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageContent, setPageContent] = useState('');
    const [readerState, setReaderState] = useState<ReaderState>('idle');
    const [statusMessage, setStatusMessage] = useState<string | null>(null);

    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [paymentInstructions, setPaymentInstructions] = useState<PaymentInstructions | null>(null);
    const [isDimmed, setIsDimmed] = useState(false);
    const [isSettlingPayment, setIsSettlingPayment] = useState(false);
    const [buyerAddress, setBuyerAddress] = useState<string | null>(null);
    const [x402Diagnostics, setX402Diagnostics] = useState<X402Diagnostics | null>(null);

    const requestCounterRef = useRef(0);

    useEffect(() => {
        if (!isAuthenticated || !userAddress || Number.isNaN(bookId)) {
            return;
        }

        void loadBook();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bookId, isAuthenticated, userAddress]);

    useEffect(() => {
        if (!book || !userAddress) {
            return;
        }

        void loadPageContent(currentPage);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [book, currentPage, userAddress]);

    useEffect(() => {
        if (!isAuthenticated) {
            return;
        }

        let mounted = true;
        void (async () => {
            try {
                const response = await fetch('/api/x402/buyer', { method: 'GET' });
                if (!response.ok || !mounted) {
                    return;
                }
                const data = await response.json() as { buyerAddress?: string };
                if (data.buyerAddress && mounted) {
                    setBuyerAddress(data.buyerAddress);
                    setX402Diagnostics((prev) => ({
                        ...(prev || {}),
                        buyerAddress: data.buyerAddress,
                    }));
                }
            } catch {
                // Diagnostics enrichment only; ignore failures.
            }
        })();

        return () => {
            mounted = false;
        };
    }, [isAuthenticated]);

    async function loadBook() {
        try {
            const bookData = await apiClient.getBook(bookId);
            setBook(bookData);
        } catch (error) {
            console.error('Failed to load book:', error);
            setReaderState('error');
            setStatusMessage('Book could not be loaded.');
        }
    }

    async function loadPageContent(pageNum: number) {
        if (!userAddress) {
            return;
        }

        const requestId = ++requestCounterRef.current;

        setReaderState('loading');
        setStatusMessage(null);
        setIsDimmed(false);

        try {
            const result = await apiClient.getPage(bookId, pageNum, userAddress);
            if (requestId !== requestCounterRef.current) {
                return;
            }

            if (result.content) {
                setPageContent(result.content.content);
                setReaderState('ready');
                setIsDimmed(false);
                setShowPaymentModal(false);
                setStatusMessage(null);
                return;
            }

            if (result.requires402) {
                if (result.paymentInstructions) {
                    setPaymentInstructions(result.paymentInstructions);
                }

                const accepted = result.paymentRequiredV2?.accepts?.[0];
                setX402Diagnostics({
                    readerAddress: userAddress,
                    buyerAddress: buyerAddress || undefined,
                    paymentRequired: accepted ? {
                        amount: accepted.amount,
                        asset: accepted.asset,
                        network: accepted.network,
                        payTo: accepted.payTo,
                        maxTimeoutSeconds: accepted.maxTimeoutSeconds,
                        memo: accepted.extra?.memo as string | undefined,
                    } : undefined,
                    httpStatus: 402,
                });

                setReaderState('locked');
                setIsDimmed(true);
                if (result.error) {
                    const details = result.details ? ` (${result.details})` : '';
                    setStatusMessage(`${result.error}${details}`);
                }
                setShowPaymentModal(true);
                return;
            }

            setReaderState('error');
            setPageContent(result.error || 'Failed to load page content');
        } catch (error) {
            console.error('Failed to load page:', error);
            setReaderState('error');
            setPageContent('Failed to load page content');
        }
    }

    async function settleWithStrictBuyerAdapter() {
        if (!userAddress) {
            return;
        }

        setIsSettlingPayment(true);
        setReaderState('loading');
        setStatusMessage('Settling payment via strict x402 buyer adapter...');

        try {
            const result = await apiClient.payPageWithX402Adapter(bookId, currentPage, userAddress);
            if (result.buyerAddress) {
                setBuyerAddress(result.buyerAddress);
            }
            if (result.diagnostics) {
                setX402Diagnostics(result.diagnostics);
            }

            if (result.content) {
                setPageContent(result.content.content);
                setReaderState('ready');
                setIsDimmed(false);
                setShowPaymentModal(false);
                setStatusMessage(null);
                return;
            }

            setReaderState('locked');
            setIsDimmed(true);
            setShowPaymentModal(true);
            setStatusMessage(result.details || result.error || 'Payment settlement failed');
            if (!result.diagnostics) {
                setX402Diagnostics({
                    readerAddress: result.readerAddress || userAddress,
                    buyerAddress: result.buyerAddress || buyerAddress || undefined,
                    error: result.error,
                    details: result.details,
                });
            }
        } catch (error) {
            console.error('Strict x402 payment failed:', error);
            setReaderState('locked');
            setIsDimmed(true);
            setShowPaymentModal(true);
            setStatusMessage(error instanceof Error ? error.message : 'Payment settlement failed');
            setX402Diagnostics({
                readerAddress: userAddress,
                buyerAddress: buyerAddress || undefined,
                error: error instanceof Error ? error.message : 'Payment settlement failed',
            });
        } finally {
            setIsSettlingPayment(false);
        }
    }

    function goToNextPage() {
        if (!book || currentPage >= book.totalPages) {
            return;
        }
        setPaymentInstructions(null);
        setCurrentPage((prev) => prev + 1);
    }

    function goToPrevPage() {
        if (currentPage <= 1) {
            return;
        }
        setPaymentInstructions(null);
        setCurrentPage((prev) => prev - 1);
    }

    function handleDragEnd(info: PanInfo) {
        const threshold = 50;
        if (info.offset.x < -threshold) {
            goToNextPage();
        } else if (info.offset.x > threshold) {
            goToPrevPage();
        }
    }

    if (!isAuthenticated) {
        return (
            <div className="app-shell">
                <header className="topbar">
                    <div className="layout-wrap flex h-20 items-center justify-between">
                        <Link href="/" className="font-display text-3xl tracking-tight text-slate-900">Stackpad</Link>
                        <ThemeToggle />
                    </div>
                </header>
                <main className="layout-wrap flex min-h-[72vh] items-center justify-center py-16">
                    <div className="surface w-full max-w-xl p-10 text-center md:p-12">
                        <h1 className="font-display text-4xl text-slate-900">Connect to read</h1>
                        <p className="mt-5 text-lg leading-8 text-slate-600">
                            A connected wallet is required to load your reader identity for x402 content requests.
                        </p>
                        <div className="mt-10 flex justify-center">
                            <button onClick={connectWallet} className="btn-primary">Connect wallet</button>
                        </div>
                    </div>
                </main>
            </div>
        );
    }

    if (!book && readerState === 'error') {
        return (
            <div className="app-shell">
                <main className="layout-wrap flex min-h-screen items-center justify-center py-16">
                    <div className="surface w-full max-w-xl p-10 text-center md:p-12">
                        <h1 className="font-display text-4xl text-slate-900">Book not found</h1>
                        <p className="mt-5 text-lg leading-8 text-slate-600">This book could not be loaded.</p>
                        <div className="mt-10">
                            <Link href="/library" className="btn-primary">Return to library</Link>
                        </div>
                    </div>
                </main>
            </div>
        );
    }

    const progress = book ? (currentPage / book.totalPages) * 100 : 0;

    return (
        <div className="app-shell">
            <header className="topbar">
                <div className="layout-wrap flex h-20 items-center justify-between gap-4">
                    <Link href="/library" className="text-sm text-slate-600 transition-colors hover:text-slate-900">Library</Link>
                    <div className="min-w-0 flex-1 px-2 text-center">
                        <p className="truncate font-display text-2xl text-slate-900 md:text-3xl">{book?.title || 'Loading...'}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">
                            Page {currentPage}{book ? ` of ${book.totalPages}` : ''}
                        </p>
                    </div>
                    <ThemeToggle />
                    <WalletConnect />
                </div>
                <div className="layout-wrap pb-3">
                    <div className="h-[3px] w-full overflow-hidden rounded-full bg-slate-200">
                        <div
                            className="h-full rounded-full bg-[hsl(var(--accent))] transition-all duration-300"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>
            </header>

            <main className="layout-wrap py-8 md:py-10">
                <motion.section
                    drag="x"
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0.16}
                    onDragEnd={(_, info) => handleDragEnd(info)}
                    className="surface relative min-h-[68vh] overflow-hidden px-7 py-10 md:px-16 md:py-14"
                >
                    <AnimatePresence mode="wait">
                        {readerState === 'loading' || readerState === 'idle' ? (
                            <motion.div
                                key="loading"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="flex min-h-[50vh] items-center justify-center"
                            >
                                <div className="text-center">
                                    <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-b-[hsl(var(--accent))]" />
                                    <p className="mt-4 text-sm text-slate-500">Loading page...</p>
                                </div>
                            </motion.div>
                        ) : (
                            <motion.div
                                key={`page-${currentPage}-${readerState}`}
                                initial={{ opacity: 0, x: 16 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -16 }}
                                transition={{ duration: 0.28, ease: 'easeOut' }}
                                className="relative"
                            >
                                <article className="reader-copy min-h-[56vh] whitespace-pre-wrap">
                                    {readerState === 'error' ? statusMessage || pageContent : pageContent}
                                </article>

                                {isDimmed && (
                                    <div className="absolute inset-0 z-10 rounded-2xl bg-[rgba(248,246,241,0.72)] backdrop-blur-[1.5px]">
                                        <div className="absolute left-4 top-4 rounded-full bg-white/85 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-slate-600">
                                            Page locked
                                        </div>
                                    </div>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.section>

                <div className="mt-6 flex items-center justify-between gap-3">
                    <button
                        onClick={goToPrevPage}
                        disabled={currentPage === 1}
                        className="btn-secondary min-w-[8.5rem] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Previous
                    </button>

                    {readerState === 'locked' ? (
                        <button
                            onClick={() => setShowPaymentModal(true)}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-xs uppercase tracking-[0.14em] text-slate-700 hover:bg-slate-50"
                        >
                            Unlock page
                        </button>
                    ) : (
                        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Swipe horizontally</p>
                    )}

                    <button
                        onClick={goToNextPage}
                        disabled={!book || currentPage >= book.totalPages}
                        className="btn-secondary min-w-[8.5rem] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Next
                    </button>
                </div>

                <section className="surface mt-6 rounded-2xl p-4 md:p-5">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">x402 diagnostics</p>
                    <div className="mt-3 grid gap-2 text-xs text-slate-600">
                        <p className="break-all">
                            Entitlement check address: {x402Diagnostics?.readerAddress ?? userAddress ?? 'n/a'}
                        </p>
                        <p className="break-all">
                            Buyer signer account: {x402Diagnostics?.buyerAddress ?? buyerAddress ?? 'n/a'}
                        </p>
                        <p className="break-all">
                            payTo (author): {x402Diagnostics?.paymentRequired?.payTo ?? paymentInstructions?.recipient ?? 'n/a'}
                        </p>
                        <p>
                            amount: {x402Diagnostics?.paymentRequired?.amount
                                ? formatStxAmount(x402Diagnostics.paymentRequired.amount)
                                : paymentInstructions?.amount
                                    ? formatStxAmount(paymentInstructions.amount)
                                    : 'n/a'}
                        </p>
                        <p>
                            network: {x402Diagnostics?.paymentRequired?.network ?? paymentInstructions?.network ?? 'n/a'}
                        </p>
                        <p>last HTTP status: {x402Diagnostics?.httpStatus ?? (readerState === 'locked' ? 402 : 'n/a')}</p>
                        <p className="break-all">
                            settlement tx: {x402Diagnostics?.paymentResponse?.transaction ?? 'n/a'}
                        </p>
                        <p className="break-all">
                            settlement payer: {x402Diagnostics?.paymentResponse?.payer ?? 'n/a'}
                        </p>
                        {(x402Diagnostics?.error || x402Diagnostics?.details) && (
                            <p className="break-all text-rose-700">
                                last error: {x402Diagnostics?.error || x402Diagnostics?.details}
                                {x402Diagnostics?.error && x402Diagnostics?.details ? ` (${x402Diagnostics.details})` : ''}
                            </p>
                        )}
                    </div>
                </section>
            </main>

            <AnimatePresence>
                {showPaymentModal && paymentInstructions && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setShowPaymentModal(false)}
                            className="fixed inset-0 z-40 bg-black/40"
                        />

                        <div className="fixed inset-x-0 bottom-0 z-50 px-4 pb-6 md:inset-0 md:flex md:items-center md:justify-center md:pb-0">
                            <motion.div
                                initial={{ opacity: 0, y: 32 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 32 }}
                                transition={{ duration: 0.24, ease: 'easeOut' }}
                                className="surface mx-auto w-full max-w-md rounded-3xl p-6 shadow-[0_20px_40px_rgba(15,23,42,0.12)]"
                            >
                                <div className="mb-5 flex items-start justify-between">
                                    <div>
                                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Strict x402 v2 buyer</p>
                                        <h2 className="mt-2 text-2xl font-display text-slate-900">Settle payment for page {currentPage}</h2>
                                    </div>
                                    <button onClick={() => setShowPaymentModal(false)} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-50">
                                        ×
                                    </button>
                                </div>

                                <div className="surface mb-5 rounded-2xl bg-slate-50/70 p-4">
                                    <p className="text-sm text-slate-500">Price</p>
                                    <p className="mt-1 text-3xl font-display text-slate-900">{formatStxAmount(paymentInstructions.amount)}</p>
                                    <p className="mt-3 break-all text-sm text-slate-500">Paid to: {paymentInstructions.recipient}</p>
                                </div>

                                {statusMessage && (
                                    <p className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                                        {statusMessage}
                                    </p>
                                )}

                                <div className="flex gap-3">
                                    <button onClick={() => setShowPaymentModal(false)} disabled={isSettlingPayment} className="btn-secondary flex-1">
                                        Cancel
                                    </button>
                                    <button onClick={() => void settleWithStrictBuyerAdapter()} disabled={isSettlingPayment} className="btn-primary flex-1">
                                        {isSettlingPayment ? 'Settling...' : 'Pay via adapter'}
                                    </button>
                                </div>
                            </motion.div>
                        </div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
