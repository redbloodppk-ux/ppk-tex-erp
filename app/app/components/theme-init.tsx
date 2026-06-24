'use client';

/**
 * ThemeInit — applies the per-device saved appearance on mount.
 *
 * The root layout already runs a tiny inline script before paint to avoid a
 * colour flash, but that script only runs on a full page load. This component
 * re-applies the saved theme on client-side navigations / hydration so the
 * look stays consistent. Renders nothing.
 */
import { useEffect } from 'react';
import { applyTheme, loadTheme } from '@/lib/theme';

export function ThemeInit() {
  useEffect(() => {
    applyTheme(loadTheme());
  }, []);
  return null;
}
