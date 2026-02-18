# Stackpad

Pay-as-you-read publishing on Stacks with wallet-backed prepaid credits and HTTP 402 top-up prompts.

Readers unlock only the content they cross into. Authors receive STX directly to their payout address.

**Presentation Slide**: https://docs.google.com/presentation/d/1HorFCV5kT-_wlwv9FH4zbb46K6q37668/edit?usp=sharing&ouid=100376783501249132915&rtpof=true&sd=true

**Demo Video**: https://drive.google.com/file/d/12QhKxhJzQp6CrgPLSkPWM1ucFcl7btmj/view?usp=sharing

## Current Payment Architecture

1. Reader requests locked content.
2. Backend checks prepaid balance in Postgres.
3. If sufficient, backend deducts balance atomically and serves content immediately.
4. If insufficient, backend returns `402 Payment Required` with top-up details.
5. Reader signs one top-up transfer from wallet.
6. Backend verifies deposit on Stacks, credits internal balance, and reading continues.
7. Backend settlement worker batches earnings and broadcasts treasury-signed payouts to authors.

Notes:
- No server-side buyer private key is required.
- Chain confirmation is required only for top-ups (not every page turn).
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
- `STACKPAD_TREASURY_ADDRESS` (wallet receiving reader top-ups)
- `STACKPAD_TREASURY_PRIVATE_KEY` (hex private key for treasury payout signer)
- `DEFAULT_TOP_UP_MICROSTX` (suggested top-up amount in microSTX)
- `AUTHOR_SETTLEMENT_INTERVAL_MS` (how often payout batching runs, default 60s)

Frontend (`apps/web/.env.local`):
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_STACKS_NETWORK`

## License

MIT
