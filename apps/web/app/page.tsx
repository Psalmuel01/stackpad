'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
import { WalletConnect } from '@/components/WalletConnect';
import { ThemeToggle } from '@/components/ThemeToggle';

const fadeUp = {
    initial: { opacity: 0, y: 16 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0.25 },
    transition: { duration: 0.42, ease: 'easeOut' as const },
};

export default function Home() {
    const { isAuthenticated, connectWallet } = useAuth();

    return (
        <div className="app-shell">
            <header className="topbar">
                <div className="layout-wrap flex h-20 items-center justify-between">
                    <Link href="/" className="font-display text-3xl tracking-tight text-slate-900">
                        Stackpad
                    </Link>
                    <div className="flex items-center gap-3">
                        <Link href="/library" className="btn-secondary">Library</Link>
                        <Link href="/author" className="btn-secondary">Author</Link>
                        <ThemeToggle />
                        <WalletConnect />
                    </div>
                </div>
            </header>

            <main className="relative overflow-hidden">
                <div className="landing-stars pointer-events-none absolute inset-0" />
                <div className="pointer-events-none absolute left-[6%] top-28 hidden md:block text-slate-400/70">
                    <SparkleIcon />
                </div>
                <div className="pointer-events-none absolute right-[8%] top-44 hidden lg:block text-slate-400/70">
                    <SparkleIcon />
                </div>
                <div className="pointer-events-none absolute left-[10%] top-[32rem] hidden lg:block text-slate-400/60">
                    <TinyStarIcon />
                </div>
                <div className="landing-ornament pointer-events-none absolute right-[5%] top-24 hidden rounded-2xl p-3 lg:block">
                    <BookArtIcon />
                </div>
                <div className="landing-ornament pointer-events-none absolute bottom-24 left-[7%] hidden rounded-2xl p-2.5 lg:block">
                    <BookArtIcon compact />
                </div>

                <section className="layout-wrap pb-20 pt-22 md:pb-28 md:pt-28">
                    <motion.div
                        initial={{ opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.45 }}
                        className="relative z-10 max-w-5xl"
                    >
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Pay-As-You-Read</p>
                        <h1 className="mt-7 max-w-4xl font-display text-5xl leading-tight text-slate-900 md:text-7xl md:leading-tight">
                            The reading platform where each page unlocks with proof, not friction.
                        </h1>
                        <p className="mt-10 max-w-2xl text-lg leading-8 text-slate-600">
                            Stackpad combines immersive reading UI with x402 payment gating on Stacks. Readers unlock only what
                            they open. Authors receive transparent payout routing on every paid access event.
                        </p>
                        <div className="mt-12 flex flex-wrap gap-4">
                            {isAuthenticated ? (
                                <>
                                    <Link href="/library" className="btn-primary">Open library</Link>
                                    <Link href="/author" className="btn-secondary">Publish a book</Link>
                                </>
                            ) : (
                                <>
                                    <button onClick={connectWallet} className="btn-primary">Connect wallet</button>
                                    <Link href="/library" className="btn-secondary">Preview library</Link>
                                </>
                            )}
                        </div>
                    </motion.div>
                </section>

                <section className="layout-wrap pb-16 md:pb-20">
                    <div className="grid gap-5 md:grid-cols-3">
                        {[
                            {
                                title: 'Wallet-native',
                                detail: 'Reader identity comes directly from Stacks wallet addresses. No account silo.',
                                icon: <WalletIcon />,
                            },
                            {
                                title: 'HTTP 402 Flow',
                                detail: 'Locked resources return standards-based payment requirements and settle with facilitator verification.',
                                icon: <LockIcon />,
                            },
                            {
                                title: 'Reader-first UX',
                                detail: 'Immersive typography, swipe navigation, and compact unlock actions keep attention on content.',
                                icon: <BookIcon />,
                            },
                        ].map((item) => (
                            <motion.article key={item.title} {...fadeUp} className="card">
                                <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700">
                                    {item.icon}
                                </div>
                                <h2 className="font-display text-2xl text-slate-900">{item.title}</h2>
                                <p className="mt-4 text-sm leading-7 text-slate-600">{item.detail}</p>
                            </motion.article>
                        ))}
                    </div>
                </section>

                <section className="layout-wrap pb-18 md:pb-24">
                    <motion.div {...fadeUp} className="surface p-8 md:p-12">
                        <div className="mb-8">
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Flow detail</p>
                            <h2 className="mt-4 font-display text-4xl leading-tight text-slate-900 md:text-5xl">
                                From page swipe to verified unlock in a clear sequence.
                            </h2>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {[
                                ['1', 'Reader requests page', 'The app asks backend for the selected page endpoint.'],
                                ['2', 'Backend returns 402', 'If locked, response includes payment-required terms (amount, asset, payTo, network).'],
                                ['3', 'Buyer signs payload', 'Strict x402 buyer adapter creates payment-signature from configured signer key.'],
                                ['4', 'Server settles', 'Backend verifies and settles through facilitator with declared requirements.'],
                                ['5', 'Resource returned', 'On success, content response includes payment-response settlement metadata.'],
                                ['6', 'Entitlement recorded', 'Reader entitlement is logged for future access checks and chapter coverage.'],
                            ].map(([step, title, detail]) => (
                                <article key={step} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                                    <p className="text-xs font-semibold tracking-[0.16em] text-[hsl(var(--accent))]">STEP {step}</p>
                                    <h3 className="mt-2 text-lg font-medium text-slate-900">{title}</h3>
                                    <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p>
                                </article>
                            ))}
                        </div>
                    </motion.div>
                </section>

                <section className="layout-wrap pb-20 md:pb-28">
                    <div className="grid gap-6 md:grid-cols-2">
                        <motion.article {...fadeUp} className="surface p-8 md:p-10">
                            <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700">
                                <ReaderIcon />
                            </div>
                            <h3 className="font-display text-3xl text-slate-900">Reader experience</h3>
                            <p className="mt-4 text-base leading-8 text-slate-600">
                                The interface stays minimal at every stage: focused reading typography, subtle dimming on locked
                                pages, and one clear payment action. Diagnostics stay visible without crowding the flow.
                            </p>
                        </motion.article>

                        <motion.article {...fadeUp} className="surface p-8 md:p-10">
                            <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700">
                                <AuthorIcon />
                            </div>
                            <h3 className="font-display text-3xl text-slate-900">Author controls</h3>
                            <p className="mt-4 text-base leading-8 text-slate-600">
                                Upload text or PDF with page detection, set microSTX pricing, and publish instantly. The backend
                                validates page structure and payout metadata before committing records to storage.
                            </p>
                        </motion.article>
                    </div>
                </section>

                <section className="layout-wrap pb-26 md:pb-36">
                    <motion.div {...fadeUp} className="surface p-10 md:p-14">
                        <h4 className="max-w-2xl font-display text-4xl leading-tight text-slate-900 md:text-5xl">
                            Start reading and verify every unlock path end-to-end.
                        </h4>
                        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
                            Explore the library for live page gating or open author mode to publish test content with file-based
                            page detection and pricing controls.
                        </p>
                        <div className="mt-10 flex flex-wrap gap-4">
                            <Link href="/library" className="btn-primary">Enter library</Link>
                            <Link href="/author" className="btn-secondary">Open author console</Link>
                        </div>
                    </motion.div>
                </section>
            </main>
        </div>
    );
}

