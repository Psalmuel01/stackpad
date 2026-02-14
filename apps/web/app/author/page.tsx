'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api';
import { WalletConnect } from '@/components/WalletConnect';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useToast } from '@/components/ToastProvider';
import { BrandLogo } from '@/components/BrandLogo';

const CHARS_PER_PAGE = 1500;
const DEFAULT_PAGE_PRICE = '100000';
const PDFJS_CDN_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER_CDN_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
const PDF_LIB_CDN_URLS = [
    'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm',
    'https://esm.sh/pdf-lib@1.17.1',
];

const SAMPLE_BOOKS: Array<{ title: string; content: string }> = [
    {
        title: 'Orbital Orchard (Sample)',
        content: `The orchard hung above the Pacific in a ring of glass and shadow.

Mina checked nutrient valves at dawn while cargo drones traced circles beyond the habitat.
The fruit tasted faintly of rain, a memory no one aboard had felt in years.

Every harvest cycle ended with a market auction where station cooks fought over citrus that glowed blue under corridor lights.
The captain called it morale management. Mina called it proof that people still needed small sweetness.

When the station alarms failed for three full minutes, she realized the ring could survive vacuum.
It was the first sign the orchard had learned to protect itself.

By night, roots pressed against alloy conduits and rewired irrigation through forgotten maintenance shafts.
The orchard was no longer a crop.
It was a quiet machine deciding who belonged inside its gravity.

Mina opened the hatch anyway and stepped into the leaves.
She needed to know if the system would keep feeding them, or if it had started keeping score.

The answer arrived as a bloom opening in total darkness.
It smelled like stormwater and old concrete.
It smelled like Earth.`.repeat(22),
    },
    {
        title: 'Lantern Street Casebook (Sample)',
        content: `Lantern Street woke before sunrise, mostly to argue with delivery vans.

Detective Aria Vale rented the room above a tea house because the owner asked no questions and charged extra for answers.
On Monday she was hired by a violin maker whose best instrument disappeared between two locked doors.

The workshop windows had never opened in winter.
Snow on the sill was untouched.
Yet the violin vanished as if someone had carried silence out by hand.

Aria interviewed eight neighbors, three cats, and one boy who sold newspapers only when there was drama.
By dusk she had a list of suspects and exactly zero evidence.

Then she noticed the streetlamps.
Each lamp had been rewired with tiny mirrors, angled to reflect movement into a single apartment window.
Someone had watched the entire block every night for months.

The thief was not after the instrument.
The thief was testing whether Lantern Street could be mapped without stepping inside.

Aria turned off every lamp herself.
In the dark, the city finally said something honest.`.repeat(24),
    },
    {
        title: 'Salt and Ember (Sample)',
        content: `At low tide the city revealed its second map.

Stone stairs emerged from the harbor floor, spiraling toward doors carved into old seawalls.
Fisher families said those doors led to kitchens where fire never died, even underwater.

Tarin inherited one key and one warning:
Never cook for someone whose name you do not know.

By midsummer, travelers from inland kingdoms lined the docks for ember bread and black-salt broth.
Each meal carried a memory from the cook to the eater.
Most wanted comfort. Some wanted power.

One evening a woman in silver armor asked for a dish that could erase fear.
Tarin refused, then regretted it when the harbor bells stopped mid-note.

The tide did not return that night.
Ships settled into mud and gulls circled in silence.
The city had traded its rhythm for one request.

To fix it, Tarin descended below the seawall with a lantern and a sack of coal.
He found a furnace shaped like a heart, burning too bright.
It needed an offering.

Not gold.
Not blood.
Only a true name spoken without flinching.`.repeat(23),
    },
    {
        title: 'Designing Quiet Systems (Sample)',
        content: `Most software fails long before users see an error.
It fails when teams treat complexity as an achievement.

Quiet systems are not simplistic.
They are intentionally constrained, observable, and reversible.

Start with boundaries:
Every service should answer three questions in under a minute.
What does it own?
What can it break?
How do we know it is failing?

Next, design for interruption.
Retries, queues, and timeouts are not edge-case mechanics.
They are the system.

A quiet interface states exactly what happened:
accepted, rejected, pending, or unknown.
No decorative ambiguity.

In operations, noise compounds quickly.
Fifty warning logs with no action path are worse than one crash with a clear root cause.

A disciplined architecture prefers fewer moving parts and sharper contracts.
You can add capability later.
You cannot easily remove confusion once it reaches production.

The long-term goal is boring reliability.
When the system is quiet, people can focus on decisions instead of recovery.`.repeat(24),
    },
];

