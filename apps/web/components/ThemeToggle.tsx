'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'stackpad-theme';

export function ThemeToggle() {
    const [theme, setTheme] = useState<Theme>('light');
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        const initial = resolveInitialTheme();
        applyTheme(initial, false);
        setTheme(initial);
        setMounted(true);
    }, []);

    function toggleTheme() {
        const next: Theme = theme === 'dark' ? 'light' : 'dark';
        applyTheme(next, true);
        setTheme(next);
    }

    return (
        <button
            type="button"
            onClick={toggleTheme}
            className="theme-toggle"
            aria-label={mounted ? `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode` : 'Toggle theme'}
            title={mounted ? `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode` : 'Toggle theme'}
        >
            <span className="theme-toggle-track" aria-hidden>
                <span className={`theme-toggle-knob ${theme === 'dark' ? 'translate-x-5' : 'translate-x-0'}`} />
                <span className="absolute left-1 top-1.5 text-[hsl(var(--muted-strong))]">
                    <SunIcon />
                </span>
                <span className="absolute right-1 top-1.5 text-[hsl(var(--muted-strong))]">
                    <MoonIcon />
                </span>
            </span>
        </button>
    );
}

function resolveInitialTheme(): Theme {
    if (typeof window === 'undefined') {
        return 'light';
    }

    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
        return stored;
    }

    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
}

function applyTheme(theme: Theme, persist: boolean) {
    if (typeof document === 'undefined') {
        return;
    }

    document.documentElement.dataset.theme = theme;
    if (persist && typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, theme);
    }
}

function SunIcon() {
    return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2" />
            <path d="M12 20v2" />
            <path d="m4.93 4.93 1.41 1.41" />
            <path d="m17.66 17.66 1.41 1.41" />
            <path d="M2 12h2" />
            <path d="M20 12h2" />
            <path d="m6.34 17.66-1.41 1.41" />
            <path d="m19.07 4.93-1.41 1.41" />
        </svg>
    );
}

function MoonIcon() {
    return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />
        </svg>
    );
}
