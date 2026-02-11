# 📚 Pay-As-You-Read# Stackpad

A decentralized reading platform where users pay per page using Stacks (STX) tokens. Built with Next.js, Express, and Clarinet.ocol.

## Features

- 💰 **Pay-per-page/chapter**: Granular access control with blockchain-verified payments
- 📱 **Swipeable UI**: Mobile-friendly horizontal swipe navigation
- 🔒 **Payment gating**: HTTP 402 responses trigger seamless wallet payments
- ⛓️ **Smart contract entitlements**: On-chain verification of access rights
- 👤 **Author dashboard**: Upload content, set pricing, track earnings

## Tech Stack

- **Frontend**: Next.js, React, TailwindCSS, Framer Motion
- **Backend**: Node.js, Express, PostgreSQL
- **Smart Contracts**: Clarity (Stacks blockchain)
- **Payment Protocol**: x402 with STX token payments
- **Wallet Integration**: Hiro/Leather wallets via @stacks/connect

## Project Structure

```
/Stackpad
  /apps
    /web              # Next.js frontend
    /backend          # Node.js API server
  /contracts          # Stacks Clarity contracts
  /packages
    /shared           # Shared TypeScript types
    /x402-client      # x402 payment client utilities
```

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- PostgreSQL 14+
- [Clarinet](https://github.com/hirosystems/clarinet) for Stacks contract development
- Hiro or Leather wallet browser extension

### Installation

1. Clone the repository and install dependencies:
```bash
npm install
```

2. Setup environment variables:
```bash
# Backend (.env in apps/backend)
cp apps/backend/.env.example apps/backend/.env

# Frontend (.env.local in apps/web)
cp apps/web/.env.example apps/web/.env.local
```

3. Start PostgreSQL and create database:
```bash
createdb ebook_platform
```

4. Run database migrations:
```bash
cd apps/backend
npm run migrate
```

5. Deploy contracts to testnet:
```bash
cd contracts
clarinet deployments apply --devnet
```

### Development

Start all services:
```bash
npm run dev
```

Or start individually:
```bash
# Frontend (http://localhost:3000)
npm run web

# Backend (http://localhost:3001)
npm run backend
```

## Testing

Run all tests:
```bash
npm test
```

Test contracts:
```bash
cd contracts
clarinet test
```

## Documentation

See [implementation_plan.md](./docs/implementation_plan.md) for detailed architecture and verification plan.

## License

MIT
