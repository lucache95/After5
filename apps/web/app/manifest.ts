import type { MetadataRoute } from 'next';

// Served at /manifest.webmanifest via Next file-convention (matches the
// repo's code-driven metadata routes: robots.ts, sitemap.ts).
// Barbiecore palette: warm cream background, hot-pink theme.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'after5 — match on the night, not the guy',
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
      // TODO(follow-up): add rasterized PNG icons (192x192, 512x512, and a
      // 512 maskable). Some Android launchers and install prompts prefer PNGs
      // over SVG. Generate from the SVGs below and add entries here.
    ],
  };
}
