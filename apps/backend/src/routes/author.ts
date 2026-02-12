import { Router, Request, Response } from 'express';
import pool from '../db/client';

const router = Router();

/**
 * POST /api/author/upload
 * Upload book content with pages
 */
router.post('/upload', async (req: Request, res: Response) => {
    const client = await pool.connect();

    try {
        const { book, pages } = req.body;

        if (!book || !pages || !Array.isArray(pages)) {
            res.status(400).json({ error: 'Invalid request: book and pages required' });
            return;
        }

        await client.query('BEGIN');

        const bookResult = await client.query(
            `INSERT INTO books (author_address, title, cover_image_url, total_pages, total_chapters, page_price, chapter_price, contract_book_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
            [
                book.authorAddress,
                book.title,
                book.coverImageUrl || null,
                book.totalPages,
                book.totalChapters || 0,
                book.pagePrice,
                book.chapterPrice,
                book.contractBookId || null,
            ]
        );

        const bookId = bookResult.rows[0].id;

        for (const page of pages) {
            await client.query(
                'INSERT INTO pages (book_id, page_number, chapter_number, content) VALUES ($1, $2, $3, $4)',
                [bookId, page.pageNumber, page.chapterNumber || null, page.content]
            );
        }

        await client.query('COMMIT');

        res.status(201).json({
            success: true,
            bookId,
            message: 'Book uploaded successfully',
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error uploading book:', error);
        res.status(500).json({ error: 'Failed to upload book' });
    } finally {
        client.release();
    }
});

/**
 * GET /api/author/earnings
 * Get earnings for an author (legacy payments + prepaid unlock settlements)
 */
router.get('/earnings', async (req: Request, res: Response) => {
    try {
        const authorAddress = String(req.query.address || '').trim();

        if (!authorAddress) {
            res.status(400).json({ error: 'Author address required' });
            return;
        }

        const totals = await pool.query(
            `WITH legacy AS (
                SELECT COALESCE(SUM(pl.amount), 0)::bigint AS amount
                FROM payment_logs pl
                JOIN books b ON b.id = pl.book_id
                WHERE b.author_address = $1
             ), unlocks AS (
                SELECT COALESCE(SUM(re.revenue_amount), 0)::bigint AS amount
                FROM reading_events re
                JOIN books b ON b.id = re.book_id
                WHERE b.author_address = $1
                  AND re.event_type = 'unlock'
             )
             SELECT (legacy.amount + unlocks.amount)::text AS total_earnings,
                    legacy.amount::text AS legacy_earnings,
                    unlocks.amount::text AS prepaid_earnings
             FROM legacy, unlocks`,
            [authorAddress]
        );

        const bookEarningsResult = await pool.query(
            `SELECT
                b.id AS book_id,
                b.title,
                (
                    COALESCE((
                        SELECT SUM(re.revenue_amount)
                        FROM reading_events re
                        WHERE re.book_id = b.id
                          AND re.event_type = 'unlock'
                    ), 0)
                    +
                    COALESCE((
                        SELECT SUM(pl.amount)
                        FROM payment_logs pl
                        WHERE pl.book_id = b.id
                    ), 0)
                )::text AS earnings,
                COALESCE((
                    SELECT COUNT(*)
                    FROM reading_events re
                    WHERE re.book_id = b.id
                      AND re.event_type = 'unlock'
                ), 0)::int AS unlock_events,
                COALESCE((
                    SELECT COUNT(*)
                    FROM reading_events re
                    WHERE re.book_id = b.id
                      AND re.event_type = 'view'
                ), 0)::int AS page_views,
                COALESCE((
                    SELECT COUNT(DISTINCT re.reader_address)
                    FROM reading_events re
                    WHERE re.book_id = b.id
                ), 0)::int AS active_readers
             FROM books b
             WHERE b.author_address = $1
             ORDER BY earnings::bigint DESC`,
            [authorAddress]
        );

        res.json({
            success: true,
            totalEarnings: totals.rows[0].total_earnings,
            legacyEarnings: totals.rows[0].legacy_earnings,
            prepaidEarnings: totals.rows[0].prepaid_earnings,
            bookEarnings: bookEarningsResult.rows,
        });
    } catch (error) {
        console.error('Error fetching earnings:', error);
        res.status(500).json({ error: 'Failed to fetch earnings' });
    }
});

/**
 * GET /api/author/analytics
 * Privacy-preserving reading analytics for authors
 */
router.get('/analytics', async (req: Request, res: Response) => {
    try {
        const authorAddress = String(req.query.address || '').trim();

        if (!authorAddress) {
            res.status(400).json({ error: 'Author address required' });
            return;
        }

        const pagesReadPerWallet = await pool.query(
            `SELECT
                re.reader_address,
                COUNT(DISTINCT (re.book_id, re.page_number))::int AS pages_read,
                COALESCE(SUM(re.revenue_amount), 0)::text AS revenue_contributed
             FROM reading_events re
             JOIN books b ON b.id = re.book_id
             WHERE b.author_address = $1
               AND re.event_type IN ('view', 'unlock')
             GROUP BY re.reader_address
             ORDER BY pages_read DESC, revenue_contributed::bigint DESC
             LIMIT 100`,
            [authorAddress]
        );

        const completionRates = await pool.query(
            `WITH wallet_book_progress AS (
                SELECT
                    re.book_id,
                    re.reader_address,
                    MAX(re.page_number)::int AS max_page_reached
                FROM reading_events re
                JOIN books b ON b.id = re.book_id
                WHERE b.author_address = $1
                  AND re.event_type IN ('view', 'unlock')
                GROUP BY re.book_id, re.reader_address
             )
             SELECT
                b.id AS book_id,
                b.title,
                COUNT(wbp.reader_address)::int AS readers,
                ROUND(COALESCE(AVG((wbp.max_page_reached::numeric / NULLIF(b.total_pages, 0)) * 100), 0), 2) AS average_completion_pct,
                COALESCE(MAX(wbp.max_page_reached), 0)::int AS max_page_reached,
                b.total_pages
             FROM books b
             LEFT JOIN wallet_book_progress wbp ON wbp.book_id = b.id
             WHERE b.author_address = $1
             GROUP BY b.id, b.title, b.total_pages
             ORDER BY average_completion_pct DESC`,
            [authorAddress]
        );

        const dropOffPoints = await pool.query(
            `WITH reader_last_page AS (
                SELECT
                    re.book_id,
                    re.reader_address,
                    MAX(re.page_number)::int AS last_page
                FROM reading_events re
                JOIN books b ON b.id = re.book_id
                WHERE b.author_address = $1
                  AND re.event_type IN ('view', 'unlock')
                GROUP BY re.book_id, re.reader_address
             )
             SELECT
                rlp.book_id,
                b.title,
                rlp.last_page AS page_number,
                COUNT(*)::int AS reader_count
             FROM reader_last_page rlp
             JOIN books b ON b.id = rlp.book_id
             GROUP BY rlp.book_id, b.title, rlp.last_page
             ORDER BY reader_count DESC, rlp.book_id ASC, rlp.last_page ASC
             LIMIT 100`,
            [authorAddress]
        );

        const revenueHeatmap = await pool.query(
            `SELECT
                re.book_id,
                b.title,
                COALESCE(re.chapter_number, 0)::int AS chapter_number,
                COALESCE(SUM(re.revenue_amount), 0)::text AS revenue,
                COUNT(*) FILTER (WHERE re.event_type = 'unlock')::int AS unlock_events,
                COUNT(DISTINCT re.reader_address)::int AS readers
             FROM reading_events re
             JOIN books b ON b.id = re.book_id
             WHERE b.author_address = $1
             GROUP BY re.book_id, b.title, COALESCE(re.chapter_number, 0)
             ORDER BY revenue::bigint DESC, re.book_id ASC, chapter_number ASC`,
            [authorAddress]
        );

        const topBooks = await pool.query(
            `SELECT
                b.id AS book_id,
                b.title,
                (
                    COALESCE((
                        SELECT SUM(re.revenue_amount)
                        FROM reading_events re
                        WHERE re.book_id = b.id
                          AND re.event_type = 'unlock'
                    ), 0)
                    +
                    COALESCE((
                        SELECT SUM(pl.amount)
                        FROM payment_logs pl
                        WHERE pl.book_id = b.id
                    ), 0)
                )::text AS revenue,
                COALESCE((
                    SELECT COUNT(DISTINCT re.reader_address)
                    FROM reading_events re
                    WHERE re.book_id = b.id
                ), 0)::int AS unique_readers
             FROM books b
             WHERE b.author_address = $1
             ORDER BY revenue::bigint DESC
             LIMIT 20`,
            [authorAddress]
        );

        res.json({
            success: true,
            analytics: {
                pagesReadPerWallet: pagesReadPerWallet.rows,
                completionRates: completionRates.rows,
                dropOffPoints: dropOffPoints.rows,
                revenueHeatmap: revenueHeatmap.rows,
                topBooks: topBooks.rows,
            },
        });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});

/**
 * POST /api/author/reconcile
 * Create pending settlement cycles from unlock revenue since last settlement window.
 * Requires x-admin-key header matching SETTLEMENT_ADMIN_KEY.
 */
router.post('/reconcile', async (req: Request, res: Response) => {
    try {
        const adminKey = String(req.header('x-admin-key') || '');
        if (!process.env.SETTLEMENT_ADMIN_KEY || adminKey !== process.env.SETTLEMENT_ADMIN_KEY) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const rows = await pool.query(
            `WITH latest_settlement AS (
                SELECT author_address, MAX(settled_at) AS settled_at
                FROM settlement_cycles
                WHERE status = 'processed'
                GROUP BY author_address
             ),
             candidate_revenue AS (
                SELECT
                    b.author_address,
                    COALESCE(SUM(re.revenue_amount), 0)::bigint AS amount,
                    COUNT(*)::int AS unlock_count
                FROM reading_events re
                JOIN books b ON b.id = re.book_id
                LEFT JOIN latest_settlement ls ON ls.author_address = b.author_address
                WHERE re.event_type = 'unlock'
                  AND (ls.settled_at IS NULL OR re.created_at > ls.settled_at)
                GROUP BY b.author_address
             )
             INSERT INTO settlement_cycles (author_address, amount, unlock_count)
             SELECT author_address, amount, unlock_count
             FROM candidate_revenue
             WHERE amount > 0
             RETURNING id, author_address, amount::text AS amount, unlock_count, status, created_at`,
            []
        );

        res.json({
            success: true,
            cyclesCreated: rows.rows.length,
            cycles: rows.rows,
        });
    } catch (error) {
        console.error('Error creating settlement cycles:', error);
        res.status(500).json({ error: 'Failed to create settlement cycles' });
    }
});

/**
 * POST /api/author/reconcile/mark-paid
 * Mark a settlement cycle as paid.
 */
router.post('/reconcile/mark-paid', async (req: Request, res: Response) => {
    try {
        const adminKey = String(req.header('x-admin-key') || '');
        if (!process.env.SETTLEMENT_ADMIN_KEY || adminKey !== process.env.SETTLEMENT_ADMIN_KEY) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const cycleId = Number(req.body.cycleId || 0);
        const payoutTxHash = String(req.body.payoutTxHash || '').trim();

        if (!Number.isFinite(cycleId) || cycleId <= 0 || !payoutTxHash) {
            res.status(400).json({ error: 'cycleId and payoutTxHash are required' });
            return;
        }

        const result = await pool.query(
            `UPDATE settlement_cycles
             SET status = 'processed',
                 payout_tx_hash = $2,
                 settled_at = NOW()
             WHERE id = $1
               AND status = 'pending'
             RETURNING id`,
            [cycleId, payoutTxHash]
        );

        if (result.rowCount === 0) {
            res.status(404).json({ error: 'Settlement cycle not found or already processed' });
            return;
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error marking settlement cycle as paid:', error);
        res.status(500).json({ error: 'Failed to mark settlement cycle as paid' });
    }
});

/**
 * GET /api/author/settlements
 * List settlement cycles for an author.
 */
router.get('/settlements', async (req: Request, res: Response) => {
    try {
        const authorAddress = String(req.query.address || '').trim();
        if (!authorAddress) {
            res.status(400).json({ error: 'Author address required' });
            return;
        }

        const result = await pool.query(
            `SELECT id, author_address, amount::text AS amount, unlock_count, status, payout_tx_hash, created_at, settled_at
             FROM settlement_cycles
             WHERE author_address = $1
             ORDER BY created_at DESC`,
            [authorAddress]
        );

        res.json({ success: true, settlements: result.rows });
    } catch (error) {
        console.error('Error fetching settlements:', error);
        res.status(500).json({ error: 'Failed to fetch settlements' });
    }
});

export default router;
