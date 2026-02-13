import { Router, Response } from 'express';
import pool from '../db/client';
import {
    chargeCreditsForChapter,
    chargeCreditsForPage,
    getReaderCreditBalance,
    type CreditAccessInsufficient,
} from '../services/credits';

const router = Router();

/**
 * GET /api/content/:bookId/page/:pageNum
 * Get page content (protected by prepaid reader credits)
 */
router.get('/:bookId/page/:pageNum', async (req, res: Response) => {
    try {
        const bookId = parseInt(req.params.bookId, 10);
        const pageNum = parseInt(req.params.pageNum, 10);

        if (Number.isNaN(bookId) || Number.isNaN(pageNum) || pageNum < 1) {
            res.status(400).json({ error: 'Invalid book or page number' });
            return;
        }

        const pageLookup = await pool.query(
            `SELECT
                p.content,
                p.page_number,
                p.chapter_number,
                b.page_price,
                b.author_address
             FROM pages p
             JOIN books b ON b.id = p.book_id
             WHERE p.book_id = $1 AND p.page_number = $2`,
            [bookId, pageNum]
        );

        if (pageLookup.rows.length === 0) {
            res.status(404).json({ error: 'Page not found' });
            return;
        }

        const page = pageLookup.rows[0] as {
            content: string;
            page_number: number;
            chapter_number: number | null;
            page_price: string;
            author_address: string;
        };

        // Fetch navigation before any credit deduction so response assembly can't fail after charge.
        const nextPage = await pool.query(
            'SELECT page_number FROM pages WHERE book_id = $1 AND page_number > $2 ORDER BY page_number LIMIT 1',
            [bookId, pageNum]
        );

        const prevPage = await pool.query(
            'SELECT page_number FROM pages WHERE book_id = $1 AND page_number < $2 ORDER BY page_number DESC LIMIT 1',
            [bookId, pageNum]
        );

        const readerAddressHeader = req.header('X-Stacks-Address');
        const readerAddress = typeof readerAddressHeader === 'string' ? readerAddressHeader.trim() : '';

        let creditBalance: string | undefined;
        let deductedAmount = '0';

        if (pageNum > 1) {
            if (!readerAddress) {
                res.status(401).json({
                    error: 'Reader wallet address is required',
                    details: 'Send X-Stacks-Address header to access locked pages',
                });
                return;
            }

            const access = await chargeCreditsForPage({
                walletAddress: readerAddress,
                bookId,
                pageNumber: pageNum,
                chapterNumber: page.chapter_number,
                pagePrice: BigInt(page.page_price),
                authorAddress: page.author_address,
            });

            if (access.status === 'insufficient') {
                sendInsufficientCredit(res, access);
                return;
            }

            creditBalance = access.balance;
            deductedAmount = access.deductedAmount;
        } else if (readerAddress) {
            const freePageBalance = await getReaderCreditBalance(readerAddress);
            creditBalance = freePageBalance.toString();
        }

        const rendered = parseStoredPageContent(page.content);

        res.json({
            success: true,
            content: rendered.text,
            renderType: rendered.renderType,
            pdfPageBase64: rendered.pdfPageBase64,
            pageNumber: page.page_number,
            chapterNumber: page.chapter_number,
            nextPage: nextPage.rows.length > 0 ? nextPage.rows[0].page_number : null,
            prevPage: prevPage.rows.length > 0 ? prevPage.rows[0].page_number : null,
            creditBalance,
            creditDeducted: deductedAmount,
        });
    } catch (error) {
        console.error('Error fetching page:', error);
        res.status(500).json({ error: 'Failed to fetch page content' });
    }
});

/**
 * GET /api/content/:bookId/chapter/:chapterNum
 * Get all pages in a chapter (protected by prepaid reader credits)
 */
