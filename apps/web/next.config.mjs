/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@after5/api-client', '@after5/types', '@after5/validators'],
  experimental: {
    typedRoutes: true,
  },
  images: {
    remotePatterns: [
      // Google Places Photos API endpoint — issues a 302 to the actual image.
      { protocol: 'https', hostname: 'places.googleapis.com' },
      // Where Google's redirect lands (image content host).
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'lh4.googleusercontent.com' },
      { protocol: 'https', hostname: 'lh5.googleusercontent.com' },
      { protocol: 'https', hostname: 'lh6.googleusercontent.com' },
    ],
  },
};

export default nextConfig;
