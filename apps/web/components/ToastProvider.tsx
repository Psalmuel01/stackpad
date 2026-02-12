'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

type ToastTone = 'success' | 'error' | 'info';

interface ToastInput {
    title?: string;
    message: string;
    tone?: ToastTone;
    durationMs?: number;
}

interface ToastItem extends ToastInput {
    id: number;
    tone: ToastTone;
}

interface ToastContextValue {
    pushToast: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const idRef = useRef(0);
    const timeoutRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

    const removeToast = useCallback((id: number) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
        const timeout = timeoutRef.current.get(id);
        if (timeout) {
            clearTimeout(timeout);
            timeoutRef.current.delete(id);
        }
    }, []);

    const pushToast = useCallback((input: ToastInput) => {
        const id = ++idRef.current;
        const tone = input.tone || 'info';
        const toast: ToastItem = {
            id,
            tone,
            title: input.title,
            message: input.message,
            durationMs: input.durationMs,
        };

        setToasts((prev) => [...prev, toast].slice(-4));

        const timeout = setTimeout(() => {
            removeToast(id);
        }, input.durationMs ?? 3600);

        timeoutRef.current.set(id, timeout);
    }, [removeToast]);

    useEffect(() => {
        const timeouts = timeoutRef.current;
        return () => {
            for (const timeout of timeouts.values()) {
                clearTimeout(timeout);
            }
            timeouts.clear();
        };
    }, []);

    return (
        <ToastContext.Provider value={{ pushToast }}>
            {children}
            <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[120] flex justify-center px-4 sm:justify-end sm:pr-5">
                <div className="flex w-full max-w-sm flex-col gap-3">
                    <AnimatePresence initial={false}>
                        {toasts.map((toast) => (
                            <motion.div
                                key={toast.id}
                                initial={{ opacity: 0, y: 14, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                                transition={{ duration: 0.2, ease: 'easeOut' }}
                                className="pointer-events-auto overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))/0.97] shadow-[0_14px_30px_rgba(15,23,42,0.16)] backdrop-blur"
                            >
                                <div className="flex items-start gap-3 px-4 py-3">
                                    <span className={toneDotClassName(toast.tone)} />
                                    <div className="min-w-0 flex-1">
                                        {toast.title && (
                                            <p className="truncate text-sm font-medium text-[hsl(var(--foreground))]">
                                                {toast.title}
                                            </p>
                                        )}
                                        <p className="text-sm text-[hsl(var(--muted-strong))]">
                                            {toast.message}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => removeToast(toast.id)}
                                        className="rounded-md px-2 py-1 text-sm text-[hsl(var(--muted))] transition-colors hover:bg-[hsl(var(--surface-soft))] hover:text-[hsl(var(--foreground))]"
                                        aria-label="Dismiss toast"
                                    >
                                        ×
                                    </button>
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
            </div>
        </ToastContext.Provider>
    );
}

export function useToast(): ToastContextValue {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within ToastProvider');
    }
    return context;
}

function toneDotClassName(tone: ToastTone): string {
    if (tone === 'success') {
        return 'mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-emerald-500';
    }

    if (tone === 'error') {
        return 'mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-rose-500';
    }

    return 'mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-[hsl(var(--accent))]';
}
