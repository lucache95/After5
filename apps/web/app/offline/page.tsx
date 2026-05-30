import type { Metadata } from 'next';

// Offline fallback served by the service worker when a navigation fails with
// no network. Kept dependency-free and self-styled so it renders even when
// other assets are uncached.

export const metadata: Metadata = {
  title: 'offline',
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75rem',
        padding: '2rem',
        textAlign: 'center',
        backgroundColor: '#FAF4EC',
        color: '#1A1A1A',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: '#E0218A' }}>
        you&apos;re offline
      </h1>
      <p style={{ margin: 0, maxWidth: '28ch', lineHeight: 1.5 }}>
        no connection right now. reconnect and we&apos;ll pick up where you left off.
      </p>
    </main>
  );
}
