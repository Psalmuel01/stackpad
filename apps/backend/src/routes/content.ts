import { Router, Response } from 'express';
import { X402Request, x402PaymentGate } from '../middleware/x402';
import pool from '../db/client';

const router = Router();

/**
 * GET /api/content/:bookId/page/:pageNum
 * Get page content (protected by x402)
 */
router.get('/:bookId/page/:pageNum', async (req: X402Request, res: Response) => {
    try {
        const bookId = parseInt(req.params.bookId, 10);
        const pageNum = parseInt(req.params.pageNum, 10);

        if (Number.isNaN(bookId) || Number.isNaN(pageNum) || pageNum < 1) {
            res.status(400).json({ error: 'Invalid book or page number' });
            return;
        }

        // Set context for x402 middleware
        req.bookId = bookId;
        req.pageNumber = pageNum;

        // Apply x402 payment gate
        await x402PaymentGate(req, res, async () => {
            // Payment verified or already paid, serve content
            const result = await pool.query(
                'SELECT content, page_number, chapter_number FROM pages WHERE book_id = $1 AND page_number = $2',
                [bookId, pageNum]
            );

            if (result.rows.length === 0) {
                res.status(404).json({ error: 'Page not found' });
                return;
            }

            const page = result.rows[0];

            // Get next and previous page numbers
            const nextPage = await pool.query(
                'SELECT page_number FROM pages WHERE book_id = $1 AND page_number > $2 ORDER BY page_number LIMIT 1',
                [bookId, pageNum]
            );

            const prevPage = await pool.query(
                'SELECT page_number FROM pages WHERE book_id = $1 AND page_number < $2 ORDER BY page_number DESC LIMIT 1',
                [bookId, pageNum]
            );

            res.json({
                success: true,
                content: page.content,
                pageNumber: page.page_number,
                chapterNumber: page.chapter_number,
                nextPage: nextPage.rows.length > 0 ? nextPage.rows[0].page_number : null,
                prevPage: prevPage.rows.length > 0 ? prevPage.rows[0].page_number : null,
            });
        });
    } catch (error) {
        console.error('Error fetching page:', error);
        res.status(500).json({ error: 'Failed to fetch page content' });
    }
});

/**
 * GET /api/content/:bookId/chapter/:chapterNum
 * Get all pages in a chapter (protected by x402)
 */
router.get('/:bookId/chapter/:chapterNum', async (req: X402Request, res: Response) => {
    try {
        const bookId = parseInt(req.params.bookId, 10);
        const chapterNum = parseInt(req.params.chapterNum, 10);

        if (Number.isNaN(bookId) || Number.isNaN(chapterNum) || chapterNum < 1) {
            res.status(400).json({ error: 'Invalid book or chapter number' });
            return;
        }

        // Set context for x402 middleware
        req.bookId = bookId;
        req.chapterNumber = chapterNum;

        // Apply x402 payment gate
        await x402PaymentGate(req, res, async () => {
            // Payment verified or already paid, serve content
            const result = await pool.query(
                'SELECT content, page_number FROM pages WHERE book_id = $1 AND chapter_number = $2 ORDER BY page_number',
                [bookId, chapterNum]
            );

            if (result.rows.length === 0) {
                res.status(404).json({ error: 'Chapter not found' });
                return;
            }

            res.json({
                success: true,
                chapterNumber: chapterNum,
                pages: result.rows,
            });
        });
    } catch (error) {
        console.error('Error fetching chapter:', error);
        res.status(500).json({ error: 'Failed to fetch chapter content' });
    }
});

export default router;
