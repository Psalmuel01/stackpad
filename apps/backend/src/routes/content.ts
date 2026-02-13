import { Router, Request, Response } from 'express';
import pool from '../db/client';
import {
    chargeCreditsForChapter,
    chargeCreditsForPage,
    getReaderCreditBalance,
    type CreditAccessInsufficient,
} from '../services/credits';

const router = Router();

/**
 * GET /api/content/:bookId/progress?address=SP...
 * Returns last read page for the given reader and book.
 */
router.get('/:bookId/progress', async (req, res: Response) => {
    try {
        const bookId = parseInt(req.params.bookId, 10);
        const readerAddress = typeof req.query.address === 'string' ? req.query.address.trim() : '';

        if (Number.isNaN(bookId) || bookId < 1) {
            res.status(400).json({ error: 'Invalid book ID' });
            return;
        }

        if (!readerAddress) {
            res.status(400).json({ error: 'Reader wallet address is required' });
            return;
        }

        const progressLookup = await pool.query(
            `SELECT last_page
             FROM reader_book_progress
             WHERE wallet_address = $1
               AND book_id = $2`,
            [readerAddress, bookId]
        );

        const lastPage = progressLookup.rows.length > 0
            ? Number(progressLookup.rows[0].last_page)
            : null;

        res.json({
            success: true,
            bookId,
            walletAddress: readerAddress,
            lastPage,
        });
    } catch (error) {
        console.error('Error fetching reading progress:', error);
        res.status(500).json({ error: 'Failed to fetch reading progress' });
    }
});

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
                sendInsufficientCredit(req, res, access);
                return;
            }

            creditBalance = access.balance;
            deductedAmount = access.deductedAmount;
        } else if (readerAddress) {
            const freePageBalance = await getReaderCreditBalance(readerAddress);
            creditBalance = freePageBalance.toString();
        }

        const rendered = parseStoredPageContent(page.content);

        if (readerAddress) {
            await upsertReaderProgress(readerAddress, bookId, page.page_number);
        }

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
                sendInsufficientCredit(req, res, access);
                return;
            }

            creditBalance = access.balance;
            deductedAmount = access.deductedAmount;
        } else if (readerAddress) {
            const freeChapterBalance = await getReaderCreditBalance(readerAddress);
            creditBalance = freeChapterBalance.toString();
        }

        if (readerAddress) {
            const lastPageInChapter = chapterLookup.rows
                .map((row) => Number(row.page_number))
                .filter((value) => Number.isInteger(value) && value > 0)
                .reduce((max, value) => Math.max(max, value), 1);
            await upsertReaderProgress(readerAddress, bookId, lastPageInChapter);
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

function sendInsufficientCredit(req: Request, res: Response, access: CreditAccessInsufficient): void {
    if (!access.recipient) {
        res.status(500).json({
            success: false,
            error: 'Treasury address is not configured. Set STACKPAD_TREASURY_ADDRESS on the backend.',
        });
        return;
    }

    const paymentRequiredPayload = createPaymentRequiredPayload(req, access);
    const accepted = paymentRequiredPayload.accepts[0];
    console.info('[x402] payment-required issued', {
        resource: paymentRequiredPayload.resource.url,
        network: accepted.network,
        amount: accepted.amount,
        asset: accepted.asset,
        payTo: accepted.payTo,
        reader: req.header('X-Stacks-Address') || null,
    });
    res.setHeader('payment-required', encodeBase64Json(paymentRequiredPayload));
    res.setHeader('WWW-Authenticate', 'x402');

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

function createPaymentRequiredPayload(req: Request, access: CreditAccessInsufficient) {
    const host = req.get('host');
    const protocol = req.protocol || 'http';
    const resourceUrl = host
        ? `${protocol}://${host}${req.originalUrl || req.path}`
        : (req.originalUrl || req.path || '');

    return {
        x402Version: 2,
        resource: {
            url: resourceUrl,
            description: 'Stackpad locked content access',
        },
        accepts: [
            {
                scheme: 'exact',
                network: access.network,
                amount: access.requiredAmount,
                asset: 'STX',
                payTo: access.recipient,
                maxTimeoutSeconds: 300,
            },
        ],
    };
}

function encodeBase64Json(payload: unknown): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

async function upsertReaderProgress(walletAddress: string, bookId: number, pageNumber: number): Promise<void> {
    if (!walletAddress || !Number.isInteger(bookId) || !Number.isInteger(pageNumber) || pageNumber < 1) {
        return;
    }

    await pool.query(
        `INSERT INTO reader_book_progress (wallet_address, book_id, last_page, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (wallet_address, book_id)
         DO UPDATE SET
            last_page = EXCLUDED.last_page,
            updated_at = NOW()`,
        [walletAddress, bookId, pageNumber]
    );
}
