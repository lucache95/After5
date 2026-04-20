import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Inter } from 'next/font/google';
import { PostHogProvider } from './PostHogProvider';
import './globals.css';
// Global import so Mapbox GL's canvas + controls are always styled — when we
// imported this inside the dynamic client component the CSS wasn't reliably
// applying in production.
import 'mapbox-gl/dist/mapbox-gl.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  weight: ['400', '500', '600'],
});

const interDisplay = Inter({
  subsets: ['latin'],
  variable: '--font-inter-display',
  display: 'swap',
  weight: ['600', '700'],
});

export const metadata: Metadata = {
  title: {
    default: 'After5 — Plan the perfect Kelowna date in 30 seconds',
    template: '%s · After5',
  },
  description:
    'Curated date itineraries built for your vibe, budget, and time — by people who actually live in Kelowna.',
  metadataBase: new URL('https://after5.app'),
  openGraph: {
    title: 'After5 — Plan the perfect Kelowna date in 30 seconds',
    description:
      'Curated date itineraries built for your vibe, budget, and time — by people who actually live in Kelowna.',
    url: 'https://after5.app',
    siteName: 'After5',
    locale: 'en_CA',
    type: 'website',
    images: [{ url: '/og.jpg', width: 1920, height: 1080, alt: 'After5 — Kelowna date planner' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'After5',
    description: 'Plan the perfect Kelowna date in 30 seconds.',
    images: ['/og.jpg'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${interDisplay.variable}`}>
      <body>
        <Suspense fallback={null}>
          <PostHogProvider>{children}</PostHogProvider>
        </Suspense>
      </body>
    </html>
  );
}
