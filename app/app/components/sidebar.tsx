'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Users, Calculator, PackageCheck, Boxes, ShoppingCart, Receipt,
  Truck, Hammer, ClipboardList, BadgeIndianRupee, Wallet,
  FileBarChart, Bell, Settings, BookCheck,
  Factory, X, Disc3, Layers, Warehouse, Gauge, Calendar, Activity,
  ChevronRight,
} from 'lucide-react';
import { BrandLogo } from './brand-logo';

type Role = 'owner' | 'mill_manager' | 'sales_manager' | 'accounts' | 'floor_operator' | 'auditor';

type GroupKey = 'home' | 'sales' | 'inventory' | 'production' | 'people' | 'finance' | 'insights' | 'admin';
/** Groups that actually render as a labelled, collapsible section.
 *  The 'home' group is rendered flat at the top of the sidebar with
 *  no header / chevron and is intentionally excluded from this set. */
type LabelledGroupKey = Exclude<GroupKey, 'home'>;

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Role[];
  group: GroupKey;
}

/**
 * Sidebar order follows a typical day:
 *  Overview  → check the dashboard
 *  Sales     → quote → order → invoice → collect
 *  Inventory → buy yarn → bobbins → store finished goods → pay vendors
 *  Production→ size warp → weave → outsource/jobwork → resale
 *  People    → master → mark attendance → pay wages
 *  Insights  → reports, alerts, notifications
 *  Admin     → settings + audit (owner/auditor only)
 */