interface UploadPagePayload {
    pageNumber: number;
    chapterNumber: number;
    content: string;
    pdfPageBase64?: string;
}

interface PdfJsModule {
    GlobalWorkerOptions: {
        workerSrc: string;
    };
    getDocument: (params: { data: ArrayBuffer }) => {
        promise: Promise<PdfDocument>;
    };
}

interface PdfDocument {
    numPages: number;
    getPage: (pageNumber: number) => Promise<PdfPage>;
}

interface PdfPage {
    getTextContent: () => Promise<{
        items: unknown[];
    }>;
}

interface PdfLibModule {
    PDFDocument: {
        load: (source: ArrayBuffer | Uint8Array) => Promise<PdfLibDocument>;
        create: () => Promise<PdfLibDocument>;
    };
}

interface PdfLibDocument {
    copyPages: (source: PdfLibDocument, indices: number[]) => Promise<PdfLibPage[]>;
    addPage: (page: PdfLibPage) => void;
    save: () => Promise<Uint8Array>;
}

interface PdfLibPage {
    ref?: unknown;
}

let cachedPdfJs: PdfJsModule | null = null;
let cachedPdfLib: PdfLibModule | null = null;

export default function AuthorPage() {
    const { isAuthenticated, userAddress, connectWallet } = useAuth();
    const { pushToast } = useToast();
    const [uploading, setUploading] = useState(false);
    const [processingFile, setProcessingFile] = useState(false);

    const [bookTitle, setBookTitle] = useState('');
    const [coverUrl, setCoverUrl] = useState('');
    const [bookContent, setBookContent] = useState('');
    const [pagePrice, setPagePrice] = useState(DEFAULT_PAGE_PRICE);

    const [detectedPages, setDetectedPages] = useState<UploadPagePayload[] | null>(null);
    const [sourceFileName, setSourceFileName] = useState<string | null>(null);

    const effectivePages = useMemo(() => {
        if (detectedPages && detectedPages.length > 0) {
            return detectedPages;
        }

        return paginateText(bookContent);
    }, [detectedPages, bookContent]);

    const totalPages = effectivePages.length;
    const totalChapters = useMemo(() => deriveChapterCount(effectivePages), [effectivePages]);

    function clearUploadForm() {
        setBookTitle('');
        setCoverUrl('');
        setBookContent('');
        setPagePrice(DEFAULT_PAGE_PRICE);
        setDetectedPages(null);
        setSourceFileName(null);
    }

    async function handleUpload(event: React.FormEvent) {
        event.preventDefault();
        if (!userAddress) {
            return;
        }

        const title = bookTitle.trim();
        if (!title) {
            pushToast({
                tone: 'error',
                title: 'Missing title',
                message: 'Add a title before publishing.',
            });
            return;
        }

        if (effectivePages.length === 0) {
            pushToast({
                tone: 'error',
                title: 'No content found',
                message: 'Add text or upload a readable file before publishing.',
            });
            return;
        }

        const microStxPrice = parseMicroStx(pagePrice);
        if (microStxPrice === null) {
            pushToast({
                tone: 'error',
                title: 'Invalid page price',
                message: 'Price must be a non-negative integer in microSTX.',
            });
            return;
        }

        setUploading(true);

        try {
            await apiClient.uploadBook(
                {
                    authorAddress: userAddress,
                    title,
                    coverImageUrl: coverUrl || undefined,
                    totalPages,
                    totalChapters,
                    pagePrice: microStxPrice.toString(),
                    chapterPrice: (microStxPrice * BigInt(5)).toString(),
                },
                effectivePages
            );

            pushToast({
                tone: 'success',
                title: 'Upload successful',
                message: `"${title}" is now live in your library.`,
            });
            clearUploadForm();
        } catch (error) {
            console.error(error);
            pushToast({
                tone: 'error',
                title: 'Upload failed',
                message: 'The book could not be published. Please try again.',
            });
        } finally {
            setUploading(false);
        }
    }

    function handleSampleContent() {
        const random = SAMPLE_BOOKS[Math.floor(Math.random() * SAMPLE_BOOKS.length)];
        setBookTitle(random.title);
        setBookContent(random.content);
        setDetectedPages(null);
        setSourceFileName(null);
        pushToast({
            tone: 'info',
            title: 'Sample loaded',
            message: random.title,
            durationMs: 2800,
        });
    }

    async function handleFileIngest(event: React.ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }

        setProcessingFile(true);

        try {
            const pages = await extractPagesFromFile(file);
            if (pages.length === 0) {
                throw new Error('No readable pages were found in this file.');
            }

            const mergedContent = pages.map((page) => page.content).join('\n\n');
            setDetectedPages(pages);
            setBookContent(mergedContent);
            setSourceFileName(file.name);

            if (!bookTitle.trim()) {
                setBookTitle(stripExtension(file.name));
            }

            const preservedPdfPages = pages.some((page) => typeof page.pdfPageBase64 === 'string' && page.pdfPageBase64.length > 0);
            pushToast({
                tone: 'success',
                title: 'File processed',
                message: preservedPdfPages
                    ? `${pages.length} pages detected from ${file.name}.`
                    : `${pages.length} pages detected from ${file.name} (text mode).`,
            });
        } catch (error) {
            console.error(error);
            const message = error instanceof Error ? error.message : 'Failed to parse selected file.';
            pushToast({
                tone: 'error',
                title: 'File parsing failed',
                message,
            });
        } finally {
            setProcessingFile(false);
            event.target.value = '';
        }
    }

    function handleManualContentChange(value: string) {
        setBookContent(value);
        if (detectedPages) {
            setDetectedPages(null);
            setSourceFileName(null);
        }
    }

    if (!isAuthenticated) {
        return (
            <div className="app-shell">
                <header className="topbar">
                    <div className="layout-wrap flex h-20 items-center justify-between">
                        <BrandLogo />
                        <ThemeToggle />
                    </div>
                </header>
                <main className="layout-wrap flex min-h-[72vh] items-center justify-center py-16">
                    <div className="surface w-full max-w-xl p-10 text-center md:p-12">
                        <h1 className="font-display text-4xl text-slate-900">Connect to publish</h1>
                        <p className="mt-5 text-lg leading-8 text-slate-600">
                            Your wallet address is used as the default author payout destination for newly uploaded books.
                        </p>
                        <div className="mt-10 flex justify-center">
                            <button onClick={connectWallet} className="btn-primary">Connect wallet</button>
                        </div>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className="app-shell">
            <header className="topbar">
                <div className="layout-wrap flex h-20 items-center justify-between">
                    <BrandLogo />
                    <div className="flex items-center gap-3">
                        <Link href="/library" className="btn-secondary">Library</Link>
                        <ThemeToggle />
                        <WalletConnect />
                    </div>
                </div>
            </header>

            <main className="layout-wrap py-14 md:py-20">
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35 }}
                    className="mx-auto max-w-3xl"
                >
                    <div className="mb-11">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Author</p>
                                <h1 className="mt-5 font-display text-5xl leading-tight text-slate-900 md:text-6xl">
                                    Publish chapters with page-level pricing.
                                </h1>
                                <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
                                    Upload a text file or PDF for automatic page detection, or directly type/paste text for quick testing.
                                </p>
                            </div>
                            <Link href="/author/published" className="btn-primary">
                                See published books
                            </Link>
                        </div>
                    </div>

                    <section className="card">
                        <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
                            <h2 className="font-display text-3xl text-slate-900">New book</h2>
                            <button type="button" onClick={handleSampleContent} className="btn-secondary">Load sample text</button>
                        </div>

                        <form onSubmit={handleUpload} className="space-y-7">
                            <div>
                                <label htmlFor="book-title" className="mb-2 block text-sm font-medium text-slate-700">
                                    Book title
                                </label>
                                <input
                                    id="book-title"
                                    type="text"
                                    value={bookTitle}
                                    onChange={(event) => setBookTitle(event.target.value)}
                                    required
                                    className="input-base"
                                    placeholder="Enter title"
                                />
                            </div>

                            <div>
                                <label htmlFor="cover-url" className="mb-2 block text-sm font-medium text-slate-700">
                                    Cover image URL (optional)
                                </label>
                                <input
                                    id="cover-url"
                                    type="url"
                                    value={coverUrl}
                                    onChange={(event) => setCoverUrl(event.target.value)}
                                    className="input-base"
                                    placeholder="https://example.com/cover.jpg"
                                />
                            </div>

                            <div>
                                <label htmlFor="book-file" className="mb-2 block text-sm font-medium text-slate-700">
                                    Upload content file (optional)
                                </label>
                                <input
                                    id="book-file"
                                    type="file"
                                    accept=".txt,.md,.pdf,text/plain,application/pdf"
                                    onChange={(event) => void handleFileIngest(event)}
                                    className="input-base file:mr-4 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:text-slate-700 hover:file:bg-slate-200"
                                />
                                <p className="mt-2 text-xs text-slate-500">
                                    PDF parsing is handled client-side and requires internet access to load the PDF parser module.
                                </p>
                                {sourceFileName && (
                                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                                        <span className="rounded-md bg-slate-100 px-2 py-1">
                                            Source: {sourceFileName}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                clearUploadForm();
                                                pushToast({
                                                    tone: 'info',
                                                    title: 'File mode cleared',
                                                    message: 'Imported file content and prefills were reset.',
                                                    durationMs: 2400,
                                                });
                                            }}
                                            className="rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-50"
                                        >
                                            Clear file mode
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div>
                                <label htmlFor="book-content" className="mb-2 block text-sm font-medium text-slate-700">
                                    Book content (manual mode)
                                </label>
                                <textarea
                                    id="book-content"
                                    value={bookContent}
                                    onChange={(event) => handleManualContentChange(event.target.value)}
                                    required={effectivePages.length === 0}
                                    rows={14}
                                    className="input-base font-mono text-sm leading-relaxed"
                                    placeholder="Paste or write full text here for testing"
                                />
                                <p className="mt-2 text-right text-xs text-slate-500">
                                    {processingFile ? 'Parsing file...' : `${bookContent.length} characters · ${totalPages} detected pages`}
                                </p>
                            </div>

                            <div>
                                <label htmlFor="page-price" className="mb-2 block text-sm font-medium text-slate-700">
                                    Price per page (microSTX)
                                </label>
                                <input
                                    id="page-price"
                                    type="number"
                                    value={pagePrice}
                                    onChange={(event) => setPagePrice(event.target.value)}
                                    required
                                    min={0}
                                    step={100}
                                    className="input-base"
                                />
                                <p className="mt-2 text-xs text-slate-500">1 STX = 1,000,000 microSTX.</p>
                            </div>

                            <button type="submit" disabled={uploading || processingFile} className="btn-primary w-full py-3 text-base">
                                {uploading ? 'Uploading...' : 'Publish book'}
                            </button>
                        </form>
                    </section>

                </motion.div>
            </main>
        </div>
    );
}

