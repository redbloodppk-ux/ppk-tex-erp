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
  // Force the "@/" path alias to resolve in EVERY webpack layer
  // (server, client/'use client', edge). Next.js normally wires this
  // up from tsconfig "paths", but the client-component layer was not
  // picking it up on Vercel — which broke @/ imports inside the
  // 'use client' costing screens (CORR-P4 build failure). Setting the
  // alias explicitly here makes resolution deterministic everywhere.
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': __dirname,
    };
    return config;
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'date-fns'],
  },
  // pdfkit reads its AFM font files from disk at runtime — let Node resolve
  // it from node_modules instead of letting webpack bundle (and break) it.
  serverExternalPackages: ['pdfkit'],
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
