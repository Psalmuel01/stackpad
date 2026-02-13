import { Router, Request, Response } from 'express';
import {
    createDepositIntent,
    getReaderCreditBalance,
    reconcilePendingDepositIntents,
    settleDepositIntent,
} from '../services/credits';

const router = Router();

/**
 * GET /api/credits/balance?address=SP...
 * Returns reader prepaid credit balance in microSTX.
 */
router.get('/balance', async (req: Request, res: Response) => {
    try {
        const address = typeof req.query.address === 'string' ? req.query.address.trim() : '';
        if (!address) {
            res.status(400).json({ error: 'Wallet address is required' });
            return;
        }

        const balance = await getReaderCreditBalance(address);
        res.json({
            success: true,
            walletAddress: address,
            balance: balance.toString(),
        });
    } catch (error) {
        console.error('Failed to get credit balance:', error);
        res.status(500).json({ error: 'Failed to fetch credit balance' });
    }
});

/**
 * POST /api/credits/deposit-intent
 * Creates a top-up intent used by the wallet transfer flow.
 */
router.post('/deposit-intent', async (req: Request, res: Response) => {
    try {
        const walletAddress = typeof req.body.walletAddress === 'string' ? req.body.walletAddress.trim() : '';
        const rawAmount = req.body.amount;

        if (!walletAddress) {
            res.status(400).json({ error: 'walletAddress is required' });
            return;
        }

        let amount: bigint;
        try {
            amount = BigInt(rawAmount);
        } catch {
            res.status(400).json({ error: 'amount must be a positive integer in microSTX' });
            return;
        }

        if (amount <= BigInt(0)) {
            res.status(400).json({ error: 'amount must be greater than zero' });
            return;
        }

        const intent = await createDepositIntent(walletAddress, amount);
        res.status(201).json({
            success: true,
            intent,
        });
    } catch (error) {
        console.error('Failed to create deposit intent:', error);
        res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to create deposit intent',
        });
    }
});

/**
 * POST /api/credits/settle
 * Verifies a submitted wallet top-up transaction and credits reader balance.
 */
router.post('/settle', async (req: Request, res: Response) => {
    try {
        const walletAddress = typeof req.body.walletAddress === 'string' ? req.body.walletAddress.trim() : '';
        const intentId = typeof req.body.intentId === 'string' ? req.body.intentId.trim() : '';
        const txHash = typeof req.body.txHash === 'string' ? req.body.txHash.trim() : '';

        if (!walletAddress || !intentId) {
            res.status(400).json({ error: 'walletAddress and intentId are required' });
            return;
        }

        const settlement = await settleDepositIntent(walletAddress, intentId, txHash || undefined);

        if (settlement.status === 'pending') {
            res.status(202).json({
                success: false,
                status: 'pending',
                txHash: settlement.txHash,
                error: settlement.error,
            });
            return;
        }

        if (settlement.status === 'invalid') {
            res.status(400).json({
                success: false,
                status: 'invalid',
                txHash: settlement.txHash,
                error: settlement.error || 'Deposit verification failed',
            });
            return;
        }

        res.json({
            success: true,
            status: 'confirmed',
            txHash: settlement.txHash,
            amountCredited: settlement.amountCredited,
            balance: settlement.balance,
        });
    } catch (error) {
        console.error('Failed to settle deposit:', error);
        res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to settle deposit',
        });
    }
});

/**
 * POST /api/credits/reconcile
 * Manual trigger for pending deposit reconciliation (ops/debug).
 */
router.post('/reconcile', async (_req: Request, res: Response) => {
    try {
        await reconcilePendingDepositIntents();
        res.json({
            success: true,
            message: 'Reconciliation run completed',
        });
    } catch (error) {
        console.error('Failed to reconcile deposits:', error);
        res.status(500).json({ error: 'Failed to reconcile deposits' });
    }
});

export default router;
