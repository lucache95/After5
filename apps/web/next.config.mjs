/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@after5/api-client', '@after5/types', '@after5/validators'],
  // typedRoutes was rejecting template-literal hrefs to dynamic /dates/[slug]
  // pages. Off for now — TypeScript still catches static URL typos at the
  // component-level via Link's href prop in non-experimental mode.
  images: {
    remotePatterns: [
      // Google Places Photos API endpoint — issues a 302 to the actual image.
      { protocol: 'https', hostname: 'places.googleapis.com' },
      // Where Google's redirect lands (image content host).
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'lh4.googleusercontent.com' },
      { protocol: 'https', hostname: 'lh5.googleusercontent.com' },
      { protocol: 'https', hostname: 'lh6.googleusercontent.com' },
      // Mapbox Static Images API — used for the route map (no WebGL needed).
      { protocol: 'https', hostname: 'api.mapbox.com' },
      // Supabase Storage — hosts AI-generated itinerary covers (FLUX schnell)
      // and email assets (welcome polaroid PNGs). Without this, next/image
      // returns a broken-image placeholder.
      { protocol: 'https', hostname: 'ufufmcpnysvwtutpbian.supabase.co' },
      // Unsplash — placeholder/seed imagery for local QA + sample content.
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
  },
  async rewrites() {
    return [
      // Investor pitch deck — static HTML in public/pitch/. Rewrite keeps the
      // clean /pitch URL while serving the file (Next doesn't auto-index dirs).
      { source: '/pitch', destination: '/pitch/index.html' },
      // Condensed 3-slide cut for quick VC forwards.
      { source: '/pitch-short', destination: '/pitch-short/index.html' },
    ];
  },
  async redirects() {
    return [
      // Retire the legacy date-PLANNER routes (old brand: serif After5,
      // cream/black/rust). /create is the Barbiecore replacement.
      { source: '/plan', destination: '/create', permanent: true },
      { source: '/plan/i/:id', destination: '/create', permanent: true },
      { source: '/templates/:id', destination: '/create', permanent: true },
      { source: '/wow/:id', destination: '/create', permanent: true },
    ];
  },
};

export default nextConfig;
