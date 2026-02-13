import { reconcilePendingDepositIntents, settleAuthorRevenueBatch } from './credits';

const ENABLE_CREDIT_WORKERS = process.env.ENABLE_CREDIT_WORKERS !== 'false';
const RECONCILE_INTERVAL_MS = parseInterval(process.env.CREDIT_RECONCILE_INTERVAL_MS, 30_000);
const SETTLEMENT_INTERVAL_MS = parseInterval(process.env.AUTHOR_SETTLEMENT_INTERVAL_MS, 60_000);

let started = false;

export function startCreditWorkers(): void {
    if (!ENABLE_CREDIT_WORKERS || started) {
        return;
    }

    started = true;

    const runReconcile = () => {
        void reconcilePendingDepositIntents().catch((error) => {
            console.error('Credit reconciler loop failed:', error);
        });
    };

    const runSettlement = () => {
        void settleAuthorRevenueBatch().catch((error) => {
            console.error('Author settlement loop failed:', error);
        });
    };

    // Run immediately on startup so ops does not wait for the first interval tick.
    runReconcile();
    runSettlement();

    setInterval(() => {
        runReconcile();
    }, RECONCILE_INTERVAL_MS);

    setInterval(() => {
        runSettlement();
    }, SETTLEMENT_INTERVAL_MS);

    console.log(
        `[credits] workers enabled (reconcile=${RECONCILE_INTERVAL_MS}ms, authorSettlement=${SETTLEMENT_INTERVAL_MS}ms)`
    );
}

function parseInterval(rawValue: string | undefined, fallback: number): number {
    if (!rawValue) {
        return fallback;
    }

    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsed) || parsed < 5_000) {
        return fallback;
    }

    return parsed;
}