router.get('/:bookId/chapter/:chapterNum', async (req, res: Response) => {
    try {
        const bookId = parseInt(req.params.bookId, 10);
        const chapterNum = parseInt(req.params.chapterNum, 10);

        if (Number.isNaN(bookId) || Number.isNaN(chapterNum) || chapterNum < 1) {
            res.status(400).json({ error: 'Invalid book or chapter number' });
            return;
        }

        const chapterLookup = await pool.query(
            `SELECT
                p.content,
                p.page_number,
                b.chapter_price,
                b.author_address
             FROM pages p
             JOIN books b ON b.id = p.book_id
             WHERE p.book_id = $1 AND p.chapter_number = $2
             ORDER BY p.page_number`,
            [bookId, chapterNum]
        );

        if (chapterLookup.rows.length === 0) {
            res.status(404).json({ error: 'Chapter not found' });
            return;
        }

        const readerAddressHeader = req.header('X-Stacks-Address');
        const readerAddress = typeof readerAddressHeader === 'string' ? readerAddressHeader.trim() : '';

        let creditBalance: string | undefined;
        let deductedAmount = '0';

        if (chapterNum > 1) {
            if (!readerAddress) {
                res.status(401).json({
                    error: 'Reader wallet address is required',
                    details: 'Send X-Stacks-Address header to access locked chapters',
                });
                return;
            }

            const chapterPricing = chapterLookup.rows[0] as {
                chapter_price: string;
                author_address: string;
            };

            const access = await chargeCreditsForChapter({
                walletAddress: readerAddress,
                bookId,
                chapterNumber: chapterNum,
                chapterPrice: BigInt(chapterPricing.chapter_price),
                authorAddress: chapterPricing.author_address,
            });

            if (access.status === 'insufficient') {
                sendInsufficientCredit(res, access);
                return;
            }

            creditBalance = access.balance;
            deductedAmount = access.deductedAmount;
        } else if (readerAddress) {
            const freeChapterBalance = await getReaderCreditBalance(readerAddress);
            creditBalance = freeChapterBalance.toString();
        }

        res.json({
            success: true,
            chapterNumber: chapterNum,
            pages: chapterLookup.rows.map((row) => {
                const parsed = parseStoredPageContent(String(row.content ?? ''));
                return {
                    pageNumber: row.page_number,
                    content: parsed.text,
                    renderType: parsed.renderType,
                    pdfPageBase64: parsed.pdfPageBase64,
                };
            }),
            creditBalance,
            creditDeducted: deductedAmount,
        });
    } catch (error) {
        console.error('Error fetching chapter:', error);
        res.status(500).json({ error: 'Failed to fetch chapter content' });
    }
});

export default router;

function parseStoredPageContent(rawContent: string): {
    text: string;
    renderType: 'text' | 'pdf-page';
    pdfPageBase64?: string;
} {
    const trimmed = rawContent.trim();
    if (!trimmed.startsWith('{')) {
        return {
            text: rawContent,
            renderType: 'text',
        };
    }

    try {
        const parsed = JSON.parse(trimmed) as {
            format?: string;
            text?: string;
            pdfPageBase64?: string;
        };
        if (parsed.format === 'pdf-page' && typeof parsed.pdfPageBase64 === 'string' && parsed.pdfPageBase64) {
            return {
                text: typeof parsed.text === 'string' ? parsed.text : '',
                renderType: 'pdf-page',
                pdfPageBase64: parsed.pdfPageBase64,
            };
        }
    } catch {
        // keep legacy raw text fallback
    }

    return {
        text: rawContent,
        renderType: 'text',
    };
}

function sendInsufficientCredit(res: Response, access: CreditAccessInsufficient): void {
    if (!access.recipient) {
        res.status(500).json({
            success: false,
            error: 'Treasury address is not configured. Set STACKPAD_TREASURY_ADDRESS on the backend.',
        });
        return;
    }

    res.status(402).json({
        success: false,
        code: 'INSUFFICIENT_CREDIT',
        error: 'Insufficient credit balance',
        requiredAmount: access.requiredAmount,
        currentBalance: access.balance,
        shortfall: access.shortfall,
        topUp: {
            recipient: access.recipient,
            network: access.network,
            suggestedAmount: access.suggestedTopUpAmount,
        },
    });
}
