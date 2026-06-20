'use client';
import { useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  LogOut, ChevronDown, Menu, ArrowLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { NotificationBell } from './notification-bell';
import { GlobalSearch } from './global-search';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  mill_manager: 'Mill Manager',
  sales_manager: 'Sales Manager',
  accounts: 'Accounts',
  floor_operator: 'Floor Operator',
  auditor: 'Auditor',
};

export function Topbar({
  fullName,
  role,
  onMenuClick,
}: {
  fullName: string;
  role: string;
  onMenuClick?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();

  // Hide the back button when we're already on the home/dashboard.
  const isHome = pathname === '/app/dashboard' || pathname === '/app';

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    startTransition(() => {
      router.push('/login');
      router.refresh();
    });
  }

  const initials = fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(s => s[0]?.toUpperCase())
    .join('') || 'U';

  return (
    <header className="h-14 bg-paper border-b border-line/60 sticky top-0 z-30 flex items-center px-3 sm:px-6 gap-2 sm:gap-4">
      {/* ── Mobile-only: hamburger opens the sidebar drawer ────────────── */}
      <button
        onClick={onMenuClick}
        className="md:hidden p-2 rounded-lg hover:bg-cloud"
        aria-label="Open menu"
      >
        <Menu className="w-5 h-5 text-ink-soft" />
      </button>

      {/* ── Mobile-only: back button (history) ─────────────────────────── */}
      {!isHome && (
        <button
          onClick={() => router.back()}
          className="md:hidden p-2 rounded-lg hover:bg-cloud"
          aria-label="Go back"
        >
          <ArrowLeft className="w-5 h-5 text-ink-soft" />
        </button>
      )}

      {/* ── Desktop search bar — wired to GlobalSearch component ─────── */}
      <div className="hidden sm:flex items-center gap-2 w-full max-w-md">
        <GlobalSearch />
      </div>

      {/* Spacer pushes the bell + user menu to the far right corner. */}
      <div className="flex-1" />

      <div className="flex items-center gap-1 sm:gap-2">
        {/* Live bell — replaces the static red dot. Polls every 60s
            and opens a dropdown with the top 10 pending items. See
            NotificationBell + lib/notifications/source.ts. */}
        <NotificationBell />

        <div className="relative">
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-cloud"
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo to-violet text-white flex items-center justify-center text-xs font-bold">
              {initials}
            </div>
            <div className="hidden sm:block text-left leading-tight">
              <div className="text-sm font-semibold text-ink">{fullName}</div>
              <div className="text-[10px] uppercase tracking-wider text-ink-mute">{ROLE_LABEL[role] ?? role}</div>
            </div>
            <ChevronDown className={cn('w-4 h-4 text-ink-mute transition-transform hidden sm:block', menuOpen && 'rotate-180')} />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 mt-2 w-56 bg-paper rounded-xl border border-line shadow-card z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-line/60">
                  <div className="text-sm font-semibold text-ink truncate">{fullName}</div>
                  <div className="text-xs text-ink-mute">{ROLE_LABEL[role] ?? role}</div>
                </div>
                <button
                  onClick={signOut}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-ink-soft hover:bg-cloud"
                >
                  <LogOut className="w-4 h-4" />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
