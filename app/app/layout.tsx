import type { Metadata, Viewport } from 'next';
import './globals.css';
import { NumberWheelGuard } from './components/number-wheel-guard';
import { AppleSplashLinks } from './components/apple-splash-links';

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
      </head>
      <body className="font-body bg-haze text-ink">
        <NumberWheelGuard />
        {children}
      </body>
    </html>
  );
}
