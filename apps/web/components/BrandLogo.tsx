'use client';

import Link from 'next/link';

interface BrandLogoProps {
    href?: string;
    className?: string;
    labelClassName?: string;
}

export function BrandLogo({
    href = '/',
    className = '',
    labelClassName = 'font-display text-3xl tracking-tight text-slate-900',
}: BrandLogoProps) {
    return (
        <Link href={href} className={`inline-flex items-center gap-2.5 ${className}`.trim()}>
            <BrandMark />
            <span className={labelClassName}>Stackpad</span>
        </Link>
    );
}

function BrandMark() {
    return (
        <svg
            aria-hidden="true"
            width="30"
            height="30"
            viewBox="0 0 30 30"
            fill="none"
            className="text-[hsl(var(--accent))]"
        >
            <rect x="1.5" y="1.5" width="27" height="27" rx="7" stroke="currentColor" strokeWidth="1.8" />
            <path d="M9 10a2.5 2.5 0 0 1 2.5-2.5H15v15h-3.5A2.5 2.5 0 0 0 9 25V10Z" stroke="currentColor" strokeWidth="1.6" />
            <path d="M21 10a2.5 2.5 0 0 0-2.5-2.5H15v15h3.5A2.5 2.5 0 0 1 21 25V10Z" stroke="currentColor" strokeWidth="1.6" />
            <path d="M15 7.5v15" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="22.5" cy="7.5" r="1.4" fill="currentColor" />
        </svg>
    );
}
