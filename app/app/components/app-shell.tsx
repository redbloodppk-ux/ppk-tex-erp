'use client';
/**
 * AppShell — client wrapper around Sidebar + Topbar + main content.
 *
 * Owns the mobile-drawer state so both components stay in sync without a
 * full-blown context. On mobile the Sidebar is rendered as an overlay drawer
 * that opens when the Topbar hamburger is tapped (and closes on backdrop tap
 * or route change). On md+ screens it just renders the static sidebar.
 */
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { OfflineSync } from './offline-sync';
import { OfflineBanner } from './offline-banner';
import { UpdatePrompt } from './update-prompt';

type Role = 'owner' | 'mill_manager' | 'sales_manager' | 'accounts' | 'floor_operator' | 'auditor';

export function AppShell({
  role,
  fullName,
  children,
}: {
  role: Role;
  fullName: string;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Auto-close the drawer whenever the route changes — otherwise after the
  // user picks a nav item the drawer would stay open on top of the new page.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock body scroll while the drawer is open so the backdrop feels solid.
  useEffect(() => {
    if (mobileOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [mobileOpen]);

  // Print routes (e.g. /app/delivery-challan/123/print) render their own
  // standalone A4 layout — bypass the sidebar / topbar chrome entirely so
  // the printed page is just the document. Auth + role checks in the
  // parent layout still apply.
  if (pathname.endsWith('/print') || pathname.includes('/print/')) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen flex bg-haze">
      <Sidebar
        role={role}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <UpdatePrompt />
        <OfflineBanner />
        <Topbar
          fullName={fullName}
          role={role}
          onMenuClick={() => setMobileOpen(true)}
        />
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
