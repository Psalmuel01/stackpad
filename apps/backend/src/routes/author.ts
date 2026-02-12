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

        // Start transaction
        await client.query('BEGIN');

        // Insert book
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

        // Insert pages
        for (const page of pages) {
            await client.query(
                'INSERT INTO pages (book_id, page_number, chapter_number, content) VALUES ($1, $2, $3, $4)',
                [bookId, page.pageNumber, page.chapterNumber || null, page.content]
            );
        }

        // Commit transaction
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
 * Get earnings for an author
 */
router.get('/earnings', async (req: Request, res: Response) => {
    try {
        const authorAddress = req.query.address as string;

        if (!authorAddress) {
            res.status(400).json({ error: 'Author address required' });
            return;
        }

        // Get total earnings
        const totalResult = await pool.query(
            `SELECT COALESCE(SUM(pl.amount), 0) as total_earnings
       FROM payment_logs pl
       JOIN books b ON b.id = pl.book_id
       WHERE b.author_address = $1`,
            [authorAddress]
        );

        // Get earnings per book
        const bookEarningsResult = await pool.query(
            `SELECT 
        b.id as book_id,
        b.title,
        COALESCE(SUM(pl.amount), 0) as earnings,
        COUNT(DISTINCT CASE WHEN pl.page_number IS NOT NULL THEN pl.id END) as pages_sold,
        COUNT(DISTINCT CASE WHEN pl.chapter_number IS NOT NULL THEN pl.id END) as chapters_sold
       FROM books b
       LEFT JOIN payment_logs pl ON b.id = pl.book_id
       WHERE b.author_address = $1
       GROUP BY b.id, b.title
       ORDER BY earnings DESC`,
            [authorAddress]
        );

        res.json({
            success: true,
            totalEarnings: totalResult.rows[0].total_earnings,
            bookEarnings: bookEarningsResult.rows,
        });
    } catch (error) {
        console.error('Error fetching earnings:', error);
        res.status(500).json({ error: 'Failed to fetch earnings' });
    }
});

export default router;
