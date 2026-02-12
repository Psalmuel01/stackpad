'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import type { Book } from '@stackpad/shared';
import { formatStxAmount } from '@stackpad/x402-client';
import { apiClient } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { WalletConnect } from '@/components/WalletConnect';
import { PaymentModal } from '@/components/PaymentModal';

const VERIFY_RETRY_DELAY_MS = 3000;
const MAX_VERIFICATION_RETRIES = 80;

type ReaderState = 'idle' | 'loading' | 'locked' | 'verifying' | 'error' | 'ready';

interface PaymentInstructions {
    amount: string;
    recipient: string;
    memo: string;
    network: string;
}

export default function ReaderPage() {
    const params = useParams();
    const bookId = parseInt(params.bookId as string, 10);
    const { isAuthenticated, userAddress } = useAuth();

    const [book, setBook] = useState<Book | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageContent, setPageContent] = useState('');
    const [readerState, setReaderState] = useState<ReaderState>('idle');
    const [statusMessage, setStatusMessage] = useState<string | null>(null);

    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [paymentInstructions, setPaymentInstructions] = useState<PaymentInstructions | null>(null);
    const [pendingTxId, setPendingTxId] = useState<string | null>(null);
    const [isDimmed, setIsDimmed] = useState(false);

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

    async function loadPageContent(pageNum: number, paymentProof?: string, retryAttempt = 0) {
        if (!userAddress) {
            return;
        }

        const requestId = ++requestCounterRef.current;
        const proof = paymentProof || pendingTxId || undefined;

        setReaderState('loading');
        setStatusMessage(null);
        setIsDimmed(false);

        try {
            const result = await apiClient.getPage(bookId, pageNum, userAddress, proof);
            if (requestId !== requestCounterRef.current) {
                return;
            }

            if (result.content) {
                setPageContent(result.content.content);
                setReaderState('ready');
                setIsDimmed(false);
                setShowPaymentModal(false);
                setPendingTxId(null);
                setStatusMessage(null);
                return;
            }

            if (result.requires402) {
                if (result.paymentInstructions) {
                    setPaymentInstructions(result.paymentInstructions);
                }

                setIsDimmed(true);

                if (proof) {
                    setShowPaymentModal(false);
                    if (retryAttempt < MAX_VERIFICATION_RETRIES) {
                        setReaderState('verifying');
                        setStatusMessage('Payment submitted. Waiting for blockchain confirmation...');
                        window.setTimeout(() => {
                            void loadPageContent(pageNum, proof, retryAttempt + 1);
                        }, VERIFY_RETRY_DELAY_MS);
                        return;
                    }

                    setReaderState('locked');
                    setStatusMessage('Transaction is still pending. Retry verification, or wait for confirmation and try again.');
                    return;
                }

                setReaderState('locked');
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

    function handlePaymentComplete(txId: string) {
        setPendingTxId(txId);
        setShowPaymentModal(false);
        setReaderState('verifying');
        setStatusMessage('Payment sent. Verifying transaction...');
        void loadPageContent(currentPage, txId, 0);
    }

    function goToNextPage() {
        if (!book || currentPage >= book.totalPages) {
            return;
        }
        setPendingTxId(null);
        setPaymentInstructions(null);
        setCurrentPage((prev) => prev + 1);
    }

    function goToPrevPage() {
        if (currentPage <= 1) {
            return;
        }
        setPendingTxId(null);
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

    if (!book && readerState === 'error') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-indigo-950">
                <div className="text-center">
                    <h1 className="text-3xl font-bold mb-4">Book not found</h1>
                    <Link href="/library" className="btn-primary">
                        Back to Library
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-indigo-950">
            <header className="glass sticky top-0 z-10 border-b border-white/20">
                <div className="container mx-auto px-4 py-3">
                    <div className="flex justify-between items-center">
                        <Link href="/library" className="text-slate-600 dark:text-slate-300 hover:text-primary-600 dark:hover:text-primary-400 flex items-center gap-2">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                            Back to Library
                        </Link>
                        <div className="flex items-center gap-4">
                            <div className="text-sm text-slate-600 dark:text-slate-300">
                                Page {currentPage} / {book?.totalPages || '...'}
                            </div>
                            <WalletConnect />
                        </div>
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-4 py-8">
                <div className="max-w-4xl mx-auto">
                    {book && (
                        <div className="text-center mb-8">
                            <h1 className="text-3xl font-display font-bold text-slate-900 dark:text-white mb-2">
                                {book.title}
                            </h1>
                            <div className="w-32 h-1 bg-gradient-to-r from-primary-500 to-accent-500 mx-auto rounded-full" />
                        </div>
                    )}

                    {book && (
                        <div className="mb-6">
                            <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-primary-500 to-accent-500 transition-all duration-300"
                                    style={{ width: `${(currentPage / book.totalPages) * 100}%` }}
                                />
                            </div>
                        </div>
                    )}

                    <motion.div
                        drag="x"
                        dragConstraints={{ left: 0, right: 0 }}
                        dragElastic={0.2}
                        onDragEnd={(_, info) => handleDragEnd(info)}
                        className="card min-h-[600px] relative overflow-hidden"
                    >
                        <AnimatePresence mode="wait">
                            {readerState === 'loading' || readerState === 'idle' ? (
                                <motion.div
                                    key="loading"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="flex items-center justify-center h-full min-h-[400px]"
                                >
                                    <div className="text-center">
                                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4" />
                                        <p className="text-slate-600 dark:text-slate-300">Loading page...</p>
                                    </div>
                                </motion.div>
                            ) : (
                                <motion.div
                                    key={`page-${currentPage}-${readerState}`}
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    transition={{ duration: 0.3 }}
                                    className="prose dark:prose-invert max-w-none relative"
                                >
                                    {isDimmed ? (
                                        <div className="relative">
                                            <div className="filter blur-sm select-none opacity-50 pointer-events-none" aria-hidden="true">
                                                <h3>Locked Preview</h3>
                                                <p>
                                                    This page is protected by x402 payment gating. Unlock access to continue reading the full text.
                                                </p>
                                                <p>
                                                    Payment is processed in your Stacks wallet and verified by transaction proof before content is delivered.
                                                </p>
                                                <p>
                                                    If you already paid, verification may need a short delay while your transfer confirms on-chain.
                                                </p>
                                            </div>

                                            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center">
                                                <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl p-8 rounded-3xl shadow-2xl border border-white/20 dark:border-slate-700/50 max-w-sm mx-auto">
                                                    <div className="w-16 h-16 bg-gradient-to-br from-primary-100 to-accent-100 dark:from-primary-900/50 dark:to-accent-900/50 rounded-2xl flex items-center justify-center mx-auto mb-6">
                                                        <span className="text-3xl">🔒</span>
                                                    </div>

                                                    <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                                                        {readerState === 'verifying' ? 'Verifying Payment' : 'Premium Content'}
                                                    </h3>

                                                    <p className="text-slate-600 dark:text-slate-300 mb-4 leading-relaxed">
                                                        {paymentInstructions
                                                            ? `Unlock this page for ${formatStxAmount(paymentInstructions.amount)}`
                                                            : 'Payment details unavailable. Retry the request.'}
                                                    </p>

                                                    {statusMessage && (
                                                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
                                                            {statusMessage}
                                                        </p>
                                                    )}

                                                    {readerState === 'verifying' ? (
                                                        <button
                                                            onClick={() => {
                                                                if (pendingTxId) {
                                                                    void loadPageContent(currentPage, pendingTxId, MAX_VERIFICATION_RETRIES);
                                                                }
                                                            }}
                                                            className="btn-secondary w-full"
                                                        >
                                                            Retry Verification
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={() => setShowPaymentModal(true)}
                                                            className="btn-primary w-full"
                                                            disabled={!paymentInstructions}
                                                        >
                                                            Unlock Page
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="min-h-[60vh] text-lg leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                                            {readerState === 'error' ? statusMessage || pageContent : pageContent}
                                        </div>
                                    )}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </motion.div>

                    <div className="flex justify-between items-center mt-6">
                        <button
                            onClick={goToPrevPage}
                            disabled={currentPage === 1}
                            className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                            Previous
                        </button>

                        <div className="text-sm text-slate-600 dark:text-slate-400">
                            Swipe to navigate
                        </div>

                        <button
                            onClick={goToNextPage}
                            disabled={!book || currentPage >= book.totalPages}
                            className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            Next
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        </button>
                    </div>
                </div>
            </main>

            {paymentInstructions && (
                <PaymentModal
                    isOpen={showPaymentModal}
                    pageNumber={currentPage}
                    amount={BigInt(paymentInstructions.amount)}
                    recipient={paymentInstructions.recipient}
                    memo={paymentInstructions.memo}
                    onClose={() => setShowPaymentModal(false)}
                    onPaymentComplete={handlePaymentComplete}
                />
            )}
        </div>
    );
}