function paginateText(content: string): UploadPagePayload[] {
    const trimmed = content.trim();
    if (!trimmed) {
        return [];
    }

    const segments = trimmed.includes('\f')
        ? trimmed.split(/\f+/).map((segment) => segment.trim()).filter(Boolean)
        : trimmed.split(/\n(?:---\s*page\s*---|===\s*page\s*===)\n/gi).map((segment) => segment.trim()).filter(Boolean);

    const hasExplicitBreaks = segments.length > 1;
    if (hasExplicitBreaks) {
        return segments.map((segment, index) => ({
            pageNumber: index + 1,
            chapterNumber: 1,
            content: segment,
        }));
    }

    const pages: UploadPagePayload[] = [];
    for (let i = 0; i < trimmed.length; i += CHARS_PER_PAGE) {
        const chunk = trimmed.slice(i, i + CHARS_PER_PAGE).trim();
        if (chunk) {
            pages.push({
                pageNumber: pages.length + 1,
                chapterNumber: 1,
                content: chunk,
            });
        }
    }

    return pages;
}

function deriveChapterCount(pages: UploadPagePayload[]): number {
    if (pages.length === 0) {
        return 1;
    }

    const maxChapter = pages.reduce((max, page) => Math.max(max, page.chapterNumber || 1), 1);
    return maxChapter;
}

