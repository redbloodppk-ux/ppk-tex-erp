import withPWAInit from 'next-pwa';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const withPWA = withPWAInit({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  // Cache the 5 offline-critical screens (per Master Spec v3.0 §2.5)
  runtimeCaching: [
    {
      urlPattern: /^\/(?:wages|pay-customer|pay-purchase|costing-calc|attendance)(?:\/.*)?$/,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'ppktex-offline-pages',
        expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 7 },
      },
    },
    {
      urlPattern: /\/_next\/(?:static|image)\/.+/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'ppktex-next-assets',
        expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
      },
    },
  ],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Pin the workspace root so Next.js stops picking up the stray
  // package-lock.json in C:\Users\Admin\ on Windows.
  outputFileTracingRoot: __dirname,
  experimental: {
    optimizePackageImports: ['lucide-react', 'date-fns'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
  // ─── Build hardening (CORR-F1) ──────────────────────────────────────────
  // Per Correction Guide v1.1 R1: TypeScript strict mode must NEVER be
  // bypassed. Run `npm run typegen` to populate lib/database.types.ts from
  // the live Supabase project before building, so Supabase queries get
  // proper types and the build succeeds.
  typescript: { ignoreBuildErrors: false },
  eslint:     { ignoreDuringBuilds: false },
};

export default withPWA(nextConfig);
