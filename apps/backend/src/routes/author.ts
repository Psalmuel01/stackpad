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

        if (!book || !pages || !Array.isArray(pages) || pages.length === 0) {
            res.status(400).json({ error: 'Invalid request: book and pages required' });
            return;
        }

        if (typeof book.authorAddress !== 'string' || !book.authorAddress.trim()) {
            res.status(400).json({ error: 'Invalid request: author address is required' });
            return;
        }

        if (typeof book.title !== 'string' || !book.title.trim()) {
            res.status(400).json({ error: 'Invalid request: title is required' });
            return;
        }

        const normalizedPages = normalizePages(pages);
        if (!normalizedPages.valid) {
            res.status(400).json({ error: normalizedPages.error });
            return;
        }

        const pagePrice = toMicroStx(book.pagePrice);
        const chapterPrice = toMicroStx(book.chapterPrice);
        if (pagePrice === null || chapterPrice === null) {
            res.status(400).json({ error: 'Invalid request: page/chapter price must be non-negative integers in microSTX' });
            return;
        }

        const totalPages = normalizedPages.pages.length;
        const totalChapters = getChapterCount(normalizedPages.pages);
        const coverImageUrl = normalizeCoverUrl(book.coverImageUrl);
        const contractBookId = normalizeOptionalInteger(book.contractBookId);
        if (book.contractBookId !== undefined && book.contractBookId !== null && contractBookId === null) {
            res.status(400).json({ error: 'Invalid request: contractBookId must be a positive integer' });
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
                book.authorAddress.trim(),
                book.title.trim(),
                coverImageUrl,
                totalPages,
                totalChapters,
                pagePrice.toString(),
                chapterPrice.toString(),
                contractBookId,
            ]
        );

        const bookId = bookResult.rows[0].id;

        // Insert pages
        for (const page of normalizedPages.pages) {
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
 * GET /api/author/books
 * List books for a specific author
 */
router.get('/books', async (req: Request, res: Response) => {
    try {
        const authorAddress = req.query.address as string;
        if (!authorAddress) {
            res.status(400).json({ error: 'Author address required' });
            return;
        }

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
             WHERE author_address = $1
             ORDER BY created_at DESC`,
            [authorAddress]
        );

        res.json({
            success: true,
            books: result.rows,
        });
    } catch (error) {
        console.error('Error fetching author books:', error);
        res.status(500).json({ error: 'Failed to fetch author books' });
    }
});

/**
 * PATCH /api/author/books/:bookId
 * Update author-owned book metadata/pricing
 */
router.patch('/books/:bookId', async (req: Request, res: Response) => {
    try {
        const bookId = Number.parseInt(req.params.bookId, 10);
        if (!Number.isInteger(bookId) || bookId < 1) {
            res.status(400).json({ error: 'Invalid book ID' });
            return;
        }

        const authorAddress = typeof req.body.authorAddress === 'string' ? req.body.authorAddress.trim() : '';
        if (!authorAddress) {
            res.status(400).json({ error: 'Author address required' });
            return;
        }

        const updates: string[] = [];
        const params: Array<string | number | null> = [];

        if (req.body.title !== undefined) {
            if (typeof req.body.title !== 'string' || !req.body.title.trim()) {
                res.status(400).json({ error: 'Title must be a non-empty string' });
                return;
            }
            params.push(req.body.title.trim());
            updates.push(`title = $${params.length}`);
        }

        if (req.body.coverImageUrl !== undefined) {
            const normalizedCover = normalizeCoverUpdate(req.body.coverImageUrl);
            if (normalizedCover === undefined) {
                res.status(400).json({ error: 'Invalid coverImageUrl value' });
                return;
            }
            params.push(normalizedCover);
            updates.push(`cover_image_url = $${params.length}`);
        }

        if (req.body.pagePrice !== undefined) {
            const parsedPagePrice = toMicroStx(req.body.pagePrice);
            if (parsedPagePrice === null) {
                res.status(400).json({ error: 'pagePrice must be a non-negative integer (microSTX)' });
                return;
            }
            params.push(parsedPagePrice.toString());
            updates.push(`page_price = $${params.length}`);
        }

        if (req.body.chapterPrice !== undefined) {
            const parsedChapterPrice = toMicroStx(req.body.chapterPrice);
            if (parsedChapterPrice === null) {
                res.status(400).json({ error: 'chapterPrice must be a non-negative integer (microSTX)' });
                return;
            }
            params.push(parsedChapterPrice.toString());
            updates.push(`chapter_price = $${params.length}`);
        }

        if (req.body.contractBookId !== undefined) {
            const normalizedBookId = normalizeOptionalInteger(req.body.contractBookId);
            if (
                req.body.contractBookId !== null
                && req.body.contractBookId !== ''
                && normalizedBookId === null
            ) {
                res.status(400).json({ error: 'contractBookId must be a positive integer or null' });
                return;
            }
            params.push(normalizedBookId);
            updates.push(`contract_book_id = $${params.length}`);
        }

        if (updates.length === 0) {
            res.status(400).json({ error: 'No updates provided' });
            return;
        }

        params.push(bookId, authorAddress);
        const result = await pool.query(
            `UPDATE books
             SET ${updates.join(', ')}
             WHERE id = $${params.length - 1} AND author_address = $${params.length}
             RETURNING
                id,
                author_address as "authorAddress",
                title,
                cover_image_url as "coverImageUrl",
                total_pages as "totalPages",
                total_chapters as "totalChapters",
                page_price as "pagePrice",
                chapter_price as "chapterPrice",
                contract_book_id as "contractBookId",
                created_at as "createdAt"`,
            params
        );

        if (result.rows.length === 0) {
            res.status(404).json({ error: 'Book not found for this author' });
            return;
        }

        res.json({
            success: true,
            book: result.rows[0],
        });
    } catch (error) {
        console.error('Error updating author book:', error);
        res.status(500).json({ error: 'Failed to update book' });
    }
});

function normalizePages(pages: unknown[]): {
    valid: true;
    pages: Array<{ pageNumber: number; chapterNumber?: number; content: string }>;
} | {
    valid: false;
    error: string;
} {
    const normalized: Array<{ pageNumber: number; chapterNumber: number; content: string }> = [];

    for (const raw of pages) {
        if (!raw || typeof raw !== 'object') {
            return {
                valid: false,
                error: 'Invalid request: every page must include pageNumber and non-empty content',
            };
        }

        const source = raw as Record<string, unknown>;
        const pageNumber = normalizePositiveInteger(source.pageNumber);
        const chapterNumber = normalizePositiveInteger(source.chapterNumber);
        const content = typeof source.content === 'string' ? source.content.trim() : '';

        if (!pageNumber || !content) {
            return {
                valid: false,
                error: 'Invalid request: every page must include pageNumber and non-empty content',
            };
        }

        normalized.push({
            pageNumber,
            chapterNumber: chapterNumber || 1,
            content,
        });
    }

    normalized.sort((a, b) => a.pageNumber - b.pageNumber);

    const pageNumbers = normalized.map((page) => page.pageNumber);
    const expected = Array.from({ length: normalized.length }, (_, i) => i + 1);
    const isSequential = pageNumbers.every((value, index) => value === expected[index]);

    if (!isSequential) {
        return {
            valid: false,
            error: 'Invalid request: page numbers must be sequential starting at 1',
        };
    }

    return {
        valid: true,
        pages: normalized,
    };
}

function normalizePositiveInteger(value: unknown): number | null {
    if (value === undefined || value === null || value === '') {
        return null;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        return null;
    }

    return parsed;
}

function normalizeOptionalInteger(value: unknown): number | null {
    if (value === undefined || value === null || value === '') {
        return null;
    }

    return normalizePositiveInteger(value);
}

function toMicroStx(value: unknown): bigint | null {
    if (value === undefined || value === null || value === '') {
        return null;
    }

    try {
        const parsed = BigInt(value as string | number | bigint);
        if (parsed < 0n) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

function normalizeCoverUrl(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) {
        return null;
    }

    try {
        const url = new URL(value.trim());
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return null;
        }
        return url.toString();
    } catch {
        return null;
    }
}

function normalizeCoverUpdate(value: unknown): string | null | undefined {
    if (value === null || value === '') {
        return null;
    }

    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const normalized = normalizeCoverUrl(trimmed);
    return normalized ?? undefined;
}

function getChapterCount(pages: Array<{ chapterNumber?: number }>): number {
    const chapterNumbers = pages
        .map((page) => page.chapterNumber || 1)
        .filter((value): value is number => Number.isInteger(value) && value > 0);

    const maxChapter = chapterNumbers.length ? Math.max(...chapterNumbers) : 1;
    return maxChapter;
}

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
