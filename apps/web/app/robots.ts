import type { MetadataRoute } from 'next';

const SITE = 'https://after5.app';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: ['/api/'] },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
