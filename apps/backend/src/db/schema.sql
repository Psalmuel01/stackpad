-- Books table
CREATE TABLE IF NOT EXISTS books (
  id SERIAL PRIMARY KEY,
  author_address VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  cover_image_url TEXT,
  total_pages INTEGER NOT NULL,
  total_chapters INTEGER NOT NULL,
  page_price BIGINT NOT NULL,      -- µSTX
  chapter_price BIGINT NOT NULL,   -- µSTX
  contract_book_id INTEGER,        -- Reference to on-chain book ID
  created_at TIMESTAMP DEFAULT NOW()
);

-- Book content (pages)
CREATE TABLE IF NOT EXISTS pages (
  id SERIAL PRIMARY KEY,
  book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  chapter_number INTEGER,
  content TEXT NOT NULL,           -- Base64 encoded or plain text
  UNIQUE(book_id, page_number)
);

-- Payment logs
CREATE TABLE IF NOT EXISTS payment_logs (
  id SERIAL PRIMARY KEY,
  reader_address VARCHAR(50) NOT NULL,
  book_id INTEGER REFERENCES books(id),
  page_number INTEGER,
  chapter_number INTEGER,
  tx_hash VARCHAR(100) UNIQUE NOT NULL,
  amount BIGINT NOT NULL,
  verified_at TIMESTAMP DEFAULT NOW()
);

-- Reader prepaid credit accounts
CREATE TABLE IF NOT EXISTS reader_accounts (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(50) UNIQUE NOT NULL,
  credit_balance BIGINT NOT NULL DEFAULT 0 CHECK (credit_balance >= 0),
  total_deposited BIGINT NOT NULL DEFAULT 0 CHECK (total_deposited >= 0),
  total_spent BIGINT NOT NULL DEFAULT 0 CHECK (total_spent >= 0),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Deposit intents used by wallet top-up flow
CREATE TABLE IF NOT EXISTS credit_deposit_intents (
  id VARCHAR(80) PRIMARY KEY,
  wallet_address VARCHAR(50) NOT NULL,
  amount BIGINT NOT NULL CHECK (amount > 0),
  memo TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  tx_hash VARCHAR(100) UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  settled_at TIMESTAMP,
  last_error TEXT
);

-- Signed credit ledger for deposits/deductions/refunds
CREATE TABLE IF NOT EXISTS credit_transactions (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(50) NOT NULL,
  tx_type VARCHAR(20) NOT NULL,
  amount BIGINT NOT NULL,
  balance_after BIGINT NOT NULL CHECK (balance_after >= 0),
  book_id INTEGER REFERENCES books(id) ON DELETE SET NULL,
  page_number INTEGER,
  chapter_number INTEGER,
  reference_id VARCHAR(100),
  chain_tx_hash VARCHAR(100),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Page-level unlock entitlements paid from credit balance
CREATE TABLE IF NOT EXISTS reader_page_unlocks (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(50) NOT NULL,
  book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  amount BIGINT NOT NULL CHECK (amount >= 0),
  credit_transaction_id INTEGER REFERENCES credit_transactions(id) ON DELETE SET NULL,
  unlocked_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(wallet_address, book_id, page_number)
);

-- Chapter-level unlock entitlements paid from credit balance
CREATE TABLE IF NOT EXISTS reader_chapter_unlocks (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(50) NOT NULL,
  book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
  chapter_number INTEGER NOT NULL,
  amount BIGINT NOT NULL CHECK (amount >= 0),
  credit_transaction_id INTEGER REFERENCES credit_transactions(id) ON DELETE SET NULL,
  unlocked_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(wallet_address, book_id, chapter_number)
);

-- Author earnings events generated from prepaid deductions
CREATE TABLE IF NOT EXISTS author_revenue_events (
  id SERIAL PRIMARY KEY,
  author_address VARCHAR(50) NOT NULL,
  reader_address VARCHAR(50) NOT NULL,
  book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
  page_number INTEGER,
  chapter_number INTEGER,
  amount BIGINT NOT NULL CHECK (amount >= 0),
  credit_transaction_id INTEGER REFERENCES credit_transactions(id) ON DELETE SET NULL,
  settled BOOLEAN NOT NULL DEFAULT FALSE,
  settled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Settlement batches for author payout accounting
CREATE TABLE IF NOT EXISTS author_settlement_batches (
  id SERIAL PRIMARY KEY,
  total_amount BIGINT NOT NULL CHECK (total_amount >= 0),
  event_count INTEGER NOT NULL CHECK (event_count >= 0),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_books_author ON books(author_address);
CREATE INDEX IF NOT EXISTS idx_books_contract_id ON books(contract_book_id);
CREATE INDEX IF NOT EXISTS idx_pages_book ON pages(book_id);
CREATE INDEX IF NOT EXISTS idx_pages_lookup ON pages(book_id, page_number);
CREATE INDEX IF NOT EXISTS idx_payments_reader ON payment_logs(reader_address);
CREATE INDEX IF NOT EXISTS idx_payments_book ON payment_logs(book_id);
CREATE INDEX IF NOT EXISTS idx_payments_tx ON payment_logs(tx_hash);
CREATE INDEX IF NOT EXISTS idx_reader_accounts_wallet ON reader_accounts(wallet_address);
CREATE INDEX IF NOT EXISTS idx_credit_intents_wallet ON credit_deposit_intents(wallet_address);
CREATE INDEX IF NOT EXISTS idx_credit_intents_status ON credit_deposit_intents(status, created_at);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_wallet ON credit_transactions(wallet_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_book ON credit_transactions(book_id, page_number);
CREATE INDEX IF NOT EXISTS idx_reader_unlocks_wallet_book ON reader_page_unlocks(wallet_address, book_id);
CREATE INDEX IF NOT EXISTS idx_reader_chapter_unlocks_wallet_book ON reader_chapter_unlocks(wallet_address, book_id);
CREATE INDEX IF NOT EXISTS idx_author_revenue_author ON author_revenue_events(author_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_author_revenue_settled ON author_revenue_events(settled, created_at);
