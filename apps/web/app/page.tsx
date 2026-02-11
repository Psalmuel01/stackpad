'use client';

import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { motion } from 'framer-motion';
import { WalletConnect } from '@/components/WalletConnect';

export default function Home() {
  const { isAuthenticated, connectWallet } = useAuth();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-slate-900 dark:via-slate-800 dark:to-indigo-950">
      {/* Header */}
      <header className="container mx-auto px-4 py-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-display font-bold bg-gradient-to-r from-primary-600 to-accent-600 bg-clip-text text-transparent">
            Stackpad
          </h1>
          {isAuthenticated ? (
            <div className="flex items-center gap-4">
              <Link href="/library" className="btn-primary">
                Go to Library
              </Link>
              <WalletConnect />
            </div>
          ) : (
            <WalletConnect />
          )}
        </div>
      </header>

      {/* Hero Section */}
      <main className="container mx-auto px-4 py-20">
        <div className="text-center max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-6xl font-display font-bold mb-6 bg-gradient-to-r from-slate-900 to-primary-700 dark:from-white dark:to-primary-300 bg-clip-text text-transparent">
              Pay Only for What You Read
            </h2>
            <p className="text-xl text-slate-600 dark:text-slate-300 mb-8 leading-relaxed">
              A decentralized eBook platform powered by Stacks blockchain.
              Pay per page or chapter with STX tokens, and own your reading history on-chain.
            </p>

            {!isAuthenticated && (
              <button onClick={connectWallet} className="btn-primary text-lg px-8 py-4">
                <span className="flex items-center gap-2">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Connect Your Wallet to Start
                </span>
              </button>
            )}
          </motion.div>

          {/* Features */}
          <motion.div
            className="grid md:grid-cols-3 gap-8 mt-20"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <div className="card hover:shadow-2xl transition-shadow">
              <div className="text-4xl mb-4">💰</div>
              <h3 className="text-xl font-bold mb-2">Pay Per Page</h3>
              <p className="text-slate-600 dark:text-slate-300">
                Unlock individual pages or entire chapters with micro-payments
              </p>
            </div>

            <div className="card hover:shadow-2xl transition-shadow">
              <div className="text-4xl mb-4">📱</div>
              <h3 className="text-xl font-bold mb-2">Swipeable Reader</h3>
              <p className="text-slate-600 dark:text-slate-300">
                Mobile-friendly interface with smooth horizontal navigation
              </p>
            </div>

            <div className="card hover:shadow-2xl transition-shadow">
              <div className="text-4xl mb-4">⛓️</div>
              <h3 className="text-xl font-bold mb-2">On-Chain Ownership</h3>
              <p className="text-slate-600 dark:text-slate-300">
                Your purchases are permanently recorded on Stacks blockchain
              </p>
            </div>
          </motion.div>
        </div>
      </main>

      {/* Footer */}
      <footer className="container mx-auto px-4 py-8 mt-20 border-t border-slate-200 dark:border-slate-700">
        <div className="text-center text-slate-500 dark:text-slate-400">
          <p>Powered by Stacks • Built with x402 Payment Protocol</p>
        </div>
      </footer>
    </div>
  );
}
