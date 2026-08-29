import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import { Inter, Fraunces, Caprasimo, Fredoka } from 'next/font/google';
import { Toaster } from 'sonner';
import { PostHogProvider } from './PostHogProvider';
import { PostHogIdentify } from './PostHogIdentify';
import { ServiceWorkerRegistrar } from '@/components/ServiceWorkerRegistrar';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  weight: ['400', '500', '600'],
});

// Fraunces: serif display font with optical-size axis.
// variable maps to --font-inter-display so tailwind's fontFamily.display
// resolves to Fraunces without changing the tailwind config token name.
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-inter-display',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

// Caprasimo: dating-vertical Barbiecore brand display font (--font-display).
const caprasimo = Caprasimo({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['400'],
});

// Fredoka: dating-vertical Barbiecore brand body font (--font-body).
const fredoka = Fredoka({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
  weight: ['300', '400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: {
    default: 'after5 — match on the night, not the face',
    template: '%s · after5',
  },
  description:
    "the dating app where you match around a real night out. everyone's verified. less small talk, more showing up.",
  metadataBase: new URL('https://tryafter5.app'),
  manifest: '/manifest.webmanifest',
  openGraph: {
    title: 'after5 — match on the night, not the face',
    description:
      "the dating app where you match around a real night out. everyone's verified. less small talk, more showing up.",
    url: 'https://tryafter5.app',
    siteName: 'after5',
    locale: 'en_CA',
    type: 'website',
    // images intentionally omitted — the app/opengraph-image.tsx file
    // convention auto-wires the code-generated Barbiecore share image.
  },
  twitter: {
    card: 'summary_large_image',
    title: 'after5',
    description: 'match on the night, not the face.',
    // images auto-wired by app/twitter-image.tsx.
  },
};

// PWA theme color lives in the viewport export in Next 15 (not metadata).
// Barbiecore hot-pink to match the manifest theme_color.
export const viewport: Viewport = {
  themeColor: '#E0218A',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable} ${caprasimo.variable} ${fredoka.variable}`}>
      <body>
        <Toaster richColors position="top-center" />
        <ServiceWorkerRegistrar />
        <Suspense fallback={null}>
          {/* Relative wrapper scopes absolute-positioned headers (e.g. the
              homepage hero nav). */}
          <div className="relative">
            <PostHogProvider>
              <PostHogIdentify />
              {children}
            </PostHogProvider>
          </div>
        </Suspense>
      </body>
    </html>
  );
}
