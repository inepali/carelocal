import type { NextConfig } from "next";

// Signed-in areas must never appear in search results, even if a link leaks.
const NOINDEX_PATHS = ['/admin/:path*', '/center/:path*', '/staff/:path*', '/mobile/:path*', '/api/:path*']

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
      ...NOINDEX_PATHS.map(source => ({
        source,
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      })),
    ];
  },
};

export default nextConfig;
