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
  content TEXT NOT NULL,
  UNIQUE(book_id, page_number)
);

-- Legacy payment logs (direct x402 transfer per request)
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

-- Reader prepaid balances
CREATE TABLE IF NOT EXISTS reader_balances (
  reader_address VARCHAR(50) PRIMARY KEY,
  available_balance BIGINT NOT NULL DEFAULT 0,
  total_deposited BIGINT NOT NULL DEFAULT 0,
  total_spent BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Balance ledger (auditable deltas)
CREATE TABLE IF NOT EXISTS balance_ledger (
  id SERIAL PRIMARY KEY,
  reader_address VARCHAR(50) NOT NULL,
  delta BIGINT NOT NULL,
  reason VARCHAR(64) NOT NULL,
  book_id INTEGER REFERENCES books(id),
  page_number INTEGER,
  chapter_number INTEGER,
  bundle_type VARCHAR(32),
  reference_tx_hash VARCHAR(100),
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_balance_ledger_tx
  ON balance_ledger(reference_tx_hash)
  WHERE reference_tx_hash IS NOT NULL;

-- Unlock entitlements (range and/or chapter unlock)
CREATE TABLE IF NOT EXISTS unlock_entitlements (
  id SERIAL PRIMARY KEY,
  reader_address VARCHAR(50) NOT NULL,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  start_page INTEGER NOT NULL,
  end_page INTEGER NOT NULL,
  chapter_number INTEGER,
  bundle_type VARCHAR(32) NOT NULL,
  cost BIGINT NOT NULL,
  source_ledger_id INTEGER REFERENCES balance_ledger(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (start_page >= 1),
  CHECK (end_page >= start_page)
);

-- Reading analytics events
CREATE TABLE IF NOT EXISTS reading_events (
  id SERIAL PRIMARY KEY,
  reader_address VARCHAR(50) NOT NULL,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  chapter_number INTEGER,
  event_type VARCHAR(24) NOT NULL,
  revenue_amount BIGINT NOT NULL DEFAULT 0,
  unlock_entitlement_id INTEGER REFERENCES unlock_entitlements(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Withdrawal requests (operator settles from reading wallet contract)
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id SERIAL PRIMARY KEY,
  reader_address VARCHAR(50) NOT NULL,
  amount BIGINT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  tx_hash VARCHAR(100),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMP
);

-- Settlement cycles for author payouts
CREATE TABLE IF NOT EXISTS settlement_cycles (
  id SERIAL PRIMARY KEY,
  author_address VARCHAR(50) NOT NULL,
  amount BIGINT NOT NULL,
  unlock_count INTEGER NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  payout_tx_hash VARCHAR(100),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_books_author ON books(author_address);
CREATE INDEX IF NOT EXISTS idx_books_contract_id ON books(contract_book_id);
CREATE INDEX IF NOT EXISTS idx_pages_book ON pages(book_id);
CREATE INDEX IF NOT EXISTS idx_pages_lookup ON pages(book_id, page_number);
CREATE INDEX IF NOT EXISTS idx_pages_chapter ON pages(book_id, chapter_number, page_number);
CREATE INDEX IF NOT EXISTS idx_payments_reader ON payment_logs(reader_address);
CREATE INDEX IF NOT EXISTS idx_payments_book ON payment_logs(book_id);
CREATE INDEX IF NOT EXISTS idx_payments_tx ON payment_logs(tx_hash);
CREATE INDEX IF NOT EXISTS idx_balances_updated ON reader_balances(updated_at);
CREATE INDEX IF NOT EXISTS idx_balance_ledger_reader ON balance_ledger(reader_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unlock_reader_book ON unlock_entitlements(reader_address, book_id, start_page, end_page);
CREATE INDEX IF NOT EXISTS idx_reading_events_book ON reading_events(book_id, page_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reading_events_reader ON reading_events(reader_address, book_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_reader ON withdrawal_requests(reader_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_settlement_author ON settlement_cycles(author_address, created_at DESC);