const NAV: NavItem[] = [
  // Dashboard — rendered as a standalone item at the top of the
  // sidebar with no group header (Sales is the first labelled group).
  // Marked with a special group key 'home' that NavBody renders flat.
  { href: '/app/dashboard',     label: 'Dashboard',          icon: LayoutDashboard, group: 'home',       roles: ['owner','mill_manager','sales_manager','accounts','floor_operator','auditor'] },

  // Sales
  // Customers + Jobwork Parties moved into the unified Parties master
  // under Admin. Both old pages still work at their old URLs for any
  // bookmarks / legacy links.
  { href: '/app/costing',         label: 'Fabric Costing',   icon: Calculator,      group: 'sales',      roles: ['owner','mill_manager','sales_manager','auditor'] },
  { href: '/app/orders',            label: 'Sales Orders',     icon: ShoppingCart,    group: 'sales',      roles: ['owner','sales_manager','mill_manager','accounts','auditor'] },
  { href: '/app/delivery-challan',  label: 'Delivery Challan', icon: Truck,           group: 'sales',      roles: ['owner','sales_manager','mill_manager','accounts','auditor'] },
  { href: '/app/invoices',          label: 'Invoices',         icon: Receipt,         group: 'sales',      roles: ['owner','sales_manager','accounts','auditor'] },
  // Unified Payments — records receipts and payments for every party
  // type (customer, supplier, sizing vendor, weaving vendor, etc.)
  // and ships with a Status tab that shows a chronological ledger of
  // inflow / outflow / running balance per party. Old
  // /app/pay-customer and /app/pay-purchase URLs redirect here.
  // Payments lives in the Finance group below — kept off Sales so the
  // sidebar reflects the owner's accounting mental model.

  // Inventory
  // Mills moved into the unified Parties master under Admin (filter by
  // Mill / Yarn Supplier). Old /app/mills route still works for bookmarks.
  // The yarn / porvai / bobbin stock pages were three separate sidebar
  // entries; they now live as TABS inside a single "In-house Stock"
  // page (entry below points at the yarn tab as the default).
  { href: '/app/yarn-stock',         label: 'In-house Stock',     icon: Boxes,           group: 'inventory',  roles: ['owner','mill_manager','accounts','auditor'] },
  { href: '/app/warehouse',          label: 'Warehouse',          icon: Warehouse,       group: 'inventory',  roles: ['owner','mill_manager','accounts','auditor'] },
  // Job Work + Outsource Weaving are about buying weaving services
  // from external parties (with their own stock-in / stock-out
  // tracking), so they belong with inventory & purchases rather than
  // in-house production routing.
  { href: '/app/outsource',          label: 'Outsource Weaving',  icon: Truck,           group: 'inventory',  roles: ['owner','mill_manager','accounts','auditor'] },
  { href: '/app/jobwork',            label: 'Job Work',           icon: Hammer,          group: 'inventory',  roles: ['owner','mill_manager','accounts','auditor'] },

  // Production
  { href: '/app/sizing',        label: 'Sizing Jobs',        icon: Disc3,           group: 'production', roles: ['owner','mill_manager','floor_operator','accounts','auditor'] },
  { href: '/app/pavu',          label: 'Pavu (Sized Beams)', icon: Layers,          group: 'production', roles: ['owner','mill_manager','floor_operator','auditor'] },
  { href: '/app/production',    label: 'Production',         icon: Factory,         group: 'production', roles: ['owner','mill_manager','floor_operator','auditor'] },
  { href: '/app/production/shift-log', label: 'Shift Log',   icon: Gauge,           group: 'production', roles: ['owner','mill_manager','floor_operator','auditor'] },
  { href: '/app/jobwork/fabric-receipt', label: 'Fabric Receipt', icon: PackageCheck, group: 'production', roles: ['owner','mill_manager','accounts','auditor'] },
  // Resale page retired — fabric stock now lives as a tab inside
  // In-house Stock (/app/fabric-stock). Old /app/resale URL redirects.

  // People (HR)
  { href: '/app/employees',     label: 'Employees',          icon: Users,           group: 'people',     roles: ['owner','mill_manager','accounts','auditor'] },
  { href: '/app/attendance',    label: 'Attendance',         icon: ClipboardList,   group: 'people',     roles: ['owner','mill_manager','floor_operator','accounts','auditor'] },
  // Wages, Expenses, Payments, Bank Entries moved into the Finance
  // group below so all money-flow tools sit together.

  // Finance
  // Payments: party-scoped (customer in / vendor out).
  // Wages: weekly payroll, fed into LOOMS Calibration.
  // Expenses: categorised mill expenses.
  // Bank Entries: non-party bank flows (EB, loan EMI, interest,
  //   cash withdrawals) — closes the gap for True Cost + P&L.
  { href: '/app/payments',         label: 'Payments',           icon: Wallet,          group: 'finance',    roles: ['owner','accounts','sales_manager','auditor'] },
  { href: '/app/wages',            label: 'Wages',              icon: BadgeIndianRupee,group: 'finance',    roles: ['owner','accounts','auditor'] },
  { href: '/app/wages/weekly',     label: 'Weekly Summary',     icon: Calendar,        group: 'finance',    roles: ['owner','accounts','auditor'] },
  { href: '/app/expenses',         label: 'Expenses',           icon: Wallet,          group: 'finance',    roles: ['owner','accounts','auditor'] },
  { href: '/app/bank-entries',     label: 'Bank Entries',       icon: BookCheck,       group: 'finance',    roles: ['owner','accounts','auditor'] },

  // Insights
  { href: '/app/reports',       label: 'Reports',            icon: FileBarChart,    group: 'insights',   roles: ['owner','accounts','sales_manager','mill_manager','auditor'] },
  { href: '/app/yarn',          label: 'Yarn Reports',       icon: Boxes,           group: 'insights',   roles: ['owner','mill_manager','accounts','auditor'] },
  { href: '/app/reports/shed-running', label: 'Shed Running', icon: Activity,        group: 'insights',   roles: ['owner','mill_manager','accounts','auditor'] },
  { href: '/app/notifications', label: 'Notifications',      icon: Bell,            group: 'insights',   roles: ['owner','mill_manager','sales_manager','accounts','floor_operator','auditor'] },

  // Admin
  { href: '/app/parties',       label: 'Parties',            icon: Users,           group: 'admin',      roles: ['owner','sales_manager','mill_manager','accounts','auditor'] },
  { href: '/app/ledgers',       label: 'Ledgers',            icon: BookCheck,       group: 'admin',      roles: ['owner','accounts','auditor'] },
  { href: '/app/settings',      label: 'Settings',           icon: Settings,        group: 'admin',      roles: ['owner','auditor'] },
  // Direct shortcut to the LOOMS change history (useful when comparing
  // a margin shift on Profit-by-Quality with a recent calibration
  // edit). Sits next to Settings — still reachable from inside the
  // calibration page header for context.
  { href: '/app/settings/looms-calibration/history', label: 'LOOMS History', icon: BookCheck,       group: 'admin',      roles: ['owner','auditor'] },
  { href: '/app/audit',         label: 'Audit Log',          icon: BookCheck,       group: 'admin',      roles: ['owner','auditor'] },
];

const GROUP_ORDER: readonly LabelledGroupKey[] = [
  'sales', 'inventory', 'production', 'people', 'finance', 'insights', 'admin',
];

const GROUP_LABEL: Record<LabelledGroupKey, string> = {
  sales:      'Sales & Customers',
  inventory:  'Inventory & Purchases',
  production: 'Production',
  people:     'People & HR',
  finance:    'Finance',
  insights:   'Reports & Alerts',
  admin:      'Admin',
};

