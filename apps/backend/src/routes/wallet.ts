import { Router, Request, Response } from 'express';
import {
    claimDeposit,
    createWithdrawalRequest,
    getReaderBalance,
    getReadingWalletAddress,
    getUnlockPreview,
    markWithdrawalProcessed,
    purchaseUnlockBundle,
} from '../services/prepaid';
import type { BundleType } from '../services/prepaid';

const router = Router();

const VALID_BUNDLES: BundleType[] = ['single-page', 'next-5-pages', 'next-10-percent', 'chapter'];

router.get('/balance', async (req: Request, res: Response) => {
    try {
        const readerAddress = String(req.query.address || '').trim();
        if (!readerAddress) {
            res.status(400).json({ error: 'Reader address is required' });
            return;
        }

        const balance = await getReaderBalance(readerAddress);
        res.json({
            success: true,
            balance: serializeBalance(balance),
        });
    } catch (error) {
        console.error('Failed to fetch balance:', error);
        res.status(500).json({ error: 'Failed to fetch balance' });
    }
});

router.get('/deposit-intent', async (req: Request, res: Response) => {
    try {
        const readerAddress = String(req.query.address || '').trim();
        if (!readerAddress) {
            res.status(400).json({ error: 'Reader address is required' });
            return;
        }

        const walletAddress = await getReadingWalletAddress();
        if (!walletAddress) {
            res.status(500).json({ error: 'Reading wallet is not configured' });
            return;
        }

        const minAmount = String(req.query.minAmount || '').trim();

        res.json({
            success: true,
            recipient: walletAddress,
            memo: createDepositMemo(readerAddress),
            network: process.env.STACKS_NETWORK || 'testnet',
            recommendedAmount: minAmount || '500000',
            note: 'Send STX to reading wallet, then call /claim-deposit with txHash to credit your prepaid balance.',
        });
    } catch (error) {
        console.error('Failed to create deposit intent:', error);
        res.status(500).json({ error: 'Failed to create deposit intent' });
    }
});

router.post('/claim-deposit', async (req: Request, res: Response) => {
    try {
        const readerAddress = String(req.body.readerAddress || '').trim();
        const txHash = String(req.body.txHash || '').trim();

        if (!readerAddress || !txHash) {
            res.status(400).json({ error: 'readerAddress and txHash are required' });
            return;
        }

        const claim = await claimDeposit(txHash, readerAddress);

        res.json({
            success: true,
            claim: {
                ...claim,
                amount: claim.amount.toString(),
                balance: serializeBalance(claim.balance),
            },
        });
    } catch (error) {
        console.error('Failed to claim deposit:', error);
        res.status(400).json({
            error: error instanceof Error ? error.message : 'Failed to claim deposit',
        });
    }
});

router.get('/unlock-options', async (req: Request, res: Response) => {
    try {
        const readerAddress = String(req.query.address || '').trim();
        const bookId = Number(req.query.bookId || 0);
        const pageNumber = Number(req.query.pageNumber || 0);

        if (!readerAddress || !Number.isFinite(bookId) || !Number.isFinite(pageNumber) || bookId <= 0 || pageNumber <= 0) {
            res.status(400).json({ error: 'address, bookId, and pageNumber are required' });
            return;
        }

        const preview = await getUnlockPreview(readerAddress, bookId, pageNumber);

        res.json({
            success: true,
            preview: serializePreview(preview),
        });
    } catch (error) {
        console.error('Failed to fetch unlock options:', error);
        res.status(400).json({
            error: error instanceof Error ? error.message : 'Failed to fetch unlock options',
        });
    }
});

