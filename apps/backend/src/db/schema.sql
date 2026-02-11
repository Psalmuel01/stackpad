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

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_books_author ON books(author_address);
CREATE INDEX IF NOT EXISTS idx_books_contract_id ON books(contract_book_id);
CREATE INDEX IF NOT EXISTS idx_pages_book ON pages(book_id);
CREATE INDEX IF NOT EXISTS idx_pages_lookup ON pages(book_id, page_number);
CREATE INDEX IF NOT EXISTS idx_payments_reader ON payment_logs(reader_address);
CREATE INDEX IF NOT EXISTS idx_payments_book ON payment_logs(book_id);
CREATE INDEX IF NOT EXISTS idx_payments_tx ON payment_logs(tx_hash);
