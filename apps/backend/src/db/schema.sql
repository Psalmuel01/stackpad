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
  contract_book_id INTEGER,        -- Legacy field (no longer used by app runtime)
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

-- Reader last-position resume marker per book
CREATE TABLE IF NOT EXISTS reader_book_progress (
  wallet_address VARCHAR(50) NOT NULL,
  book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
  last_page INTEGER NOT NULL CHECK (last_page >= 1),
  updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY(wallet_address, book_id)
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
  settlement_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  settlement_batch_id INTEGER,
  payout_tx_hash VARCHAR(100),
  payout_attempts INTEGER NOT NULL DEFAULT 0 CHECK (payout_attempts >= 0),
  processing_started_at TIMESTAMP,
  last_error TEXT,
  settled BOOLEAN NOT NULL DEFAULT FALSE,
  settled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Settlement batches for author payout accounting
CREATE TABLE IF NOT EXISTS author_settlement_batches (
  id SERIAL PRIMARY KEY,
  author_address VARCHAR(50),
  total_amount BIGINT NOT NULL CHECK (total_amount >= 0),
  event_count INTEGER NOT NULL CHECK (event_count >= 0),
  network VARCHAR(40),
  status VARCHAR(20) NOT NULL DEFAULT 'created',
  payout_tx_hash VARCHAR(100),
  nonce BIGINT,
  last_error TEXT,
  broadcast_at TIMESTAMP,
  confirmed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Backfill/compatibility migrations for existing databases
ALTER TABLE author_revenue_events
  ADD COLUMN IF NOT EXISTS settlement_status VARCHAR(20) NOT NULL DEFAULT 'pending';
ALTER TABLE author_revenue_events
  ADD COLUMN IF NOT EXISTS settlement_batch_id INTEGER REFERENCES author_settlement_batches(id) ON DELETE SET NULL;
ALTER TABLE author_revenue_events
  ADD COLUMN IF NOT EXISTS payout_tx_hash VARCHAR(100);
ALTER TABLE author_revenue_events
  ADD COLUMN IF NOT EXISTS payout_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE author_revenue_events
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMP;
ALTER TABLE author_revenue_events
  ADD COLUMN IF NOT EXISTS last_error TEXT;

ALTER TABLE author_settlement_batches
  ADD COLUMN IF NOT EXISTS author_address VARCHAR(50);
ALTER TABLE author_settlement_batches
  ADD COLUMN IF NOT EXISTS network VARCHAR(40);
ALTER TABLE author_settlement_batches
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'created';
ALTER TABLE author_settlement_batches
  ADD COLUMN IF NOT EXISTS payout_tx_hash VARCHAR(100);
ALTER TABLE author_settlement_batches
  ADD COLUMN IF NOT EXISTS nonce BIGINT;
ALTER TABLE author_settlement_batches
  ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE author_settlement_batches
  ADD COLUMN IF NOT EXISTS broadcast_at TIMESTAMP;
ALTER TABLE author_settlement_batches
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_author_revenue_settlement_batch'
  ) THEN
    ALTER TABLE author_revenue_events
      ADD CONSTRAINT fk_author_revenue_settlement_batch
      FOREIGN KEY (settlement_batch_id)
      REFERENCES author_settlement_batches(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_books_author ON books(author_address);
CREATE INDEX IF NOT EXISTS idx_books_contract_id ON books(contract_book_id); -- Legacy index for legacy field
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
CREATE INDEX IF NOT EXISTS idx_reader_progress_updated ON reader_book_progress(wallet_address, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_author_revenue_author ON author_revenue_events(author_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_author_revenue_settled ON author_revenue_events(settled, created_at);
CREATE INDEX IF NOT EXISTS idx_author_revenue_settlement_status ON author_revenue_events(settlement_status, created_at);
CREATE INDEX IF NOT EXISTS idx_author_settlement_batch_status ON author_settlement_batches(status, created_at);
