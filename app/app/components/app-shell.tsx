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
import { cn } from '@/lib/utils';
import { SidebarDesktop, SidebarMobile } from './sidebar';
import { Topbar } from './topbar';
import { OfflineSync } from './offline-sync';
import { OfflineBanner } from './offline-banner';
import { UpdatePrompt } from './update-prompt';
import { InstallPrompt } from './install-prompt';
import { EnterNav } from './enter-nav';

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
    // overflow-x-hidden on mobile clips the page as it slides aside; reset
    // to visible at md+ so the desktop sticky sidebar keeps working.
    <div className="min-h-screen bg-haze relative overflow-x-hidden md:overflow-x-visible">
      {/* Mobile push-menu lives at the root (NOT inside the page surface)
          so the surface's transform doesn't scale the fixed drawer. */}
      <SidebarMobile
        role={role}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />
      {/* Page surface. On mobile, opening the menu pushes + scales this whole
          surface aside (transform-origin center) to reveal the indigo menu
          fixed behind it — the iOS "slide menu" effect. md+ is untouched.
          Desktop layout = full-width Top bar on top, then a row of the
          sidebar + main content below it. */}
      <div
        className={cn(
          // relative z-10 keeps this surface painted ABOVE the fixed indigo
          // push-menu (z-0) so the menu only shows once the page slides aside.
          'relative z-10 flex flex-col min-h-screen min-w-0 bg-haze',
          'transition-transform duration-300 ease-out will-change-transform',
          'md:transform-none md:transition-none',
          mobileOpen
            ? 'scale-[0.82] translate-x-[72%] rounded-3xl overflow-hidden shadow-2xl'
            : '',
        )}
        style={{ transformOrigin: 'center' }}
      >
        <UpdatePrompt />
        <OfflineBanner />
        {/* Full-width top bar — spans margin to margin, above the sidebar. */}
        <Topbar
          fullName={fullName}
          role={role}
          onMenuClick={() => setMobileOpen(true)}
        />
        {/* Row: desktop sidebar (left) + page content (right). */}
        <div className="flex flex-1 min-h-0">
          <SidebarDesktop role={role} />
          <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 overflow-x-hidden min-w-0">
            {children}
          </main>
        </div>
        {/* While the menu is open the whole pushed-aside page becomes a
            tap-to-close target (mobile only). */}
        {mobileOpen && (
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="md:hidden absolute inset-0 z-50"
          />
        )}
      </div>
      {/* OfflineSync renders the bottom-right "pending sync" pill;
          InstallPrompt renders the bottom-left "Install PPK TEX" pill.
          They live outside the main flow so they overlay every page. */}
      <OfflineSync />
      <InstallPrompt />
      {/* Global "Enter moves to the next field" handler. Renders nothing
          — just attaches a document-level keydown listener. */}
      <EnterNav />
    </div>
  );
}
