import { NextResponse } from 'next/server';
import { privateKeyToAccount } from 'x402-stacks';

export const runtime = 'nodejs';

const BUYER_NETWORK = (process.env.X402_BUYER_NETWORK || process.env.NEXT_PUBLIC_STACKS_NETWORK || 'testnet') as 'mainnet' | 'testnet';
const CLIENT_PRIVATE_KEY = process.env.CLIENT_PRIVATE_KEY || process.env.X402_CLIENT_PRIVATE_KEY;

export async function GET() {
    if (!CLIENT_PRIVATE_KEY) {
        return NextResponse.json({
            configured: false,
            error: 'CLIENT_PRIVATE_KEY is not configured',
        });
    }

    try {
        const account = privateKeyToAccount(CLIENT_PRIVATE_KEY, BUYER_NETWORK);
        return NextResponse.json({
            configured: true,
            buyerAddress: account.address,
            network: BUYER_NETWORK,
        });
    } catch {
        return NextResponse.json(
            {
                configured: false,
                error: 'Invalid CLIENT_PRIVATE_KEY format',
            },
            { status: 400 }
        );
    }
}
