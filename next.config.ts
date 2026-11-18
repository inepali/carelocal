import type { NextConfig } from "next";

// Signed-in areas must never appear in search results, even if a link leaks.
const NOINDEX_PATHS = ['/admin/:path*', '/center/:path*', '/staff/:path*', '/mobile/:path*', '/api/:path*', '/parent/:path*', '/a/:path*']

// Generated per domain on request (they read the host), so without this every crawler or link preview
// re-runs the function. Vercel's CDN keys its cache by host, so each domain keeps its own copy.
// Vercel-CDN-Cache-Control only reaches Vercel's CDN; browsers still follow Next's own Cache-Control.
const CDN_CACHED: { source: string; value: string }[] = [
  // Share cards: satori + PNG encoding is the most CPU-heavy thing a public visit can trigger
  { source: '/opengraph-image', value: 'max-age=86400, stale-while-revalidate=604800' },
  { source: '/jobs/opengraph-image', value: 'max-age=3600, stale-while-revalidate=86400' },
  { source: '/centers/:handle/opengraph-image', value: 'max-age=86400, stale-while-revalidate=604800' },
  { source: '/sitemap.xml', value: 'max-age=3600, stale-while-revalidate=86400' },
  { source: '/robots.txt', value: 'max-age=86400, stale-while-revalidate=604800' },
]

const nextConfig: NextConfig = {
  output: 'standalone',
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          },
          {
            key: 'Service-Worker-Allowed',
            value: '/',
          }
        ],
      },
      // The parent portal shows children's photos and days, and announcement links carry a private token:
      // never cached by a browser or proxy, no referrer
      ...['/parent/:path*', '/a/:path*'].map(source => ({
        source,
        headers: [
          { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      })),
      ...CDN_CACHED.map(({ source, value }) => ({
        source,
        headers: [{ key: 'Vercel-CDN-Cache-Control', value }],
      })),
      ...NOINDEX_PATHS.map(source => ({
        source,
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      })),
    ];
  },
};

export default nextConfig;
