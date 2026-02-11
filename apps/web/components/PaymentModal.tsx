'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { formatStxAmount } from '@stackpad/x402-client';
import { usePayment } from '@/hooks/usePayment';
import { useState } from 'react';

interface PaymentModalProps {
    isOpen: boolean;
    pageNumber?: number;
    chapterNumber?: number;
    amount: bigint;
    recipient: string;
    memo: string;
    onClose: () => void;
    onPaymentComplete: (txId: string) => void;
}

export function PaymentModal({
    isOpen,
    pageNumber,
    chapterNumber,
    amount,
    recipient,
    memo,
    onClose,
    onPaymentComplete,
}: PaymentModalProps) {
    const { initiatePayment, isPaying } = usePayment();
    const [error, setError] = useState<string | null>(null);

    const handlePay = async () => {
        setError(null);
        const result = await initiatePayment(recipient, amount, memo);

        if (result.success && result.txId) {
            onPaymentComplete(result.txId);
        } else {
            setError(result.error || 'Payment failed');
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
                    />

                    {/* Modal */}
                    <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            transition={{ type: 'spring', duration: 0.4 }}
                            className="glass rounded-3xl shadow-2xl max-w-md w-full p-8 relative"
                        >
                            {/* Close Button */}
                            <button
                                onClick={onClose}
                                className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>

                            {/* Icon */}
                            <div className="flex justify-center mb-6">
                                <div className="w-16 h-16 rounded-full bg-gradient-to-r from-primary-500 to-accent-500 flex items-center justify-center text-3xl">
                                    🔒
                                </div>
                            </div>

                            {/* Title */}
                            <h2 className="text-2xl font-display font-bold text-center mb-2 text-slate-900 dark:text-white">
                                Unlock Content
                            </h2>
                            <p className="text-center text-slate-600 dark:text-slate-300 mb-6">
                                {pageNumber !== undefined
                                    ? `Pay to unlock page ${pageNumber}`
                                    : `Pay to unlock chapter ${chapterNumber}`}
                            </p>

                            {/* Price Display */}
                            <div className="card bg-gradient-to-r from-primary-50 to-accent-50 dark:from-primary-900/20 dark:to-accent-900/20 mb-6">
                                <div className="text-center">
                                    <div className="text-sm text-slate-600 dark:text-slate-400 mb-1">Payment Amount</div>
                                    <div className="text-3xl font-bold bg-gradient-to-r from-primary-600 to-accent-600 bg-clip-text text-transparent">
                                        {formatStxAmount(amount)}
                                    </div>
                                </div>
                            </div>

                            {/* Error Message */}
                            {error && (
                                <div className="mb-4 p-4 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg text-red-700 dark:text-red-300 text-sm">
                                    {error}
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex gap-3">
                                <button
                                    onClick={onClose}
                                    disabled={isPaying}
                                    className="btn-secondary flex-1"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handlePay}
                                    disabled={isPaying}
                                    className="btn-primary flex-1 relative"
                                >
                                    {isPaying ? (
                                        <span className="flex items-center justify-center gap-2">
                                            <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                            Processing...
                                        </span>
                                    ) : (
                                        'Pay with Wallet'
                                    )}
                                </button>
                            </div>

                            <p className="text-xs text-center text-slate-500 dark:text-slate-400 mt-4">
                                Your wallet will open to confirm the transaction
                            </p>
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
    );
}
