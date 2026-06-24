/**
 * Per-device appearance theme.
 *
 * Lets each user recolour the sidebar, top bar and page background and
 * resize all app text, saved in this browser only (localStorage). No
 * database involved — every device keeps its own look.
 *
 * The colours are applied as CSS custom properties on <html>, which the
 * sidebar / topbar / app-shell read. Hover and active "tint" overlays are
 * derived automatically from each background's brightness, so a light or a
 * dark colour both stay legible without the user picking those too.
 */

export interface ThemeConfig {
  /** Sidebar / mobile menu background. */
  sidebarBg: string;
  /** Sidebar text + icon colour. */
  sidebarFg: string;
  /** Top bar background. */
  topbarBg: string;
  /** Top bar text + icon colour. */
  topbarFg: string;
  /** Page (content area) background. */
  pageBg: string;
  /** Whole-app root font size in pixels (16 = default). */
  fontPx: number;
}

/** Factory default — indigo rail + white text look. */
export const DEFAULT_THEME: ThemeConfig = {
  sidebarBg: '#6366f1',
  sidebarFg: '#ffffff',
  topbarBg: '#ffffff',
  topbarFg: '#0f172a',
  pageBg: '#f8fafc',
  fontPx: 16,
};

export interface ThemePreset {
  id: string;
  name: string;
  theme: ThemeConfig;
}

/** One-tap palettes. The first one is the factory default. */
export const THEME_PRESETS: ReadonlyArray<ThemePreset> = [
  {
    id: 'indigo-white',
    name: 'Indigo & White',
    theme: { ...DEFAULT_THEME },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    theme: {
      sidebarBg: '#0f172a',
      sidebarFg: '#e2e8f0',
      topbarBg: '#1e293b',
      topbarFg: '#f8fafc',
      pageBg: '#0b1220',
      fontPx: 16,
    },
  },
  {
    id: 'clean-light',
    name: 'Clean Light',
    theme: {
      sidebarBg: '#ffffff',
      sidebarFg: '#0f172a',
      topbarBg: '#ffffff',
      topbarFg: '#0f172a',
      pageBg: '#f1f5f9',
      fontPx: 16,
    },
  },
  {
    id: 'teal',
    name: 'Teal',
    theme: {
      sidebarBg: '#0d9488',
      sidebarFg: '#ffffff',
      topbarBg: '#ffffff',
      topbarFg: '#0f172a',
      pageBg: '#f0fdfa',
      fontPx: 16,
    },
  },
  {
    id: 'rose',
    name: 'Rose',
    theme: {
      sidebarBg: '#9f1239',
      sidebarFg: '#ffe4e6',
      topbarBg: '#fff1f2',
      topbarFg: '#0f172a',
      pageBg: '#fff7f8',
      fontPx: 16,
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    theme: {
      sidebarBg: '#14532d',
      sidebarFg: '#fde68a',
      topbarBg: '#ffffff',
      topbarFg: '#0f172a',
      pageBg: '#f7fee7',
      fontPx: 16,
    },
  },
];

export const THEME_STORAGE_KEY = 'ppk_theme_v1';

/** Smallest / largest root font the slider allows. */
export const FONT_MIN = 13;
export const FONT_MAX = 20;

/** Relative luminance (0 dark … 1 light) of a #rrggbb / #rgb colour. */
function luminance(hex: string): number {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (h.length !== 6) return 1; // unknown → treat as light
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  // Perceptual weighting (sRGB approximation, good enough for tinting).
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Hover + active overlay tints for a given background colour. Light
 *  backgrounds get a subtle black tint; dark ones a subtle white tint. */
function tints(bg: string): { hover: string; active: string } {
  const light = luminance(bg) > 0.55;
  return light
    ? { hover: 'rgba(0,0,0,0.06)', active: 'rgba(0,0,0,0.10)' }
    : { hover: 'rgba(255,255,255,0.14)', active: 'rgba(255,255,255,0.24)' };
}

function clampFont(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_THEME.fontPx;
  return Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(px)));
}

/** Apply a theme to the document by setting CSS variables on <html>. */
export function applyTheme(t: ThemeConfig): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const sb = tints(t.sidebarBg);
  const tb = tints(t.topbarBg);
  root.style.setProperty('--sidebar-bg', t.sidebarBg);
  root.style.setProperty('--sidebar-fg', t.sidebarFg);
  root.style.setProperty('--sidebar-hover', sb.hover);
  root.style.setProperty('--sidebar-active', sb.active);
  root.style.setProperty('--topbar-bg', t.topbarBg);
  root.style.setProperty('--topbar-fg', t.topbarFg);
  root.style.setProperty('--topbar-hover', tb.hover);
  root.style.setProperty('--page-bg', t.pageBg);
  root.style.setProperty('--app-font-size', `${clampFont(t.fontPx)}px`);
}

/** Read the saved theme, falling back to defaults for any missing field. */
export function loadTheme(): ThemeConfig {
  if (typeof window === 'undefined') return { ...DEFAULT_THEME };
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_THEME };
    const parsed = JSON.parse(raw) as Partial<ThemeConfig>;
    return {
      sidebarBg: parsed.sidebarBg ?? DEFAULT_THEME.sidebarBg,
      sidebarFg: parsed.sidebarFg ?? DEFAULT_THEME.sidebarFg,
      topbarBg: parsed.topbarBg ?? DEFAULT_THEME.topbarBg,
      topbarFg: parsed.topbarFg ?? DEFAULT_THEME.topbarFg,
      pageBg: parsed.pageBg ?? DEFAULT_THEME.pageBg,
      fontPx: clampFont(Number(parsed.fontPx ?? DEFAULT_THEME.fontPx)),
    };
  } catch {
    return { ...DEFAULT_THEME };
  }
}

/** Persist + apply a theme in one call. */
export function saveTheme(t: ThemeConfig): void {
  if (typeof window === 'undefined') return;
  const clean: ThemeConfig = { ...t, fontPx: clampFont(t.fontPx) };
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // ignore quota / disabled-storage errors
  }
  applyTheme(clean);
}