router.post('/unlock', async (req: Request, res: Response) => {
    try {
        const readerAddress = String(req.body.readerAddress || '').trim();
        const bookId = Number(req.body.bookId || 0);
        const pageNumber = Number(req.body.pageNumber || 0);
        const bundleType = String(req.body.bundleType || '').trim() as BundleType;

        if (!readerAddress || !Number.isFinite(bookId) || !Number.isFinite(pageNumber) || bookId <= 0 || pageNumber <= 0) {
            res.status(400).json({ error: 'readerAddress, bookId, and pageNumber are required' });
            return;
        }

        if (!VALID_BUNDLES.includes(bundleType)) {
            res.status(400).json({ error: `bundleType must be one of: ${VALID_BUNDLES.join(', ')}` });
            return;
        }

        const result = await purchaseUnlockBundle(readerAddress, bookId, pageNumber, bundleType);

        res.json({
            success: true,
            result: {
                ...result,
                debitedAmount: result.debitedAmount.toString(),
                balance: serializeBalance(result.balance),
            },
        });
    } catch (error) {
        console.error('Failed to purchase unlock bundle:', error);
        const message = error instanceof Error ? error.message : 'Failed to unlock bundle';
        const statusCode = message === 'INSUFFICIENT_BALANCE' ? 402 : 400;
        res.status(statusCode).json({ error: message });
    }
});

router.post('/withdraw', async (req: Request, res: Response) => {
    try {
        const readerAddress = String(req.body.readerAddress || '').trim();
        const amount = parseBigIntSafely(req.body.amount);

        if (!readerAddress || amount <= 0n) {
            res.status(400).json({ error: 'readerAddress and positive amount are required' });
            return;
        }

        const result = await createWithdrawalRequest(readerAddress, amount);

        res.json({
            success: true,
            requestId: result.requestId,
            balance: serializeBalance(result.balance),
            message: 'Withdrawal request created. Operator settlement required.',
        });
    } catch (error) {
        console.error('Failed to create withdrawal request:', error);
        const message = error instanceof Error ? error.message : 'Failed to create withdrawal request';
        const statusCode = message === 'INSUFFICIENT_BALANCE' ? 400 : 500;
        res.status(statusCode).json({ error: message });
    }
});

router.post('/withdraw/mark-paid', async (req: Request, res: Response) => {
    try {
        const adminKey = String(req.header('x-admin-key') || '');
        if (!process.env.SETTLEMENT_ADMIN_KEY || adminKey !== process.env.SETTLEMENT_ADMIN_KEY) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const requestId = Number(req.body.requestId || 0);
        const txHash = String(req.body.txHash || '').trim();

        if (!Number.isFinite(requestId) || requestId <= 0 || !txHash) {
            res.status(400).json({ error: 'requestId and txHash are required' });
            return;
        }

        await markWithdrawalProcessed(requestId, txHash);

        res.json({ success: true });
    } catch (error) {
        console.error('Failed to mark withdrawal as paid:', error);
        res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to mark withdrawal' });
    }
});

function createDepositMemo(readerAddress: string): string {
    const addressSuffix = readerAddress.slice(-8);
    return `stackpad:deposit:${addressSuffix}:${Date.now().toString(36)}`;
}

function serializeBalance(balance: {
    readerAddress: string;
    availableBalance: bigint;
    totalDeposited: bigint;
    totalSpent: bigint;
}) {
    return {
        readerAddress: balance.readerAddress,
        availableBalance: balance.availableBalance.toString(),
        totalDeposited: balance.totalDeposited.toString(),
        totalSpent: balance.totalSpent.toString(),
    };
}

function serializePreview(preview: Awaited<ReturnType<typeof getUnlockPreview>>) {
    return {
        bookId: preview.bookId,
        pageNumber: preview.pageNumber,
        suggestedTopUp: preview.suggestedTopUp.toString(),
        balance: serializeBalance(preview.balance),
        options: preview.options.map((option) => ({
            ...option,
            amount: option.amount.toString(),
            effectiveAmount: option.effectiveAmount.toString(),
        })),
    };
}

function parseBigIntSafely(value: unknown): bigint {
    try {
        return BigInt(String(value || '0'));
    } catch {
        return 0n;
    }
}

export default router;