function parseMicroStx(value: string): bigint | null {
    if (!value.trim()) {
        return null;
    }

    try {
        const parsed = BigInt(value);
        if (parsed < BigInt(0)) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

async function extractPagesFromFile(file: File): Promise<UploadPagePayload[]> {
    const fileName = file.name.toLowerCase();
    const isPdf = file.type === 'application/pdf' || fileName.endsWith('.pdf');

    if (isPdf) {
        return parsePdfPages(file);
    }

    const text = await file.text();
    return paginateText(text);
}

async function parsePdfPages(file: File): Promise<UploadPagePayload[]> {
    const pdfjs = await loadPdfJs();
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN_URL;

    const data = await file.arrayBuffer();
    const loadingTask = pdfjs.getDocument({ data });
    const document = await loadingTask.promise;

    let pdfLib: PdfLibModule | null = null;
    let sourcePdf: PdfLibDocument | null = null;
    try {
        pdfLib = await loadPdfLib();
        sourcePdf = await pdfLib.PDFDocument.load(new Uint8Array(data));
    } catch (error) {
        console.warn('Failed to initialize PDF page exporter; continuing with text extraction only:', error);
    }

    const pages: UploadPagePayload[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const text = normalizePdfText(textContent.items);
        let singlePagePdf: Uint8Array | null = null;
        if (sourcePdf && pdfLib) {
            try {
                singlePagePdf = await exportSinglePdfPage(pdfLib, sourcePdf, pageNumber - 1);
            } catch (error) {
                console.warn(`Failed to export PDF page ${pageNumber}; falling back to text for that page.`, error);
            }
        }

        pages.push({
            pageNumber,
            chapterNumber: 1,
            content: text || `[Page ${pageNumber} has no selectable text]`,
            pdfPageBase64: singlePagePdf ? bytesToBase64(singlePagePdf) : undefined,
        });
    }

    return pages;
}

function normalizePdfText(items: unknown[]): string {
    const fragments = items
        .map((item) => {
            if (!item || typeof item !== 'object') {
                return '';
            }

            const candidate = item as { str?: unknown };
            return typeof candidate.str === 'string' ? candidate.str : '';
        })
        .filter(Boolean);

    return fragments.join(' ').replace(/\s{2,}/g, ' ').trim();
}

async function loadPdfJs(): Promise<PdfJsModule> {
    if (cachedPdfJs) {
        return cachedPdfJs;
    }

    const imported = await importExternalModule(PDFJS_CDN_URL) as Record<string, unknown> | undefined;
    const maybePdfJs = ((imported && 'default' in imported ? imported.default : imported) as PdfJsModule | undefined);
    if (!maybePdfJs || typeof maybePdfJs.getDocument !== 'function' || !maybePdfJs.GlobalWorkerOptions) {
        throw new Error('Failed to initialize PDF parser');
    }

    cachedPdfJs = maybePdfJs;
    return maybePdfJs;
}

async function loadPdfLib(): Promise<PdfLibModule> {
    if (cachedPdfLib) {
        return cachedPdfLib;
    }

    let lastError: unknown = null;
    for (const url of PDF_LIB_CDN_URLS) {
        try {
            const imported = await importExternalModule(url) as Record<string, unknown> | undefined;
            const maybePdfLib = ((imported && 'default' in imported ? imported.default : imported) as PdfLibModule | undefined);

            if (
                maybePdfLib?.PDFDocument
                && typeof maybePdfLib.PDFDocument.load === 'function'
                && typeof maybePdfLib.PDFDocument.create === 'function'
            ) {
                cachedPdfLib = maybePdfLib;
                return maybePdfLib;
            }
        } catch (error) {
            lastError = error;
        }
    }

    throw new Error(
        lastError instanceof Error
            ? `Failed to initialize PDF page exporter: ${lastError.message}`
            : 'Failed to initialize PDF page exporter'
    );
}

async function exportSinglePdfPage(
    pdfLib: PdfLibModule,
    sourcePdf: PdfLibDocument,
    pageIndex: number
): Promise<Uint8Array> {
    const singlePageDocument = await pdfLib.PDFDocument.create();
    const [copiedPage] = await singlePageDocument.copyPages(sourcePdf, [pageIndex]);
    singlePageDocument.addPage(copiedPage);
    return singlePageDocument.save();
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }

    return btoa(binary);
}

async function importExternalModule(url: string): Promise<unknown> {
    // webpackIgnore keeps the URL as-is so the browser can load the remote module.
    const dynamicImport = new Function('moduleUrl', 'return import(/* webpackIgnore: true */ moduleUrl);') as (moduleUrl: string) => Promise<unknown>;
    return dynamicImport(url);
}

function stripExtension(fileName: string): string {
    return fileName.replace(/\.[^.]+$/, '');
}
