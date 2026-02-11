'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api';
import { PaymentModal } from '@/components/PaymentModal';
import type { Book } from '@stackpad/shared';
import { motion, AnimatePresence, useMotionValue, useTransform, PanInfo } from 'framer-motion';
import { formatStxAmount } from '@stackpad/x402-client';
import Link from 'next/link';
import { WalletConnect } from '@/components/WalletConnect';

export default function ReaderPage() {
    const params = useParams();
    const router = useRouter();
    const bookId = parseInt(params.bookId as string, 10);
    const { isAuthenticated, userAddress } = useAuth();

    const [book, setBook] = useState<Book | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageContent, setPageContent] = useState<string>('');
    const [loading, setLoading] = useState(true);

    // Payment modal state
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [paymentInstructions, setPaymentInstructions] = useState<any>(null);
    const [pendingTxId, setPendingTxId] = useState<string | null>(null);

    // Dimming state for locked pages
    const [isDimmed, setIsDimmed] = useState(false);

    useEffect(() => {
        if (isAuthenticated && userAddress) {
            loadBook();
        }
    }, [bookId, isAuthenticated, userAddress]);

    useEffect(() => {
        if (book && userAddress) {
            loadPageContent(currentPage);
        }
    }, [currentPage, book, userAddress, pendingTxId]);

    const loadBook = async () => {
        try {
            const bookData = await apiClient.getBook(bookId);
            setBook(bookData);
        } catch (error) {
            console.error('Failed to load book:', error);
        }
    };

    const loadPageContent = async (pageNum: number) => {
        if (!userAddress) return;

        setLoading(true);
        setIsDimmed(false);

        try {
            const result = await apiClient.getPage(bookId, pageNum, userAddress, pendingTxId || undefined);

            if (result.requires402 && result.paymentInstructions) {
                // Page requires payment
                setPaymentInstructions(result.paymentInstructions);
                setIsDimmed(true);
                setShowPaymentModal(true);
                setPageContent('');
            } else if (result.content) {
                // Page unlocked
                setPageContent(result.content.content);
                setIsDimmed(false);
                setShowPaymentModal(false);
                setPendingTxId(null);
            } else if (result.error) {
                console.error('Error loading page:', result.error);
                setPageContent('Error loading page content: ' + result.error);
            } else if (result.requires402 && result.error) {
                // Payment required but verification failed
                if (result.error === 'Payment verification failed') {
                    // This is likely due to mempool delay
                    setPageContent('Payment sent! Verifying transaction on blockchain... (This may take a few seconds)');

                    // Auto-retry after 3 seconds if we have a pending Tx
                    if (pendingTxId) {
                        setTimeout(() => loadPageContent(pageNum), 3000);
                    }
                } else {
                    setPageContent(`Payment Error: ${result.error} ${result.details ? `(${result.details})` : ''}`);
                }
                // Keep modal closed if verifying, or maybe show a status?
                setShowPaymentModal(false);
            } else if (result.error) {
                console.error('Error loading page:', result.error);
                setPageContent('Error loading page content: ' + result.error);
            } else {
                // Fallback for when requires402 is true but paymentInstructions is missing (e.g. CORS issue)
                if (result.requires402 && !result.paymentInstructions) {
                    setPageContent('Error: Payment required but payment instructions missing. Check CORS configuration.');
                }
            }
        } catch (error) {
            console.error('Failed to load page:', error);
            setPageContent('Failed to load page');
        } finally {
            setLoading(false);
        }
    };

    const handlePaymentComplete = (txId: string) => {
        setPendingTxId(txId);
        setShowPaymentModal(false);
        // Retry loading the page with the payment proof
        loadPageContent(currentPage);
    };

    const goToNextPage = () => {
        if (book && currentPage < book.totalPages) {
            setCurrentPage(currentPage + 1);
        }
    };

    const goToPrevPage = () => {
        if (currentPage > 1) {
            setCurrentPage(currentPage - 1);
        }
    };

    // Swipe handling
    const handleDragEnd = (info: PanInfo) => {
        const threshold = 50;
        if (info.offset.x < -threshold) {
            goToNextPage();
        } else if (info.offset.x > threshold) {
            goToPrevPage();
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

    if (!book && !loading) {
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
            {/* Header */}
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

            {/* Reader */}
            <main className="container mx-auto px-4 py-8">
                <div className="max-w-4xl mx-auto">
                    {/* Book Title */}
                    {book && (
                        <div className="text-center mb-8">
                            <h1 className="text-3xl font-display font-bold text-slate-900 dark:text-white mb-2">
                                {book.title}
                            </h1>
                            <div className="w-32 h-1 bg-gradient-to-r from-primary-500 to-accent-500 mx-auto rounded-full"></div>
                        </div>
                    )}

                    {/* Progress Bar */}
                    {book && (
                        <div className="mb-6">
                            <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-primary-500 to-accent-500 transition-all duration-300"
                                    style={{ width: `${(currentPage / book.totalPages) * 100}%` }}
                                ></div>
                            </div>
                        </div>
                    )}

                    {/* Page Content with Swipe */}
                    <motion.div
                        drag="x"
                        dragConstraints={{ left: 0, right: 0 }}
                        dragElastic={0.2}
                        onDragEnd={(_, info) => handleDragEnd(info)}
                        className="card min-h-[600px] relative overflow-hidden"
                    >
                        <AnimatePresence mode="wait">
                            {loading ? (
                                <motion.div
                                    key="loading"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="flex items-center justify-center h-full min-h-[400px]"
                                >
                                    <div className="text-center">
                                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
                                        <p className="text-slate-600 dark:text-slate-300">Loading page...</p>
                                    </div>
                                </motion.div>
                            ) : (
                                <motion.div
                                    key={`page-${currentPage}`}
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    transition={{ duration: 0.3 }}
                                    className="prose dark:prose-invert max-w-none relative"
                                >
                                    {isDimmed ? (
                                        <div className="relative">
                                            {/* Blurred Preview Content */}
                                            <div className="filter blur-sm select-none opacity-50 pointer-events-none" aria-hidden="true">
                                                <h3>Chapter {book?.totalChapters ? Math.ceil(currentPage / (book.totalPages / book.totalChapters)) : 1}</h3>
                                                <p>
                                                    The content of this page is locked. To continue reading, please unlock this page using your Stacks wallet.
                                                    Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
                                                    Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
                                                </p>
                                                <p>
                                                    Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.
                                                    Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
                                                </p>
                                                <p>
                                                    Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium,
                                                    totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.
                                                </p>
                                            </div>

                                            {/* Lock Overlay */}
                                            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center">
                                                <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl p-8 rounded-3xl shadow-2xl border border-white/20 dark:border-slate-700/50 max-w-sm mx-auto transform hover:scale-105 transition-transform duration-300">
                                                    <div className="w-16 h-16 bg-gradient-to-br from-primary-100 to-accent-100 dark:from-primary-900/50 dark:to-accent-900/50 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-highlight">
                                                        <span className="text-3xl">🔒</span>
                                                    </div>
                                                    <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                                                        Premium Content
                                                    </h3>
                                                    <p className="text-slate-600 dark:text-slate-300 mb-6 leading-relaxed">
                                                        Unlock this page for <span className="font-semibold text-primary-600 dark:text-primary-400">{paymentInstructions ? formatStxAmount(paymentInstructions.amount) : '...'} STX</span> to continue reading.
                                                    </p>
                                                    <button
                                                        onClick={() => setShowPaymentModal(true)}
                                                        className="btn-primary w-full shadow-lg shadow-primary-500/20"
                                                    >
                                                        Unlock Page
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="min-h-[60vh] text-lg leading-relaxed text-slate-800 dark:text-slate-200">
                                            {pageContent}
                                        </div>
                                    )}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </motion.div>

                    {/* Navigation Buttons */}
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

            {/* Payment Modal */}
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
