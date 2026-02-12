'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import type { Book } from '@stackpad/shared';
import { formatStxAmount } from '@stackpad/x402-client';
import { apiClient, type BundleType, type UnlockOption, type UnlockPreview } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { usePayment } from '@/hooks/usePayment';
import { WalletConnect } from '@/components/WalletConnect';

type ReaderState = 'idle' | 'loading' | 'locked' | 'unlocking' | 'depositing' | 'error' | 'ready';

export default function ReaderPage() {
    const params = useParams();
    const bookId = parseInt(params.bookId as string, 10);

    const { isAuthenticated, userAddress, connectWallet } = useAuth();
    const { initiatePayment, isPaying } = usePayment();

    const [book, setBook] = useState<Book | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageContent, setPageContent] = useState('');
    const [readerState, setReaderState] = useState<ReaderState>('idle');
    const [statusMessage, setStatusMessage] = useState<string | null>(null);

    const [isDimmed, setIsDimmed] = useState(false);
    const [showUnlockModal, setShowUnlockModal] = useState(false);
    const [unlockPreview, setUnlockPreview] = useState<UnlockPreview | null>(null);
    const [selectedBundle, setSelectedBundle] = useState<BundleType>('next-5-pages');

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

    const actionableOptions = useMemo(() => {
        return (unlockPreview?.options || []).filter((option) => option.remainingPages > 0);
    }, [unlockPreview]);

    const selectedOption = useMemo(() => {
        return actionableOptions.find((option) => option.bundleType === selectedBundle)
            || actionableOptions[0]
            || null;
    }, [actionableOptions, selectedBundle]);

    useEffect(() => {
        if (actionableOptions.length > 0 && !actionableOptions.some((option) => option.bundleType === selectedBundle)) {
            setSelectedBundle(actionableOptions[0].bundleType);
        }
    }, [actionableOptions, selectedBundle]);

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
                setShowUnlockModal(false);
                setUnlockPreview(null);
                return;
            }

            if (result.requires402) {
                setReaderState('locked');
                setIsDimmed(true);
                setStatusMessage(result.details || result.error || 'Balance required to continue reading.');

                if (result.unlockPreview) {
                    setUnlockPreview(result.unlockPreview);
                } else {
                    try {
                        const preview = await apiClient.getUnlockPreview(userAddress, bookId, pageNum);
                        if (requestId !== requestCounterRef.current) {
                            return;
                        }
                        setUnlockPreview(preview);
                    } catch (previewError) {
                        console.error('Failed to load unlock preview:', previewError);
                    }
                }
                return;
            }

            setReaderState('error');
            setStatusMessage(result.error || 'Failed to load page content');
            setPageContent(result.error || 'Failed to load page content');
        } catch (error) {
            console.error('Failed to load page:', error);
            setReaderState('error');
            setStatusMessage('Failed to load page content');
            setPageContent('Failed to load page content');
        }
    }

    async function refreshUnlockPreview() {
        if (!userAddress) {
            return;
        }

        try {
            const preview = await apiClient.getUnlockPreview(userAddress, bookId, currentPage);
            setUnlockPreview(preview);
        } catch (error) {
            console.error('Failed to refresh unlock options:', error);
        }
    }

    async function handleUnlock(option: UnlockOption) {
        if (!userAddress) {
            return;
        }

        setReaderState('unlocking');
        setStatusMessage('Unlocking content...');

        try {
            await apiClient.unlockBundle(userAddress, bookId, currentPage, option.bundleType);
            await loadPageContent(currentPage);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unlock failed';
            setReaderState('locked');
            if (message === 'INSUFFICIENT_BALANCE') {
                setStatusMessage('Insufficient prepaid balance. Add funds to continue.');
            } else {
                setStatusMessage(message);
            }
            await refreshUnlockPreview();
        }
    }

    async function handleDeposit() {
        if (!userAddress || !selectedOption) {
            return;
        }

        const minAmount = unlockPreview?.suggestedTopUp && BigInt(unlockPreview.suggestedTopUp) > BigInt(0)
            ? unlockPreview.suggestedTopUp
            : selectedOption.effectiveAmount;

        setReaderState('depositing');
        setStatusMessage('Opening wallet for balance top-up...');

        try {
            const intent = await apiClient.getDepositIntent(userAddress, minAmount);
            const paymentResult = await initiatePayment(
                intent.recipient,
                BigInt(intent.recommendedAmount),
                intent.memo
            );

            if (!paymentResult.success || !paymentResult.txId) {
                setReaderState('locked');
                setStatusMessage(paymentResult.error || 'Deposit cancelled');
                return;
            }

            setStatusMessage('Confirming deposit on Stacks...');
            await apiClient.claimDeposit(userAddress, paymentResult.txId);
            await refreshUnlockPreview();
            setReaderState('locked');
            setStatusMessage('Balance updated. Select an unlock bundle to continue.');
        } catch (error) {
            console.error('Deposit failed:', error);
            setReaderState('locked');
            setStatusMessage(error instanceof Error ? error.message : 'Deposit failed');
        }
    }

    function goToNextPage() {
        if (!book || currentPage >= book.totalPages) {
            return;
        }

        setCurrentPage((prev) => prev + 1);
        setUnlockPreview(null);
        setShowUnlockModal(false);
    }

    function goToPrevPage() {
        if (currentPage <= 1) {
            return;
        }

        setCurrentPage((prev) => prev - 1);
        setUnlockPreview(null);
        setShowUnlockModal(false);
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
                    </div>
                </header>
                <main className="layout-wrap flex min-h-[72vh] items-center justify-center py-16">
                    <div className="surface w-full max-w-xl p-10 text-center md:p-12">
                        <h1 className="font-display text-4xl text-slate-900">Connect to read</h1>
                        <p className="mt-5 text-lg leading-8 text-slate-600">
                            A connected wallet is required for prepaid reading balance and unlock entitlements.
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
                                    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-[rgba(248,246,241,0.78)] px-4 py-6">
                                        <div className="absolute inset-0 rounded-2xl backdrop-blur-[1.4px]" />
                                        <div className="surface relative z-10 w-full max-w-md p-6 text-center md:p-8">
                                            <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Locked page</p>
                                            <h2 className="mt-3 font-display text-3xl text-slate-900">Top up and unlock</h2>

                                            {unlockPreview && (
                                                <p className="mt-4 text-sm leading-7 text-slate-600">
                                                    Balance: {formatStxAmount(unlockPreview.balance.availableBalance)}
                                                    {' · '}
                                                    Lowest unlock: {formatStxAmount(actionableOptions[0]?.effectiveAmount || '0')}
                                                </p>
                                            )}

                                            {statusMessage && (
                                                <p className="mt-3 text-sm leading-6 text-slate-500">{statusMessage}</p>
                                            )}

                                            <div className="mt-6 flex gap-3">
                                                <button
                                                    onClick={() => setShowUnlockModal(true)}
                                                    className="btn-primary flex-1"
                                                    disabled={!unlockPreview}
                                                >
                                                    Unlock options
                                                </button>
                                                <button
                                                    onClick={refreshUnlockPreview}
                                                    className="btn-secondary flex-1"
                                                >
                                                    Refresh
                                                </button>
                                            </div>
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

                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Swipe horizontally</p>

                    <button
                        onClick={goToNextPage}
                        disabled={!book || currentPage >= book.totalPages}
                        className="btn-secondary min-w-[8.5rem] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Next
                    </button>
                </div>
            </main>

            <AnimatePresence>
                {showUnlockModal && unlockPreview && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-40 bg-black/30"
                            onClick={() => setShowUnlockModal(false)}
                        />

                        <div className="fixed inset-x-0 bottom-0 z-50 px-4 pb-6 md:inset-0 md:flex md:items-center md:justify-center md:pb-0">
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 20 }}
                                transition={{ duration: 0.2 }}
                                className="surface mx-auto w-full max-w-xl rounded-3xl p-6 shadow-[0_16px_32px_rgba(15,23,42,0.12)]"
                            >
                                <div className="mb-6 flex items-start justify-between gap-4">
                                    <div>
                                        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Prepaid unlock</p>
                                        <h3 className="mt-2 font-display text-3xl text-slate-900">Choose bundle</h3>
                                        <p className="mt-2 text-sm text-slate-600">
                                            Balance: {formatStxAmount(unlockPreview.balance.availableBalance)}
                                        </p>
                                    </div>
                                    <button className="btn-secondary px-3" onClick={() => setShowUnlockModal(false)}>
                                        Close
                                    </button>
                                </div>

                                <div className="space-y-3">
                                    {actionableOptions.map((option) => {
                                        const active = selectedOption?.bundleType === option.bundleType;
                                        return (
                                            <button
                                                key={`${option.bundleType}-${option.startPage}-${option.endPage}`}
                                                onClick={() => setSelectedBundle(option.bundleType)}
                                                className={[
                                                    'w-full rounded-2xl border px-4 py-4 text-left transition-colors',
                                                    active ? 'border-[hsl(var(--accent))] bg-slate-50' : 'border-slate-200 bg-white hover:bg-slate-50',
                                                ].join(' ')}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <p className="font-medium text-slate-900">{option.label}</p>
                                                    <p className="text-sm font-medium text-[hsl(var(--accent))]">
                                                        {formatStxAmount(option.effectiveAmount)}
                                                    </p>
                                                </div>
                                                <p className="mt-1 text-sm text-slate-600">{option.description}</p>
                                                <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">
                                                    Pages {option.startPage}-{option.endPage} · {option.remainingPages} locked remaining
                                                </p>
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className="mt-6 flex flex-wrap gap-3">
                                    <button
                                        onClick={handleDeposit}
                                        disabled={isPaying || readerState === 'depositing' || !selectedOption}
                                        className="btn-secondary flex-1"
                                    >
                                        {isPaying || readerState === 'depositing' ? 'Opening wallet...' : 'Add balance'}
                                    </button>
                                    <button
                                        onClick={() => selectedOption && void handleUnlock(selectedOption)}
                                        disabled={readerState === 'unlocking' || !selectedOption}
                                        className="btn-primary flex-1"
                                    >
                                        {readerState === 'unlocking' ? 'Unlocking...' : 'Unlock now'}
                                    </button>
                                </div>

                                {unlockPreview.suggestedTopUp !== '0' && (
                                    <p className="mt-3 text-xs text-slate-500">
                                        Suggested top-up: {formatStxAmount(unlockPreview.suggestedTopUp)}
                                    </p>
                                )}
                            </motion.div>
                        </div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
