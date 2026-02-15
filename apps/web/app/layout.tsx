import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/hooks/useAuth';
import { ToastProvider } from '@/components/ToastProvider';

export const metadata: Metadata = {
  title: 'Stackpad - Pay As You Read',
  description: 'Decentralized eBook platform with pay-per-page access using Stacks blockchain',
  icons: {
    icon: [
      { url: '/icon.svg?v=2', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: 'any' },
    ],
    shortcut: '/favicon.ico',
    apple: '/icon.svg?v=2',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const themeBootstrap = `
    (function () {
      try {
        var key = 'stackpad-theme';
        var stored = localStorage.getItem(key);
        var theme = stored === 'dark' || stored === 'light'
          ? stored
          : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        document.documentElement.setAttribute('data-theme', theme);
      } catch (e) {
        var fallbackDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', fallbackDark ? 'dark' : 'light');
      }
    })();
  `;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="font-sans">
        <AuthProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
