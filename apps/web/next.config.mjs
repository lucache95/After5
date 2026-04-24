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
    ],
  },
};

export default nextConfig;
