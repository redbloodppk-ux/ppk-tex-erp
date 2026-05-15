import type { Config } from 'tailwindcss';

// Design tokens ported from /css/design-system.css used in the prototypes.
// Same look-and-feel: glassmorphism + neumorphism, indigo→violet→gold palette,
// Plus Jakarta Sans / Inter / JetBrains Mono.

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand palette (matches prototypes exactly)
        ink: {
          DEFAULT: '#0f172a',     // primary text
          soft: '#475569',
          mute: '#94a3b8',
        },
        paper: '#ffffff',
        haze: '#f8fafc',
        cloud: '#f1f5f9',
        line: '#e2e8f0',
        // Brand
        indigo: {
          DEFAULT: '#6366f1',
          50: '#eef2ff', 100: '#e0e7ff', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca',
        },
        violet: {
          DEFAULT: '#8b5cf6',
          50: '#f5f3ff', 100: '#ede9fe', 500: '#8b5cf6', 600: '#7c3aed', 700: '#6d28d9',
        },
        gold: {
          DEFAULT: '#f59e0b',
          50: '#fffbeb', 100: '#fef3c7', 500: '#f59e0b', 600: '#d97706', 700: '#b45309',
        },
        // Module-specific themes
        teal:    { 500: '#14b8a6', 600: '#0d9488' }, // attendance
        emerald: { 500: '#10b981', 600: '#059669' }, // fabric
        rose:    { 500: '#f43f5e', 600: '#e11d48' }, // customer
        cyan:    { 500: '#06b6d4', 600: '#0891b2' }, // count
        slate:   { 500: '#64748b', 600: '#475569' }, // settings/reports
        // Status
        ok:    '#10b981',
        warn:  '#f59e0b',
        err:   '#ef4444',
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        body:    ['Inter', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        sm: '6px',
        DEFAULT: '12px',
        lg: '20px',
        xl: '28px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,0.04), 0 8px 24px rgba(15,23,42,0.06)',
        emboss: 'inset 0 -2px 0 rgba(15,23,42,0.06), 0 1px 0 rgba(255,255,255,0.8)',
        drawer: '-16px 0 64px rgba(15,23,42,0.18)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #f59e0b 100%)',
        'glass': 'linear-gradient(180deg, rgba(255,255,255,0.7), rgba(255,255,255,0.4))',
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
  ],
};

export default config;
