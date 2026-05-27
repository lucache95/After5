import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Inter, Fraunces } from 'next/font/google';
import { Toaster } from 'sonner';
import { PostHogProvider } from './PostHogProvider';
import { EarlyAccessBanner } from '@/components/EarlyAccessBanner';
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

export const metadata: Metadata = {
  title: {
    default: 'After5 — Plan the perfect Kelowna date in 30 seconds',
    template: '%s · After5',
  },
  description:
    'Curated date itineraries built for your vibe, budget, and time — by people who actually live in Kelowna.',
  metadataBase: new URL('https://tryafter5.app'),
  openGraph: {
    title: 'After5 — Plan the perfect Kelowna date in 30 seconds',
    description:
      'Curated date itineraries built for your vibe, budget, and time — by people who actually live in Kelowna.',
    url: 'https://tryafter5.app',
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
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body>
        <Toaster richColors position="top-center" />
        <Suspense fallback={null}>
          <EarlyAccessBanner />
          {/* Relative wrapper scopes absolute-positioned headers (e.g. the
              homepage hero nav) to start *below* the promo banner instead
              of behind it at the top of the viewport. */}
          <div className="relative">
            <PostHogProvider>{children}</PostHogProvider>
          </div>
        </Suspense>
      </body>
    </html>
  );
}
