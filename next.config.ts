import type { NextConfig } from "next";

// Signed-in areas must never appear in search results, even if a link leaks.
const NOINDEX_PATHS = ['/admin/:path*', '/center/:path*', '/staff/:path*', '/mobile/:path*', '/api/:path*', '/parent/:path*']

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
      // The parent portal shows children's photos and days: never cached by a browser or proxy, no referrer
      {
        source: '/parent/:path*',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      ...NOINDEX_PATHS.map(source => ({
        source,
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      })),
    ];
  },
};

export default nextConfig;