function SparkleIcon() {
    return (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m12 2 1.7 4.3L18 8l-4.3 1.7L12 14l-1.7-4.3L6 8l4.3-1.7L12 2Z" />
            <path d="m18.5 14.5.9 2.2 2.1.8-2.1.9-.9 2.1-.8-2.1-2.2-.9 2.2-.8.8-2.2Z" />
        </svg>
    );
}

function TinyStarIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="m12 4 1.8 4.2L18 10l-4.2 1.8L12 16l-1.8-4.2L6 10l4.2-1.8L12 4Z" />
        </svg>
    );
}

function BookArtIcon({ compact = false }: { compact?: boolean }) {
    return (
        <svg width={compact ? '42' : '56'} height={compact ? '42' : '56'} viewBox="0 0 56 56" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <rect x="6" y="6" width="44" height="44" rx="12" />
            <path d="M28 16v24" />
            <path d="M16 19.5a3.5 3.5 0 0 1 3.5-3.5H28v24h-8.5a3.5 3.5 0 0 0-3.5 3.5V19.5Z" />
            <path d="M40 19.5a3.5 3.5 0 0 0-3.5-3.5H28v24h8.5a3.5 3.5 0 0 1 3.5 3.5V19.5Z" />
            <path d="m36.5 12.5.9 2.1 2.1.8-2.1.9-.9 2-.8-2-2.1-.9 2.1-.8.8-2.1Z" />
        </svg>
    );
}

function WalletIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a3 3 0 0 1 3-3h10a2 2 0 0 1 2 2v0" />
            <path d="M3 7h16a2 2 0 0 1 2 2v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7Z" />
            <path d="M17 12h4" />
            <circle cx="17" cy="12" r="1" />
        </svg>
    );
}

function LockIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="10" width="16" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            <circle cx="12" cy="15" r="1.2" />
        </svg>
    );
}

function BookIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2V5Z" />
            <path d="M8 7h8" />
            <path d="M8 11h7" />
            <path d="M8 15h6" />
        </svg>
    );
}

function ReaderIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v18" />
            <path d="M5 5.5A3.5 3.5 0 0 1 8.5 2H12v20H8.5A3.5 3.5 0 0 1 5 18.5V5.5Z" />
            <path d="M19 5.5A3.5 3.5 0 0 0 15.5 2H12v20h3.5a3.5 3.5 0 0 0 3.5-3.5V5.5Z" />
        </svg>
    );
}

function AuthorIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 20h4l10-10-4-4L4 16v4Z" />
            <path d="m12 6 4 4" />
            <path d="M20 20H10" />
        </svg>
    );
}
