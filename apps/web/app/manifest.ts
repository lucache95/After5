import type { MetadataRoute } from 'next';

// Served at /manifest.webmanifest via Next file-convention (matches the
// repo's code-driven metadata routes: robots.ts, sitemap.ts).
// Barbiecore palette: warm cream background, hot-pink theme.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'after5 — match on the night, not the face',
    short_name: 'after5',
    description:
      "the dating app where you match around a real night out. everyone's verified.",
    start_url: '/home',
    display: 'standalone',
    background_color: '#FAF4EC',
    theme_color: '#E0218A',
    icons: [
      {
        src: '/icons/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
      // Rasterized PNGs for Android launchers / install prompts that prefer
      // PNG over SVG. Generated from the SVGs above (sharp).
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
