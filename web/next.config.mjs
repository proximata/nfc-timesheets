/**
 * decision-16: the admin panel is a static export served by the Node API process on the
 * exe.dev VM. Not Vercel, not Cloudflare Pages. So: no server runtime, no image optimizer,
 * no middleware, no route handlers.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  output: 'export',
  // Emits out/shifts/index.html instead of out/shifts.html, so a dumb static file server
  // can resolve routes by directory without a rewrite table.
  trailingSlash: true,
  images: {
    // No Next image optimizer exists in a static export.
    unoptimized: true,
  },
  reactStrictMode: true,
  poweredByHeader: false,
}

export default nextConfig
