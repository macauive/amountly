/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pg', 'better-auth', 'nodemailer'],
  outputFileTracingIncludes: {
    '/api/ai/receipt': ['./scripts/receipt-pdf-worker.mjs', './node_modules/pdfjs-dist/legacy/build/*.mjs', './node_modules/pdfjs-dist/package.json'],
  },
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        // Baseline for static assets and API responses; page responses use src/proxy.ts.
        { key: 'Content-Security-Policy', value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'" },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    }]
  },
}

module.exports = nextConfig
