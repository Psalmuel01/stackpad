'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';

export function WalletConnect() {
    const { isAuthenticated, userAddress, connectWallet, disconnectWallet } = useAuth();
    const [showMenu, setShowMenu] = useState(false);
    const [copied, setCopied] = useState(false);

    if (!isAuthenticated || !userAddress) {
        return (
            <button onClick={connectWallet} className="btn-primary">
                Connect Wallet
            </button>
        );
    }

    const short = `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;

    const copyAddress = async () => {
        await navigator.clipboard.writeText(userAddress);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
    };

    return (
        <div className="relative">
            <button
                onClick={() => setShowMenu(v => !v)}
                className="btn-secondary min-w-[9.5rem] justify-between"
            >
                <span className="font-mono text-xs tracking-wide">{short}</span>
                <span className="text-slate-500">▾</span>
            </button>

            <AnimatePresence>
                {showMenu && (
                    <>
                        <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                        <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 8 }}
                            transition={{ duration: 0.18 }}
                            className="surface absolute right-0 z-20 mt-2 w-52 p-2 shadow-[0_12px_28px_rgba(15,23,42,0.08)]"
                        >
                            <button
                                onClick={copyAddress}
                                className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                            >
                                {copied ? 'Address copied' : 'Copy address'}
                            </button>
                            <button
                                onClick={() => {
                                    disconnectWallet();
                                    setShowMenu(false);
                                }}
                                className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                            >
                                Disconnect
                            </button>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
