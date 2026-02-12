# Stackpad

Pay-as-you-read publishing on Stacks with x402-style HTTP 402 payment gating.

Readers unlock only the content they cross into. Authors receive STX directly to their payout address.

## Current Payment Architecture

1. Reader requests locked content.
2. Backend returns `402 Payment Required` with `payment-required` header (v2 format).
3. Reader signs and sends STX transfer from their own wallet to the author `payTo` address.
4. Reader retries with tx proof (`x-payment-proof`/`x-payment-response`).
5. Backend verifies tx on Stacks (recipient, amount, memo binding), records entitlement, serves content.

Notes:
- No server-side buyer private key is required.
- Facilitator-backed strict `payment-signature` flow is supported in backend middleware for compatible machine buyers.
- Smart contracts in `contracts/` are optional for this app version and are not required to run locally.

## Tech Stack

- Frontend: Next.js, React, TailwindCSS, Framer Motion
- Backend: Node.js, Express, PostgreSQL
- Chain verification: Stacks API (`@stacks/blockchain-api-client`)
- Payment protocol surface: x402-stacks v2 semantics

## Project Structure

```text
/Stackpad
  /apps
    /web
    /backend
  /contracts
  /packages
    /shared
    /x402-client
```

## Run Locally

### Prerequisites

- Node.js 20+
- npm
- PostgreSQL 14+
- Hiro or Leather wallet extension (fund with testnet STX for testnet usage)

### Setup

```bash
npm install
cp apps/backend/.env.example apps/backend/.env
cp apps/web/.env.example apps/web/.env.local
createdb ebook_platform
npm run migrate -w apps/backend
```

### Start

```bash
npm run dev
```

Services:
- Web: http://localhost:3000
- Backend: http://localhost:3001

## Environment Variables

Backend (`apps/backend/.env`):
- `PORT`
- `DATABASE_URL`
- `STACKS_NETWORK` (`testnet` or `mainnet`)
- `STACKS_API_URL`
- `FACILITATOR_URL` (used by strict `payment-signature` middleware path)

Frontend (`apps/web/.env.local`):
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_STACKS_NETWORK`

## License

MIT
