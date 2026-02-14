# Stackpad Backend

This is the Express.js backend for Stackpad. It handles:
- Book metadata and content storage (PostgreSQL)
- Prepaid reader credit balances and atomic unlock deductions
- Author dashboards and uploads
- Treasury-signed batched STX payouts to authors

## Setup

1.  **Install Dependencies** (from root):
    ```bash
    npm install
    ```

2.  **Environment Variables**:
    Copy `.env.example` to `.env` and configure your database and Stacks network settings.
    ```bash
    cp .env.example .env
    ```
    Required for prepaid credits:
    - `STACKPAD_TREASURY_ADDRESS` (wallet that receives reader top-up transfers)
    - `STACKPAD_TREASURY_PRIVATE_KEY` (hex private key for the treasury signer used to broadcast author payouts)

3.  **Database Migration**:
    Initialize the database schema.
    ```bash
    npm run migrate
    ```

## Running the Server

### Development Mode
Runs the server with hot-reloading using `tsx watch`.

```bash
# From the root directory:
npm run backend

# OR from apps/backend:
cd apps/backend
npm run dev
```

The server will start on `http://localhost:3001`.

### Production Mode
Builds the TypeScript code and starts the node server.

```bash
npm run build
npm start
```

## API Endpoints

-   `GET /api/books`: List all books
-   `GET /api/books/:id`: Get book details
-   `GET /api/content/:bookId/page/:pageNum`: Get page content (deducts reader credits for locked pages)
-   `GET /api/credits/balance?address=SP...`: Reader credit balance
-   `GET /api/credits/platform-revenue`: Platform fee ledger summary (pending/settled)
-   `POST /api/credits/deposit-intent`: Create top-up intent
-   `POST /api/credits/settle`: Verify deposit tx and credit balance
-   `POST /api/credits/settle-authors`: Manually trigger treasury payout batching (ops/debug)
-   `POST /api/author/upload`: Upload a new book (Author only)

## Author Settlement

Author payouts are processed by a background worker:

- Revenue events are created when locked pages/chapters are unlocked from prepaid credits.
- At unlock time, each deduction is split into `author_share` and `platform_fee`.
- Worker groups events by author and broadcasts one treasury-signed STX transfer per author batch.
- Batch tx status is reconciled against the Stacks API until confirmed.

Platform fee behavior:
- Platform fee stays in treasury by default (no automatic outbound transfer).
- Pending/settled totals are tracked in `platform_revenue_events`.
- Set `PLATFORM_FEE_BPS` (default `100`, i.e. 1%).

Key settings:

- `AUTHOR_SETTLEMENT_INTERVAL_MS` (default `60000`)
- `AUTHOR_SETTLEMENT_TIMEOUT_MS` (default `900000`)
- `AUTHOR_SETTLEMENT_RECONCILE_LIMIT` (default `50`)
- `AUTHOR_PAYOUT_MIN_MICROSTX` (default `1`)
- `PLATFORM_FEE_BPS` (default `100`)
