'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatStxAmount } from '@stackpad/x402-client';
import { usePayment } from '@/hooks/usePayment';

interface PaymentModalProps {
    isOpen: boolean;
    pageNumber?: number;
    chapterNumber?: number;
    amount: bigint;
    recipient: string;
    memo: string;
    onClose: () => void;
    onPaymentComplete: (payment: { txId: string; txRaw?: string }) => void;
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
            onPaymentComplete({ txId: result.txId, txRaw: result.txRaw });
            return;
        }
        setError(result.error || 'Payment failed');
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
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
                                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Locked content</p>
                                    <h2 className="mt-2 text-2xl font-display text-slate-900">
                                        {pageNumber !== undefined ? `Unlock page ${pageNumber}` : `Unlock chapter ${chapterNumber}`}
                                    </h2>
                                </div>
                                <button onClick={onClose} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-50">
                                    ×
                                </button>
                            </div>

                            <div className="surface mb-5 rounded-2xl bg-slate-50/70 p-4">
                                <p className="text-sm text-slate-500">Price</p>
                                <p className="mt-1 text-3xl font-display text-slate-900">{formatStxAmount(amount)}</p>
                                <p className="mt-3 text-xs text-slate-500 break-all">Paid to: {recipient}</p>
                            </div>

                            {error && (
                                <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                    {error}
                                </p>
                            )}

                            <div className="flex gap-3">
                                <button onClick={onClose} disabled={isPaying} className="btn-secondary flex-1">
                                    Cancel
                                </button>
                                <button onClick={handlePay} disabled={isPaying} className="btn-primary flex-1">
                                    {isPaying ? 'Opening wallet...' : 'Pay with wallet'}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
    );
}
