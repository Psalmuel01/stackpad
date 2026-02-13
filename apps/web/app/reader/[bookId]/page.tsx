'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import { openSTXTransfer } from '@stacks/connect';
import type { Book, ContentResponse } from '@stackpad/shared';
import { formatStxAmount } from '@stackpad/x402-client';
import { apiClient, type ReaderDepositIntent } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { WalletConnect } from '@/components/WalletConnect';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useToast } from '@/components/ToastProvider';
import { BrandLogo } from '@/components/BrandLogo';

type ReaderState = 'idle' | 'loading' | 'locked' | 'error' | 'ready';

interface InsufficientCreditState {
    requiredAmount: string;
    currentBalance: string;
    shortfall: string;
    topUp: {
        recipient: string;
        network: string;
        suggestedAmount: string;
    };
}

interface PendingDepositState {
    intentId: string;
    txHash: string;
}

export default function ReaderPage() {
    const params = useParams();
    const bookId = parseInt(params.bookId as string, 10);

    const { isAuthenticated, userAddress, connectWallet } = useAuth();
    const { pushToast } = useToast();

    const [book, setBook] = useState<Book | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageContent, setPageContent] = useState('');
    const [pageRenderType, setPageRenderType] = useState<'text' | 'pdf-page'>('text');
    const [pagePdfBase64, setPagePdfBase64] = useState<string | null>(null);
    const [readerState, setReaderState] = useState<ReaderState>('idle');
    const [statusMessage, setStatusMessage] = useState<string | null>(null);

    const [isDimmed, setIsDimmed] = useState(false);
    const [creditBalance, setCreditBalance] = useState<string>('0');
    const [insufficientCredit, setInsufficientCredit] = useState<InsufficientCreditState | null>(null);
    const [showTopUpPanel, setShowTopUpPanel] = useState(false);
    const [topUpAmount, setTopUpAmount] = useState('');
    const [pendingDeposit, setPendingDeposit] = useState<PendingDepositState | null>(null);
    const [isFunding, setIsFunding] = useState(false);

    const [pageTurnCue, setPageTurnCue] = useState<{ key: number; direction: 'next' | 'prev' } | null>(null);
    const requestCounterRef = useRef(0);
    const pageTurnCounterRef = useRef(0);
    const pageTurnTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingButtonTurnRef = useRef<'next' | 'prev' | null>(null);

    useEffect(() => {
        if (!isAuthenticated || !userAddress || Number.isNaN(bookId)) {
            return;
        }

        void loadBook();
        void loadCreditBalance(userAddress);
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
        return () => {
            if (pageTurnTimeoutRef.current) {
                clearTimeout(pageTurnTimeoutRef.current);
            }
        };
    }, []);

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

    async function loadCreditBalance(address: string) {
        try {
            const result = await apiClient.getCreditBalance(address);
            setCreditBalance(result.balance);
        } catch (error) {
            console.error('Failed to load reader balance:', error);
        }
    }

    function applyPagePayload(payload: ContentResponse) {
        setPageContent(payload.content);
        if (payload.renderType === 'pdf-page' && payload.pdfPageBase64) {
            setPageRenderType('pdf-page');
            setPagePdfBase64(payload.pdfPageBase64);
            return;
        }

        setPageRenderType('text');
        setPagePdfBase64(null);
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
                applyPagePayload(result.content);
                if (typeof result.content.creditBalance === 'string') {
                    setCreditBalance(result.content.creditBalance);
                }

                const pendingTurn = pendingButtonTurnRef.current;
                if (pendingTurn) {
                    triggerPageTurn(pendingTurn);
                    pendingButtonTurnRef.current = null;
                }

                setReaderState('ready');
                setIsDimmed(false);
                setShowTopUpPanel(false);
                setStatusMessage(null);
                setPendingDeposit(null);
                setInsufficientCredit(null);
                return;
            }

            if (result.requires402 && result.insufficientCredit) {
                const locked = result.insufficientCredit;
                setReaderState('locked');
                setIsDimmed(true);
                setInsufficientCredit(locked);
                setCreditBalance(locked.currentBalance);
                setTopUpAmount(locked.topUp.suggestedAmount);
                setShowTopUpPanel(true);
                setStatusMessage(result.error || 'Insufficient credit balance for this page.');
                return;
            }

            setReaderState('error');
            setPageRenderType('text');
            setPagePdfBase64(null);
            pendingButtonTurnRef.current = null;
            setPageContent(result.error || 'Failed to load page content');
        } catch (error) {
            console.error('Failed to load page:', error);
            setReaderState('error');
            setPageRenderType('text');
            setPagePdfBase64(null);
            pendingButtonTurnRef.current = null;
            setPageContent('Failed to load page content');
        }
    }

    async function startTopUp() {
        if (!userAddress || !insufficientCredit) {
            return;
        }

        const normalizedAmount = parseMicroStx(topUpAmount);
        if (!normalizedAmount || normalizedAmount <= BigInt(0)) {
            pushToast({
                tone: 'error',
                title: 'Invalid top-up amount',
                message: 'Enter a positive amount in microSTX.',
            });
            return;
        }

        setIsFunding(true);
        setStatusMessage('Preparing top-up request...');
        setShowTopUpPanel(false);

        try {
            const intent = await apiClient.createDepositIntent(userAddress, normalizedAmount.toString());
            setStatusMessage('Confirm top-up in your wallet...');
            const txHash = await requestWalletTopUp(intent);
            setPendingDeposit({
                intentId: intent.intentId,
                txHash,
            });

            pushToast({
                tone: 'info',
                title: 'Deposit submitted',
                message: `Transaction ${txHash.slice(0, 10)}... submitted. Verifying now.`,
                durationMs: 4200,
            });

            await settleDepositAndRetry(intent.intentId, txHash);
        } catch (error) {
            console.error('Top-up failed:', error);
            setReaderState('locked');
            setIsDimmed(true);
            setShowTopUpPanel(true);
            const message = error instanceof Error ? error.message : 'Top-up failed';
            setStatusMessage(message);
            pushToast({
                tone: 'error',
                title: 'Top-up failed',
                message,
            });
        } finally {
            setIsFunding(false);
        }
    }

    async function verifyPendingDeposit() {
        if (!pendingDeposit || !userAddress) {
            return;
        }

        setIsFunding(true);
        setStatusMessage('Verifying pending top-up...');
        setShowTopUpPanel(false);

        try {
            await settleDepositAndRetry(pendingDeposit.intentId, pendingDeposit.txHash);
        } catch (error) {
            console.error('Pending top-up verification failed:', error);
            setReaderState('locked');
            setIsDimmed(true);
            setShowTopUpPanel(true);
            const message = error instanceof Error ? error.message : 'Top-up verification failed';
            setStatusMessage(message);
            pushToast({
                tone: 'error',
                title: 'Verification failed',
                message,
            });
        } finally {
            setIsFunding(false);
        }
    }

    async function settleDepositAndRetry(intentId: string, txHash: string) {
        if (!userAddress) {
            throw new Error('Wallet address not available.');
        }

        const settlement = await apiClient.settleDeposit(userAddress, intentId, txHash);
        if (settlement.status === 'pending') {
            setPendingDeposit({ intentId, txHash });
            setReaderState('locked');
            setIsDimmed(true);
            setShowTopUpPanel(true);
            setStatusMessage('Top-up is still pending on-chain. Tap "Verify top-up" in a moment.');
            return;
        }

        if (settlement.status === 'invalid') {
            setPendingDeposit(null);
            throw new Error(settlement.error || 'Deposit verification failed.');
        }

        if (settlement.status !== 'confirmed') {
            throw new Error(settlement.error || 'Deposit verification failed.');
        }

        if (settlement.balance) {
            setCreditBalance(settlement.balance);
        }
        setPendingDeposit(null);
        setStatusMessage(null);
        pushToast({
            tone: 'success',
            title: 'Credits added',
            message: settlement.amountCredited
                ? `${formatStxAmount(settlement.amountCredited)} credited to your reading balance.`
                : 'Your reading balance was updated.',
        });

        await loadPageContent(currentPage);
    }

    function triggerPageTurn(direction: 'next' | 'prev') {
        const nextKey = ++pageTurnCounterRef.current;
        setPageTurnCue({ key: nextKey, direction });

        if (pageTurnTimeoutRef.current) {
            clearTimeout(pageTurnTimeoutRef.current);
        }

        pageTurnTimeoutRef.current = setTimeout(() => {
            setPageTurnCue((current) => (current?.key === nextKey ? null : current));
        }, 360);
    }

    function goToNextPage(fromButton = false) {
        if (!book || currentPage >= book.totalPages) {
            return;
        }
        pendingButtonTurnRef.current = fromButton ? 'next' : null;
        setCurrentPage((prev) => prev + 1);
    }

    function goToPrevPage(fromButton = false) {
        if (currentPage <= 1) {
            return;
        }
        pendingButtonTurnRef.current = fromButton ? 'prev' : null;
        setCurrentPage((prev) => prev - 1);
    }

    function handleDragEnd(info: PanInfo) {
        const threshold = 50;
        if (info.offset.x < -threshold) {
            goToNextPage(false);
        } else if (info.offset.x > threshold) {
            goToPrevPage(false);
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
                        <h1 className="font-display text-4xl text-slate-900">Connect to read</h1>
                        <p className="mt-5 text-lg leading-8 text-slate-600">
                            A connected wallet is required to unlock reading credits and fetch protected pages.
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
                    <div className="flex items-center gap-3">
                        <BrandLogo className="hidden sm:inline-flex" labelClassName="font-display text-2xl tracking-tight text-slate-900" />
                        <Link href="/library" className="font-medium text-slate-600 transition-colors hover:text-slate-900">Library</Link>
                    </div>
                    <div className="min-w-0 flex-1 px-2 text-center">
                        <p className="truncate font-display text-2xl text-slate-900 md:text-3xl">{book?.title || 'Loading...'}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">
                            Page {currentPage}{book ? ` of ${book.totalPages}` : ''}
                        </p>
                    </div>
                    <div className="hidden rounded-full border border-slate-300 bg-slate-50/70 px-3 py-1 text-xs font-medium text-slate-700 md:block">
                        Credits: {formatStxAmount(creditBalance)}
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
                                    {readerState === 'error'
                                        ? statusMessage || pageContent
                                        : (pageRenderType === 'pdf-page' && pagePdfBase64
                                            ? <PdfPageEmbed pdfPageBase64={pagePdfBase64} fallbackText={pageContent} />
                                            : pageContent)}
                                </article>

                                {isDimmed && (
                                    <div className="absolute inset-0 z-10 rounded-2xl bg-[rgba(248,246,241,0.72)] backdrop-blur-[1.5px]">
                                        <div className="absolute left-4 top-4 rounded-full border border-slate-200 bg-white/85 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-slate-700">
                                            Page locked
                                        </div>
                                    </div>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <AnimatePresence>
                        {pageTurnCue && (
                            <motion.div
                                key={`page-turn-${pageTurnCue.key}`}
                                initial={{ opacity: 0, scale: 0.66 }}
                                animate={{ opacity: 0.88, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.84 }}
                                transition={{ duration: 0.28, ease: 'easeOut' }}
                                className={[
                                    'pointer-events-none absolute bottom-0 z-20 h-24 w-24 border border-[hsl(var(--border))] bg-[hsl(var(--surface-soft)/0.96)] shadow-[0_-8px_22px_rgba(15,23,42,0.12)]',
                                    pageTurnCue.direction === 'next' ? 'right-0' : 'left-0',
                                ].join(' ')}
                                style={{
                                    clipPath: pageTurnCue.direction === 'next'
                                        ? 'polygon(100% 0%, 0% 100%, 100% 100%)'
                                        : 'polygon(0% 0%, 0% 100%, 100% 100%)',
                                }}
                            />
                        )}
                    </AnimatePresence>
                </motion.section>

                <div className="mt-6 flex items-center justify-between gap-3">
                    <button
                        onClick={() => goToPrevPage(true)}
                        disabled={currentPage === 1}
                        className="btn-secondary min-w-[8.5rem] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Previous
                    </button>

                    {readerState === 'locked' ? (
                        <button
                            onClick={() => setShowTopUpPanel(true)}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-xs uppercase tracking-[0.14em] text-slate-700 hover:bg-slate-50"
                        >
                            Add credits
                        </button>
                    ) : (
                        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Swipe horizontally</p>
                    )}

                    <button
                        onClick={() => goToNextPage(true)}
                        disabled={!book || currentPage >= book.totalPages}
                        className="btn-secondary min-w-[8.5rem] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Next
                    </button>
                </div>
            </main>

            <AnimatePresence>
                {showTopUpPanel && insufficientCredit && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setShowTopUpPanel(false)}
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
                                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Reading credits</p>
                                        <h2 className="mt-2 text-2xl font-display text-slate-900">Top up to continue page {currentPage}</h2>
                                    </div>
                                    <button onClick={() => setShowTopUpPanel(false)} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-50">
                                        ×
                                    </button>
                                </div>

                                <div className="surface mb-5 rounded-2xl bg-slate-50/70 p-4">
                                    <div className="grid gap-3 text-sm text-slate-600">
                                        <div className="flex items-center justify-between">
                                            <span>Required for this page</span>
                                            <span className="font-medium text-slate-900">{formatStxAmount(insufficientCredit.requiredAmount)}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span>Current balance</span>
                                            <span className="font-medium text-slate-900">{formatStxAmount(insufficientCredit.currentBalance)}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span>Shortfall</span>
                                            <span className="font-medium text-slate-900">{formatStxAmount(insufficientCredit.shortfall)}</span>
                                        </div>
                                    </div>
                                </div>

                                <label className="mb-2 block text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
                                    Top-up amount (microSTX)
                                </label>
                                <input
                                    type="number"
                                    min={1}
                                    step={100}
                                    value={topUpAmount}
                                    onChange={(event) => setTopUpAmount(event.target.value)}
                                    className="input-base"
                                />
                                <p className="mt-2 text-xs text-slate-500">
                                    {topUpAmount ? `You are adding ${formatStxAmount(topUpAmount)} to your reading balance.` : 'Choose a top-up amount.'}
                                </p>

                                {pendingDeposit?.txHash && (
                                    <p className="mt-4 break-all rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                        Pending top-up transaction: {pendingDeposit.txHash}
                                    </p>
                                )}

                                {statusMessage && (
                                    <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                                        {statusMessage}
                                    </p>
                                )}

                                <div className="mt-5 flex gap-3">
                                    <button onClick={() => setShowTopUpPanel(false)} disabled={isFunding} className="btn-secondary flex-1">
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => void (pendingDeposit ? verifyPendingDeposit() : startTopUp())}
                                        disabled={isFunding}
                                        className="btn-primary flex-1"
                                    >
                                        {isFunding
                                            ? (pendingDeposit ? 'Verifying...' : 'Processing...')
                                            : (pendingDeposit ? 'Verify top-up' : 'Add credits')}
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

function PdfPageEmbed({ pdfPageBase64, fallbackText }: { pdfPageBase64: string; fallbackText: string }) {
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);

    useEffect(() => {
        try {
            setPdfUrl(`data:application/pdf;base64,${pdfPageBase64}`);
        } catch (error) {
            console.error('Failed to render PDF page preview:', error);
            setPdfUrl(null);
        }
    }, [pdfPageBase64]);

    if (!pdfUrl) {
        return <span>{fallbackText}</span>;
    }

    return (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-[hsl(var(--surface-soft)/0.48)]">
            <iframe
                title="PDF page"
                src={`${pdfUrl}#view=FitH&toolbar=0&navpanes=0`}
                className="h-[62vh] w-full"
            />
        </div>
    );
}

async function requestWalletTopUp(intent: ReaderDepositIntent): Promise<string> {
    const network = toWalletNetwork(intent.network);
    const amount = BigInt(intent.amount);

    return await new Promise<string>((resolve, reject) => {
        void openSTXTransfer({
            network,
            recipient: intent.recipient,
            amount,
            memo: intent.memo,
            onFinish: (response: unknown) => {
                const record = response && typeof response === 'object'
                    ? response as Record<string, unknown>
                    : {};
                const txHash = readTxHash(record);

                if (!txHash) {
                    reject(new Error('Wallet did not return a transaction hash.'));
                    return;
                }

                resolve(txHash);
            },
            onCancel: () => reject(new Error('Top-up transaction was cancelled in wallet.')),
        });
    });
}

function parseMicroStx(value: string): bigint | null {
    if (!value.trim()) {
        return null;
    }

    try {
        const parsed = BigInt(value);
        if (parsed <= BigInt(0)) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

function toWalletNetwork(network: string): 'mainnet' | 'testnet' {
    if (network === 'mainnet' || network === 'stacks:1') {
        return 'mainnet';
    }
    return 'testnet';
}

function readTxHash(response: Record<string, unknown>): string | null {
    const txId = response.txId;
    if (typeof txId === 'string' && txId) {
        return txId;
    }

    const txid = response.txid;
    if (typeof txid === 'string' && txid) {
        return txid;
    }

    return null;
}
