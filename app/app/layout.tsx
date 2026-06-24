import type { Metadata, Viewport } from 'next';
import './globals.css';
import { NumberWheelGuard } from './components/number-wheel-guard';
import { AppleSplashLinks } from './components/apple-splash-links';
import { LaunchSplash } from './components/launch-splash';

export const metadata: Metadata = {
  title: { default: 'PPK TEX ERP', template: '%s · PPK TEX' },
  description: 'Cloud-based ERP for PPK Tex textile weaving — orders, production, costing, attendance.',
  manifest: '/manifest.json',
  applicationName: 'PPK TEX',
  appleWebApp: { capable: true, title: 'PPK TEX', statusBarStyle: 'default' },
  icons: {
    icon: '/icon.svg',
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#6366f1',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <AppleSplashLinks />
        {/* Pre-paint the per-device appearance theme before first paint to
            avoid a colour flash. Reads the same localStorage key as
            lib/theme.ts and sets the CSS vars on <html>. Kept inline + tiny
            and self-contained (no imports) so it can run in <head>. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var raw=localStorage.getItem('ppk_theme_v1');if(!raw)return;var t=JSON.parse(raw);var r=document.documentElement;function lum(h){h=(h||'').trim().replace('#','');if(h.length===3)h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];if(h.length!==6)return 1;return 0.2126*parseInt(h.slice(0,2),16)/255+0.7152*parseInt(h.slice(2,4),16)/255+0.0722*parseInt(h.slice(4,6),16)/255;}function tint(bg,a){return lum(bg)>0.55?'rgba(0,0,0,'+a[0]+')':'rgba(255,255,255,'+a[1]+')';}if(t.sidebarBg){r.style.setProperty('--sidebar-bg',t.sidebarBg);r.style.setProperty('--sidebar-hover',tint(t.sidebarBg,[0.06,0.14]));r.style.setProperty('--sidebar-active',tint(t.sidebarBg,[0.10,0.24]));}if(t.sidebarFg)r.style.setProperty('--sidebar-fg',t.sidebarFg);if(t.topbarBg){r.style.setProperty('--topbar-bg',t.topbarBg);r.style.setProperty('--topbar-hover',tint(t.topbarBg,[0.06,0.14]));}if(t.topbarFg)r.style.setProperty('--topbar-fg',t.topbarFg);if(t.pageBg)r.style.setProperty('--page-bg',t.pageBg);if(t.fontPx){var f=Math.min(20,Math.max(13,Math.round(t.fontPx)));r.style.setProperty('--app-font-size',f+'px');}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="font-body bg-[var(--page-bg)] text-ink">
        <LaunchSplash />
        <NumberWheelGuard />
        {children}
      </body>
    </html>
  );
}
