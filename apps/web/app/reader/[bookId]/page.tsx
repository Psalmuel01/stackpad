'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import type { Book } from '@stackpad/shared';
import {
    encodeBase64,
    formatStxAmount,
    type PaymentProofData,
    type X402V2PaymentRequired,
} from '@stackpad/x402-client';
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

interface PendingPayment extends PaymentProofData {
    attempts: number;
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
    const [paymentRequiredV2, setPaymentRequiredV2] = useState<X402V2PaymentRequired | null>(null);
    const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
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

    async function loadPageContent(pageNum: number, paymentProof?: PaymentProofData, retryAttempt = 0) {
        if (!userAddress) {
            return;
        }

        const requestId = ++requestCounterRef.current;
        const proof = paymentProof || pendingPayment || undefined;

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
                setPendingPayment(null);
                setStatusMessage(null);
                return;
            }

            if (result.requires402) {
                if (result.paymentInstructions) {
                    setPaymentInstructions(result.paymentInstructions);
                }
                if (result.paymentRequiredV2) {
                    setPaymentRequiredV2(result.paymentRequiredV2);
                }

                setIsDimmed(true);

                if (proof) {
                    const details = `${result.error || ''} ${result.details || ''}`.toLowerCase();
                    const isTerminal =
                        details.includes('recipient_mismatch')
                        || details.includes('amount_insufficient')
                        || details.includes('invalid_payment_signature')
                        || details.includes('memo does not match')
                        || details.includes('for different content');

                    if (isTerminal) {
                        setReaderState('locked');
                        setStatusMessage(result.details || result.error || 'Payment was submitted but validation failed.');
                        return;
                    }

                    setShowPaymentModal(false);
                    setPendingPayment(prev => prev ? { ...prev, attempts: retryAttempt + 1 } : prev);

                    if (retryAttempt < MAX_VERIFICATION_RETRIES) {
                        setReaderState('verifying');
                        setStatusMessage('Payment submitted. Waiting for verification...');
                        window.setTimeout(() => {
                            void loadPageContent(pageNum, proof, retryAttempt + 1);
                        }, VERIFY_RETRY_DELAY_MS);
                        return;
                    }

                    setReaderState('locked');
                    setStatusMessage('Still waiting for confirmation. Use Retry Verification or refresh in a minute.');
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

    function handlePaymentComplete(payment: { txId: string; txRaw?: string }) {
        const accepted = paymentRequiredV2?.accepts?.[0];
        const paymentSignature = createPaymentSignature(payment.txRaw, accepted);
        const proof: PendingPayment = {
            txHash: payment.txId,
            txRaw: payment.txRaw,
            paymentSignature,
            attempts: 0,
        };

        setPendingPayment(proof);
        setShowPaymentModal(false);
        setReaderState('verifying');
        setStatusMessage('Payment sent. Verifying transaction...');
        void loadPageContent(currentPage, proof, 0);
    }

    function goToNextPage() {
        if (!book || currentPage >= book.totalPages) {
            return;
        }
        setPendingPayment(null);
        setPaymentInstructions(null);
        setPaymentRequiredV2(null);
        setCurrentPage(prev => prev + 1);
    }

    function goToPrevPage() {
        if (currentPage <= 1) {
            return;
        }
        setPendingPayment(null);
        setPaymentInstructions(null);
        setPaymentRequiredV2(null);
        setCurrentPage(prev => prev - 1);
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
                            A connected wallet is required to request locked pages and submit x402 payment proof.
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
                                    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-[rgba(248,246,241,0.76)] px-4 py-6">
                                        <div className="absolute inset-0 rounded-2xl backdrop-blur-[1.5px]" />
                                        <div className="surface relative z-10 w-full max-w-sm p-6 text-center md:p-8">
                                            <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Locked page</p>
                                            <h2 className="mt-3 font-display text-3xl text-slate-900">
                                                {readerState === 'verifying' ? 'Verifying payment' : `Unlock page ${currentPage}`}
                                            </h2>
                                            <p className="mt-4 text-sm leading-7 text-slate-600">
                                                {paymentInstructions
                                                    ? `Price: ${formatStxAmount(paymentInstructions.amount)} paid to ${paymentInstructions.recipient}.`
                                                    : 'Payment details unavailable. Retry the request.'}
                                            </p>

                                            {statusMessage && (
                                                <p className="mt-3 text-sm leading-6 text-slate-500">{statusMessage}</p>
                                            )}

                                            <div className="mt-6">
                                                {readerState === 'verifying' ? (
                                                    <button
                                                        onClick={() => {
                                                            if (pendingPayment) {
                                                                void loadPageContent(currentPage, pendingPayment, MAX_VERIFICATION_RETRIES);
                                                            }
                                                        }}
                                                        className="btn-secondary w-full"
                                                    >
                                                        Retry verification
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => setShowPaymentModal(true)}
                                                        disabled={!paymentInstructions}
                                                        className="btn-primary w-full"
                                                    >
                                                        Open payment
                                                    </button>
                                                )}
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

function createPaymentSignature(
    txRaw: string | undefined,
    accepted?: X402V2PaymentRequired['accepts'][number]
): string | undefined {
    if (!txRaw || !accepted) {
        return undefined;
    }

    const payload = {
        x402Version: 2,
        accepted,
        payload: {
            transaction: txRaw,
        },
    };

    return encodeBase64(JSON.stringify(payload));
}
