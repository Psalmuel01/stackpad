'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
import { WalletConnect } from '@/components/WalletConnect';

const fadeUp = {
    initial: { opacity: 0, y: 14 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0.25 },
    transition: { duration: 0.4, ease: 'easeOut' as const },
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
                        <Link href="/library" className="btn-secondary">
                            Library
                        </Link>
                        <Link href="/author" className="btn-secondary">
                            Author
                        </Link>
                        <WalletConnect />
                    </div>
                </div>
            </header>

            <main>
                <section className="layout-wrap pb-24 pt-24 md:pb-32 md:pt-32">
                    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="max-w-5xl">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Readable by default</p>
                        <h1 className="mt-7 max-w-4xl font-display text-5xl leading-tight text-slate-900 md:text-7xl md:leading-tight">
                            Long-form reading with prepaid, progressive unlock access.
                        </h1>
                        <p className="mt-10 max-w-2xl text-lg leading-8 text-slate-600">
                            Stackpad keeps interface noise low and content clarity high. Pages unlock through x402 payment
                            gating on Stacks with a prepaid reading balance, so readers avoid constant wallet prompts.
                        </p>
                        <div className="mt-12 flex flex-wrap gap-4">
                            {isAuthenticated ? (
                                <>
                                    <Link href="/library" className="btn-primary">Start reading</Link>
                                    <Link href="/author" className="btn-secondary">Publish content</Link>
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

                <section className="layout-wrap pb-20 md:pb-28">
                    <div className="grid gap-5 md:grid-cols-3">
                        {[
                            ['Immersive reader', 'Minimal top bar, swipe navigation, and generous serif typography for steady focus.'],
                            ['x402 compliant', 'Locked content returns 402 with bundle unlock options and top-up requirements.'],
                            ['Author-owned payouts', 'Author revenue is derived from actual page consumption and unlock events.'],
                        ].map(([title, detail]) => (
                            <motion.article key={title} {...fadeUp} className="card">
                                <h2 className="font-display text-2xl text-slate-900">{title}</h2>
                                <p className="mt-4 text-sm leading-7 text-slate-600">{detail}</p>
                            </motion.article>
                        ))}
                    </div>
                </section>

                <section className="layout-wrap pb-24 md:pb-36">
                    <motion.div {...fadeUp} className="surface grid gap-10 p-8 md:grid-cols-[1.05fr_1fr] md:p-12">
                        <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Reading flow</p>
                            <h2 className="mt-5 max-w-md font-display text-4xl leading-tight text-slate-900 md:text-5xl">
                                Kindle calm with a Medium-like rhythm.
                            </h2>
                        </div>
                        <div className="space-y-6 text-slate-600">
                            <p className="leading-8">
                                Horizontal swipes move page to page. Transitions stay soft and unobtrusive so you never lose
                                context while navigating a chapter.
                            </p>
                            <p className="leading-8">
                                If a page is gated, content dims with subtle blur and a compact payment action. No loud gradients,
                                no dashboard clutter, and no wallet confusion.
                            </p>
                        </div>
                    </motion.div>
                </section>

                <section className="layout-wrap pb-24 md:pb-32">
                    <div className="grid gap-6 md:grid-cols-2">
                        <motion.div {...fadeUp} className="surface p-8 md:p-10">
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">x402 buyer path</p>
                            <ol className="mt-6 space-y-5 text-slate-700">
                                <li className="text-lg leading-8">Request content and receive 402 unlock requirements when locked.</li>
                                <li className="text-lg leading-8">Top up prepaid balance once, then choose page/chapter bundles.</li>
                                <li className="text-lg leading-8">Unlock ranges instantly while backend verifies and tracks entitlement.</li>
                            </ol>
                        </motion.div>

                        <motion.div {...fadeUp} className="surface p-8 md:p-10">
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">x402 seller path</p>
                            <ol className="mt-6 space-y-5 text-slate-700">
                                <li className="text-lg leading-8">Define page/chapter pricing and progressive bundle economics.</li>
                                <li className="text-lg leading-8">Serve protected endpoints with standards-based 402 responses.</li>
                                <li className="text-lg leading-8">Settle revenue from consumption events with transparent analytics.</li>
                            </ol>
                        </motion.div>
                    </div>
                </section>

                <section className="layout-wrap pb-24 md:pb-32">
                    <motion.div {...fadeUp} className="max-w-4xl">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Built for facilitation</p>
                        <h3 className="mt-5 font-display text-4xl leading-tight text-slate-900 md:text-5xl">
                            Facilitator-ready architecture without changing your reader experience.
                        </h3>
                        <p className="mt-8 text-lg leading-9 text-slate-600">
                            Stackpad follows the x402 Stacks model so buyer, seller, and facilitator roles can interoperate.
                            The frontend keeps this complexity hidden behind a clean unlock flow while preserving traceability in
                            payment proof handling.
                        </p>
                    </motion.div>
                </section>

                <section className="layout-wrap pb-28 md:pb-36">
                    <motion.div {...fadeUp} className="surface p-10 md:p-14">
                        <h4 className="max-w-2xl font-display text-4xl leading-tight text-slate-900 md:text-5xl">
                            Read one page at a time, and pay only for value you keep.
                        </h4>
                        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
                            Open the library to test the full paywall journey with clear pricing, direct recipient details, and
                            minimal interaction overhead.
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
