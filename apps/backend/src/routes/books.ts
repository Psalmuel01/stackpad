import { Router, Request, Response } from 'express';
import pool from '../db/client';

const router = Router();

/**
 * GET /api/books
 * List all active books
 */
router.get('/', async (req: Request, res: Response) => {
    try {
        const result = await pool.query(
            `SELECT 
                id, 
                author_address as "authorAddress", 
                title, 
                cover_image_url as "coverImageUrl", 
                total_pages as "totalPages", 
                total_chapters as "totalChapters", 
                page_price as "pagePrice", 
                chapter_price as "chapterPrice", 
                created_at as "createdAt"
             FROM books 
             ORDER BY created_at DESC`
        );

        res.json({
            success: true,
            books: result.rows,
            total: result.rows.length,
        });
    } catch (error) {
        console.error('Error fetching books:', error);
        res.status(500).json({ error: 'Failed to fetch books' });
    }
});

/**
 * GET /api/books/:id
 * Get book metadata
 */
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const bookId = parseInt(req.params.id, 10);

        const result = await pool.query(
            `SELECT 
                id, 
                author_address as "authorAddress", 
                title, 
                cover_image_url as "coverImageUrl", 
                total_pages as "totalPages", 
                total_chapters as "totalChapters", 
                page_price as "pagePrice", 
                chapter_price as "chapterPrice", 
                contract_book_id as "contractBookId", 
                created_at as "createdAt"
       FROM books 
       WHERE id = $1`,
            [bookId]
        );

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Book not found' });
            return;
        }

        res.json({
            success: true,
            book: result.rows[0],
        });
    } catch (error) {
        console.error('Error fetching book:', error);
        res.status(500).json({ error: 'Failed to fetch book' });
    }
});

/**
 * POST /api/books
 * Create a new book (author only)
 */
router.post('/', async (req: Request, res: Response) => {
    try {
        const {
            authorAddress,
            title,
            coverImageUrl,
            totalPages,
            totalChapters,
            pagePrice,
            chapterPrice,
        } = req.body;

        // Validation
        if (!authorAddress || !title || !totalPages || !pagePrice || !chapterPrice) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }

        const result = await pool.query(
            `INSERT INTO books (author_address, title, cover_image_url, total_pages, total_chapters, page_price, chapter_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING 
        id, 
        author_address as "authorAddress", 
        title, 
        cover_image_url as "coverImageUrl", 
        total_pages as "totalPages", 
        total_chapters as "totalChapters", 
        page_price as "pagePrice", 
        chapter_price as "chapterPrice", 
        created_at as "createdAt"`,
            [authorAddress, title, coverImageUrl || null, totalPages, totalChapters || 0, pagePrice, chapterPrice]
        );

        res.status(201).json({
            success: true,
            book: result.rows[0],
        });
    } catch (error) {
        console.error('Error creating book:', error);
        res.status(500).json({ error: 'Failed to create book' });
    }
});

export default router;