/** Icon shown next to each group header — gives the eye a fast visual
 *  anchor for scanning down the sidebar, especially useful for the
 *  collapsed groups where there's no other visual cue. */
const GROUP_ICON: Record<LabelledGroupKey, React.ComponentType<{ className?: string }>> = {
  sales:      ShoppingCart,
  inventory:  Boxes,
  production: Factory,
  people:     ClipboardList,
  finance:    Wallet,
  insights:   FileBarChart,
  admin:      Settings,
};

/** localStorage key for per-group open/closed state. Persisted so the
 *  sidebar feels stable across navigation. The group containing the
 *  active route always auto-expands on render regardless of stored
 *  state — that's a render-time override, not a write-back. */
const SIDEBAR_STATE_KEY = 'ppk_sidebar_open_groups_v1';

function loadStoredOpen(): Set<GroupKey> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(SIDEBAR_STATE_KEY);
    if (raw == null) {
      // First visit — open Sales as a sensible default. The active
      // group will also expand below as a render-time override.
      return new Set<GroupKey>(['sales']);
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((g): g is GroupKey => typeof g === 'string') as GroupKey[]);
  } catch {
    return new Set();
  }
}

function NavBody({
  role,
  onItemClick,
}: {
  role: Role;
  onItemClick?: () => void;
}) {
  const pathname = usePathname();
  const visible = NAV.filter(n => n.roles.includes(role));
  // 'home' is special: items with this group key render as flat links
  // at the very top of the sidebar without a group header (Dashboard).
  const flatItems = visible.filter(i => i.group === 'home');
  const grouped = GROUP_ORDER.map(g => ({
    group: g,
    items: visible.filter(i => i.group === g),
  })).filter(g => g.items.length > 0);

  // Track per-group open state. Hydrate from localStorage on mount.
  // On first server render we use an empty set so the SSR markup is
  // deterministic; the client effect overwrites it with the persisted
  // state on first paint.
  const [openGroups, setOpenGroups] = useState<Set<GroupKey>>(new Set());
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setOpenGroups(loadStoredOpen());
    setHydrated(true);
  }, []);

  // Active group = the one whose item matches the current pathname.
  // Always rendered open so the user can see where they are.
  const activeGroup = visible.find(
    (n) => pathname === n.href || pathname.startsWith(n.href + '/'),
  )?.group;

  // Auto-hide: whenever navigation lands in a group, make that group
  // the ONLY open one. Without this, a group opened earlier (persisted
  // in localStorage) stayed expanded alongside the active group's
  // render-time override, so two groups appeared open at once.
  // Manually opening another group to browse still works — it only
  // collapses when you actually navigate to one of its pages (or
  // elsewhere).
  useEffect(() => {
    if (!hydrated || !activeGroup) return;
    setOpenGroups((prev) => {
      if (prev.size === 1 && prev.has(activeGroup)) return prev;
      const next = new Set<GroupKey>([activeGroup]);
      try {
        window.localStorage.setItem(SIDEBAR_STATE_KEY, JSON.stringify([...next]));
      } catch {
        // ignore quota / disabled-storage errors
      }
      return next;
    });
  }, [activeGroup, hydrated]);

  /** Accordion behaviour: opening a group auto-closes every other
   *  group. Clicking an already-open group collapses it (so all
   *  groups can be closed at once). The active group still
   *  auto-expands as a render-time override regardless of stored
   *  state, so navigating into a different group's page won't leave
   *  the operator looking at a sidebar that hides where they are. */
  function toggleGroup(g: LabelledGroupKey): void {
    setOpenGroups((prev) => {
      const next = new Set<GroupKey>();
      if (!prev.has(g)) next.add(g);
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(SIDEBAR_STATE_KEY, JSON.stringify([...next]));
        } catch {
          // ignore quota / disabled-storage errors
        }
      }
      return next;
    });
  }

  /** Click handler for the flat top items (Dashboard). Clears every
   *  open group so the sidebar collapses back to its tidy "home"
   *  state when the operator goes back to the dashboard. */
  function collapseAllGroups(): void {
    setOpenGroups(new Set());
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(SIDEBAR_STATE_KEY, JSON.stringify([]));
      } catch {
        // ignore quota / disabled-storage errors
      }
    }
  }

  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
      {/* Flat top items (Dashboard) — no group header above them. */}
      {flatItems.length > 0 && (
        <ul className="space-y-0.5 mb-2">
          {flatItems.map(item => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => {
                    // Clicking Dashboard collapses every open group so
                    // the sidebar returns to a tidy home state.
                    collapseAllGroups();
                    if (onItemClick) onItemClick();
                  }}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    active
                      ? 'bg-indigo/10 text-indigo'
                      : 'text-ink-soft hover:bg-cloud hover:text-ink'
                  )}
                >
                  <Icon className={cn('w-4 h-4 shrink-0', active ? 'text-indigo' : 'text-ink-mute')} />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {grouped.map(({ group, items }) => {
        // Before hydration: only the active group is open (avoids
        // flash of all groups closed). After hydration: openGroups
        // from localStorage + the active-group override.
        const isOpen = hydrated
          ? (openGroups.has(group) || activeGroup === group)
          : (activeGroup === group);
        const GroupIcon = GROUP_ICON[group];
        return (
          <div key={group}>
            <button
              type="button"
              onClick={() => toggleGroup(group)}
              className={cn(
                'w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md',
                'text-sm font-semibold text-ink-soft',
                'hover:bg-cloud/60 hover:text-ink transition-colors',
              )}
              aria-expanded={isOpen}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <GroupIcon className="w-4 h-4 shrink-0 text-ink-mute" />
                <span className="truncate">{GROUP_LABEL[group]}</span>
              </span>
              <ChevronRight
                className={cn(
                  'w-4 h-4 shrink-0 text-ink-mute transition-transform duration-150',
                  isOpen ? 'rotate-90' : 'rotate-0',
                )}
              />
            </button>
            {isOpen && (
              <ul className="mt-1 mb-2 space-y-0.5 pl-2 border-l border-line/40 ml-3">
                {items.map(item => {
                  const active = pathname === item.href || pathname.startsWith(item.href + '/');
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onItemClick}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                          active
                            ? 'bg-indigo/10 text-indigo'
                            : 'text-ink-soft hover:bg-cloud hover:text-ink'
                        )}
                      >
                        <Icon className={cn('w-4 h-4 shrink-0', active ? 'text-indigo' : 'text-ink-mute')} />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function Brand({ onClick }: { onClick?: () => void }) {
  return (
    <Link
      href="/app/dashboard"
      onClick={onClick}
      className="px-5 py-5 border-b border-line/60 flex items-center gap-3 hover:bg-cloud/40 transition-colors"
      title="Go to dashboard"
    >
      <BrandLogo variant="mark" height={36} />
      <div>
        <div className="font-display font-extrabold text-ink leading-tight text-sm tracking-wider">PPK TEX</div>
        <div className="text-[10px] uppercase tracking-wider text-ink-mute">Cloud ERP</div>
      </div>
    </Link>
  );
}

function Footer() {
  return (
    <div className="px-4 py-3 border-t border-line/60 text-[10px] text-ink-mute">
      v0.1 - {new Date().getFullYear()} PPK Tex Industries
    </div>
  );
}

export function Sidebar({
  role,
  mobileOpen = false,
  onClose,
}: {
  role: Role;
  mobileOpen?: boolean;
  onClose?: () => void;
}) {
  return (
    <>
      {/* Desktop sidebar (md and up) */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col bg-paper border-r border-line/60 sticky top-0 h-screen">
        <Brand />
        <NavBody role={role} />
        <Footer />
      </aside>

      {/* Mobile drawer (below md) */}
      <div
        className={cn(
          'md:hidden fixed inset-0 z-50 transition-opacity duration-200',
          mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
        aria-hidden={!mobileOpen}
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* Sliding panel */}
        <aside
          className={cn(
            'absolute left-0 top-0 h-full w-72 max-w-[85%] bg-paper border-r border-line/60',
            'flex flex-col shadow-xl transition-transform duration-200',
            mobileOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="flex items-stretch border-b border-line/60">
            <Link
              href="/app/dashboard"
              onClick={onClose}
              className="flex-1 px-5 py-5 flex items-center gap-3 hover:bg-cloud/40 transition-colors"
              title="Go to dashboard"
            >
              <BrandLogo variant="mark" height={36} />
              <div className="flex-1">
                <div className="font-display font-extrabold text-ink leading-tight text-sm tracking-wider">PPK TEX</div>
                <div className="text-[10px] uppercase tracking-wider text-ink-mute">Cloud ERP</div>
              </div>
            </Link>
            <button
              onClick={onClose}
              className="px-3 hover:bg-cloud"
              aria-label="Close menu"
            >
              <X className="w-5 h-5 text-ink-soft" />
            </button>
          </div>
          <NavBody role={role} onItemClick={onClose} />
          <Footer />
        </aside>
      </div>
    </>
  );
}
