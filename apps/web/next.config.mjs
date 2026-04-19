/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@after5/api-client', '@after5/types', '@after5/validators'],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
