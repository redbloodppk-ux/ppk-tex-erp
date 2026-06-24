'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Users, Calculator, PackageCheck, Boxes, ShoppingCart, Receipt,
  Truck, Hammer, ClipboardList, BadgeIndianRupee, Wallet,
  FileBarChart, Bell, Settings, BookCheck,
  Factory, Disc3, Layers, Warehouse, Gauge, Calendar, Activity,
  ChevronRight, FileText, Info, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import { BrandLogo } from './brand-logo';

type Role = 'owner' | 'mill_manager' | 'sales_manager' | 'accounts' | 'floor_operator' | 'auditor';

type GroupKey = 'home' | 'sales' | 'inventory' | 'production' | 'people' | 'finance' | 'insights' | 'admin' | 'bottom';
/** Groups that actually render as a labelled, collapsible section.
 *  The 'home' group is rendered flat at the top of the sidebar and the
 *  'bottom' group is pinned flat at the very bottom (Settings) — both
 *  have no header / chevron and are intentionally excluded from this set. */
type LabelledGroupKey = Exclude<GroupKey, 'home' | 'bottom'>;

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
  // General Purchase GST bills — catch-all supplier bills (packing,
  // spares, consumables, services) that feed the Purchase Register.
  { href: '/app/general-purchases', label: 'General Purchases',icon: FileText,        group: 'sales',      roles: ['owner','sales_manager','accounts','auditor'] },
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
  { href: '/app/bonus',            label: 'Bonus',              icon: BadgeIndianRupee,group: 'finance',    roles: ['owner','accounts','auditor'] },
  { href: '/app/expenses',         label: 'Expenses',           icon: Wallet,          group: 'finance',    roles: ['owner','accounts','auditor'] },
  { href: '/app/bank-entries',     label: 'Bank Entries',       icon: BookCheck,       group: 'finance',    roles: ['owner','accounts','auditor'] },

  // Insights
  { href: '/app/reports',       label: 'Reports',            icon: FileBarChart,    group: 'insights',   roles: ['owner','accounts','sales_manager','mill_manager','auditor'] },
  { href: '/app/yarn',          label: 'Yarn Reports',       icon: Boxes,           group: 'insights',   roles: ['owner','mill_manager','accounts','auditor'] },
  { href: '/app/reports/shed-running', label: 'Shed Running', icon: Activity,        group: 'insights',   roles: ['owner','mill_manager','accounts','auditor'] },
  // Direct shortcut to the LOOMS change history (useful when comparing
  // a margin shift on Profit-by-Quality with a recent calibration
  // edit). Lives in Reports & Alerts because it's analytical / audit
  // viewing, not configuration — still reachable from inside the
  // calibration page header for context.
  { href: '/app/settings/looms-calibration/history', label: 'LOOMS History', icon: BookCheck,       group: 'insights',   roles: ['owner','auditor'] },
  { href: '/app/notifications', label: 'Notifications',      icon: Bell,            group: 'insights',   roles: ['owner','mill_manager','sales_manager','accounts','floor_operator','auditor'] },

  // Admin
  { href: '/app/parties',       label: 'Parties',            icon: Users,           group: 'admin',      roles: ['owner','sales_manager','mill_manager','accounts','auditor'] },
  { href: '/app/ledgers',       label: 'Ledgers',            icon: BookCheck,       group: 'admin',      roles: ['owner','accounts','auditor'] },
  { href: '/app/audit',         label: 'Audit Log',          icon: BookCheck,       group: 'admin',      roles: ['owner','auditor'] },

  // Bottom — pinned flat at the very bottom of the sidebar (no group
  // header), separated from the scrollable groups above. Settings sits
  // here so it's always reachable without hunting through Admin.
  { href: '/app/settings',      label: 'Settings',           icon: Settings,        group: 'bottom',     roles: ['owner','auditor'] },
  { href: '/app/about',         label: 'About',              icon: Info,            group: 'bottom',     roles: ['owner','mill_manager','sales_manager','accounts','floor_operator','auditor'] },
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
  // Colour + background come from the theme: this nav sits inside the mobile
  // menu (SidebarMobile), which sets --sidebar-bg / --sidebar-fg on its
  // container, so text + icons inherit and items only need tint overlays.
  const itemBase = 'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors';
  const itemActive = 'bg-[var(--sidebar-active)]';
  const itemIdle = 'hover:bg-[var(--sidebar-hover)]';
  const iconActiveCls = '';
  const iconIdleCls = '';
  const groupBtnCls = 'hover:bg-[var(--sidebar-hover)]';
  const groupIconCls = '';
  const chevronCls = 'opacity-70';
  const groupBorderCls = 'border-[color:var(--sidebar-hover)]';
  const bottomBorderCls = 'border-[color:var(--sidebar-hover)]';
  const visible = NAV.filter(n => n.roles.includes(role));
  // 'home' is special: items with this group key render as flat links
  // at the very top of the sidebar without a group header (Dashboard).
  const flatItems = visible.filter(i => i.group === 'home');
  // Pinned flat at the very bottom of the sidebar (About). Settings now
  // lives in the topbar's right corner, so it's excluded here.
  const bottomItems = visible.filter(i => i.group === 'bottom' && i.href !== '/app/settings');
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
  // Transient: the group the mouse is currently over. Hovering a group
  // header auto-expands its sub-items; moving away auto-collapses it.
  // Never persisted.
  const [hoveredGroup, setHoveredGroup] = useState<LabelledGroupKey | null>(null);
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
    // Three-part column: a pinned top (Dashboard), a scrollable middle
    // (the labelled groups) and a pinned bottom (Settings). Only the
    // middle scrolls, so Dashboard and Settings stay put no matter how
    // many groups are expanded. min-h-0 lets the middle actually shrink
    // and scroll inside the flex column.
    <div className="flex-1 flex flex-col min-h-0">
      {/* Pinned flat top items (Dashboard) — never scroll away. */}
      {flatItems.length > 0 && (
        <ul className="space-y-0.5 px-3 pt-4 pb-2 shrink-0">
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
                  className={cn(itemBase, active ? itemActive : itemIdle)}
                >
                  <Icon className={cn('w-4 h-4 shrink-0', active ? iconActiveCls : iconIdleCls)} />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {/* Scrollable middle — only the groups scroll. */}
      <nav className="flex-1 overflow-y-auto px-3 space-y-1 min-h-0">
      {grouped.map(({ group, items }) => {
        // Before hydration: only the active group is open (avoids
        // flash of all groups closed). After hydration: openGroups
        // from localStorage + the active-group override.
        const isOpen = hydrated
          ? (openGroups.has(group) || activeGroup === group || hoveredGroup === group)
          : (activeGroup === group || hoveredGroup === group);
        const GroupIcon = GROUP_ICON[group];
        return (
          <div
            key={group}
            onMouseEnter={() => setHoveredGroup(group)}
            onMouseLeave={() => setHoveredGroup((g) => (g === group ? null : g))}
          >
            <button
              type="button"
              onClick={() => toggleGroup(group)}
              className={cn(
                'w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md',
                'text-sm font-semibold transition-colors',
                groupBtnCls,
              )}
              aria-expanded={isOpen}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <GroupIcon className={cn('w-4 h-4 shrink-0', groupIconCls)} />
                <span className="truncate">{GROUP_LABEL[group]}</span>
              </span>
              <ChevronRight
                className={cn(
                  'w-4 h-4 shrink-0 transition-transform duration-300 ease-out',
                  chevronCls,
                  isOpen ? 'rotate-90' : 'rotate-0',
                )}
              />
            </button>
            {/* Smooth slow expand/collapse: the grid wrapper animates its
                row height from 0fr → 1fr; the inner overflow-hidden div clips
                the menu while it slides open. */}
            <div
              className={cn(
                'grid transition-[grid-template-rows] duration-300 ease-out',
                isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
              )}
            >
              <div className="overflow-hidden">
                <ul className={cn('mt-1 mb-2 space-y-0.5 pl-2 border-l ml-3', groupBorderCls)}>
                  {items.map(item => {
                    const active = pathname === item.href || pathname.startsWith(item.href + '/');
                    const Icon = item.icon;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={onItemClick}
                          className={cn(itemBase, active ? itemActive : itemIdle)}
                        >
                          <Icon className={cn('w-4 h-4 shrink-0', active ? iconActiveCls : iconIdleCls)} />
                          <span className="truncate">{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </div>
        );
      })}
      </nav>

      {/* Bottom pinned items (Settings) — always visible at the very
          bottom of the sidebar, below the scrollable groups, with a
          divider above. Sits outside the scroll area so it never
          scrolls away. */}
      {bottomItems.length > 0 && (
        <ul className={cn('space-y-0.5 px-3 pt-3 pb-4 shrink-0 border-t', bottomBorderCls)}>
          {bottomItems.map(item => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onItemClick}
                  className={cn(itemBase, active ? itemActive : itemIdle)}
                >
                  <Icon className={cn('w-4 h-4 shrink-0', active ? iconActiveCls : iconIdleCls)} />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Fly-out submenu panel. Rendered through a portal onto document.body so
 * it escapes the sidebar's clipping/scroll and floats over the page,
 * anchored to the right edge of the hovered group row. Always a bright,
 * high-contrast paper card for easy reading, whatever the rail colour.
 */
function Flyout({
  group,
  items,
  anchor,
  pathname,
  onEnter,
  onLeave,
  onNavigate,
}: {
  group: LabelledGroupKey;
  items: ReadonlyArray<NavItem>;
  anchor: DOMRect;
  pathname: string;
  onEnter: () => void;
  onLeave: () => void;
  onNavigate: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Vertically clamp the panel so a low group's menu never spills past
  // the bottom of the screen. Measured after layout, before paint.
  const [top, setTop] = useState<number>(anchor.top);
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    let t = anchor.top - 8;
    const maxTop = window.innerHeight - h - 8;
    if (t > maxTop) t = maxTop;
    if (t < 8) t = 8;
    setTop(t);
  }, [anchor, items.length]);

  return (
    <div
      ref={ref}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        position: 'fixed',
        top,
        left: anchor.right + 6,
        backgroundColor: 'var(--sidebar-bg)',
        color: 'var(--sidebar-fg)',
      }}
      className="z-[60] w-60 rounded-xl border border-[color:var(--sidebar-hover)] shadow-2xl py-2"
      role="menu"
    >
      <div className="px-3 pb-2 mb-1 text-[11px] font-bold uppercase tracking-wide opacity-80 border-b border-[color:var(--sidebar-hover)]">
        {GROUP_LABEL[group]}
      </div>
      <ul className="px-1.5 space-y-0.5">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                role="menuitem"
                onClick={onNavigate}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold transition-colors',
                  active ? 'bg-[var(--sidebar-active)]' : 'hover:bg-[var(--sidebar-hover)]',
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Desktop nav with hover fly-out submenus. Replaces the old inline
 * accordion: each group is a single row (icon + label when pinned open,
 * just an icon when collapsed). Hovering a group pops its pages OUT to
 * the right in a floating panel instead of pushing the rows below down.
 * Works in both desktop states; mobile keeps the accordion (NavBody).
 */
function DesktopNav({ role, collapsed }: { role: Role; collapsed: boolean }) {
  const pathname = usePathname();
  const visible = NAV.filter((n) => n.roles.includes(role));
  const flatItems = visible.filter((i) => i.group === 'home');
  const bottomItems = visible.filter((i) => i.group === 'bottom' && i.href !== '/app/settings');
  const grouped = GROUP_ORDER
    .map((g) => ({ group: g, items: visible.filter((i) => i.group === g) }))
    .filter((g) => g.items.length > 0);

  const activeGroup = visible.find(
    (n) => pathname === n.href || pathname.startsWith(n.href + '/'),
  )?.group;

  const [open, setOpen] = useState<LabelledGroupKey | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const closeTimer = useRef<number | null>(null);
  // Portals need the DOM; gate on mount so SSR markup stays clean.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const cancelClose = (): void => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  // Small delay before closing so the mouse can cross the gap between
  // the group row and the fly-out panel without it vanishing.
  const scheduleClose = (): void => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      setOpen(null);
      setAnchor(null);
    }, 160);
  };
  const openFlyout = (g: LabelledGroupKey, el: HTMLElement): void => {
    cancelClose();
    setOpen(g);
    setAnchor(el.getBoundingClientRect());
  };
  const closeNow = (): void => {
    cancelClose();
    setOpen(null);
    setAnchor(null);
  };

  // Colour comes from the theme: text + icons inherit --sidebar-fg from the
  // panel (set on the SidebarDesktop container), so items only need hover /
  // active background tints, which are derived from --sidebar-bg brightness.
  const idleItem = 'hover:bg-[var(--sidebar-hover)]';
  const activeItem = 'bg-[var(--sidebar-active)]';
  const idleIcon = '';
  const activeIcon = '';

  const renderFlat = (item: NavItem) => {
    const active = pathname === item.href || pathname.startsWith(item.href + '/');
    const Icon = item.icon;
    if (collapsed) {
      return (
        <li key={item.href}>
          <Link
            href={item.href}
            title={item.label}
            aria-label={item.label}
            className={cn(
              'flex items-center justify-center h-10 w-10 mx-auto rounded-lg transition-colors',
              active ? activeItem : idleItem,
            )}
          >
            <Icon className={cn('w-5 h-5 shrink-0', active ? activeIcon : idleIcon)} />
          </Link>
        </li>
      );
    }
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          className={cn(
            'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold transition-colors',
            active ? activeItem : idleItem,
          )}
        >
          <Icon className={cn('w-4 h-4 shrink-0', active ? activeIcon : idleIcon)} />
          <span className="truncate">{item.label}</span>
        </Link>
      </li>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {flatItems.length > 0 && (
        <ul className={cn('shrink-0', collapsed ? 'space-y-1 px-2 pt-4 pb-2' : 'space-y-0.5 px-3 pt-4 pb-2')}>
          {flatItems.map(renderFlat)}
        </ul>
      )}

      {/* Group rows. Hovering one opens its fly-out; the nav still scrolls
          if there are more groups than fit, and scrolling closes any
          open panel so it can't float detached from its row. */}
      <nav
        onScroll={closeNow}
        className={cn('flex-1 overflow-y-auto min-h-0', collapsed ? 'px-2 space-y-1' : 'px-3 space-y-0.5')}
      >
        {grouped.map(({ group }) => {
          const GroupIcon = GROUP_ICON[group];
          const highlight = activeGroup === group || open === group;
          return (
            <button
              key={group}
              type="button"
              title={collapsed ? GROUP_LABEL[group] : undefined}
              onMouseEnter={(e) => openFlyout(group, e.currentTarget)}
              onMouseLeave={scheduleClose}
              onClick={(e) => (open === group ? closeNow() : openFlyout(group, e.currentTarget))}
              aria-haspopup="menu"
              aria-expanded={open === group}
              className={cn(
                'w-full transition-colors',
                collapsed
                  ? cn('flex items-center justify-center h-10 w-10 mx-auto rounded-lg', highlight ? activeItem : idleItem)
                  : cn('flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm font-semibold', highlight ? activeItem : idleItem),
              )}
            >
              {collapsed ? (
                <GroupIcon className={cn('w-5 h-5 shrink-0', highlight ? activeIcon : idleIcon)} />
              ) : (
                <>
                  <span className="flex items-center gap-2.5 min-w-0">
                    <GroupIcon className={cn('w-4 h-4 shrink-0', highlight ? activeIcon : idleIcon)} />
                    <span className="truncate">{GROUP_LABEL[group]}</span>
                  </span>
                  <ChevronRight className="w-4 h-4 shrink-0 opacity-70" />
                </>
              )}
            </button>
          );
        })}
      </nav>

      {bottomItems.length > 0 && (
        <ul
          className={cn(
            'shrink-0 border-t border-[color:var(--sidebar-hover)]',
            collapsed ? 'space-y-1 px-2 pt-3 pb-4' : 'space-y-0.5 px-3 pt-3 pb-4',
          )}
        >
          {bottomItems.map(renderFlat)}
        </ul>
      )}

      {mounted && open !== null && anchor !== null && createPortal(
        <Flyout
          group={open}
          items={grouped.find((x) => x.group === open)?.items ?? []}
          anchor={anchor}
          pathname={pathname}
          onEnter={cancelClose}
          onLeave={scheduleClose}
          onNavigate={closeNow}
        />,
        document.body,
      )}
    </div>
  );
}

/** Slim header row holding only the collapse / expand toggle. The brand
 *  logo + title now live in the top bar (always visible, never collapses),
 *  so the sidebar header is just this control. */
function CollapseToggle({
  expanded,
  collapsed,
  onToggle,
}: {
  /** Whether the full-width layout is currently shown (pinned open OR hover-expanded). */
  expanded: boolean;
  /** The persisted collapsed state — drives the toggle icon + colour. */
  collapsed: boolean;
  onToggle: () => void;
}) {
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <div
      className={cn(
        'h-12 flex items-center shrink-0 border-b border-[color:var(--sidebar-hover)]',
        expanded ? 'justify-end px-3' : 'justify-center',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        title={collapsed ? 'Keep sidebar open' : 'Collapse sidebar'}
        aria-label={collapsed ? 'Keep sidebar open' : 'Collapse sidebar'}
        className={cn(
          'p-1.5 rounded-lg transition-all opacity-80 hover:opacity-100',
          'hover:bg-[var(--sidebar-hover)]',
        )}
      >
        <ToggleIcon className="w-5 h-5" />
      </button>
    </div>
  );
}

function Footer() {
  return (
    <div className="px-4 py-3 border-t border-[color:var(--sidebar-hover)] text-[10px] opacity-60">
      v0.1 - {new Date().getFullYear()} PPK Tex Industries
    </div>
  );
}

/** localStorage key for the desktop collapsed/expanded preference. */
const SIDEBAR_COLLAPSED_KEY = 'ppk_sidebar_collapsed_v1';

/**
 * Desktop sidebar (md and up). Sits BELOW the full-width top bar, so its
 * sticky panel starts at top-14 (the top bar height). The <aside> reserves
 * the layout footprint (narrow when collapsed); the inner panel is the
 * sticky, scrolling element. When collapsed the panel turns indigo with
 * light icons; hovering it (collapsed) grows it to full width and overlays
 * the page (z-40 + shadow) instead of pushing content around.
 */
export function SidebarDesktop({ role }: { role: Role }) {
  // Persisted collapse preference. Default expanded so the first server
  // render and first paint match.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1');
    } catch {
      // ignore disabled-storage errors
    }
  }, []);

  function toggleCollapsed(): void {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // ignore quota / disabled-storage errors
      }
      return next;
    });
  }

  // The rail no longer grows on hover — both the pinned-open (wide) and
  // collapsed (narrow icon) states now reveal a group's pages via a
  // fly-out panel anchored to the right (see DesktopNav / Flyout). The
  // panel sits at z-10; the fly-outs portal to <body> at z-[60] so they
  // always float above sticky table headers (z-40) instead of being
  // clipped by the sidebar.
  return (
    <aside
      className={cn(
        'hidden md:block relative shrink-0 transition-[width] duration-200 ease-out',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      <div
        style={{ backgroundColor: 'var(--sidebar-bg)', color: 'var(--sidebar-fg)' }}
        className={cn(
          'sticky top-14 h-[calc(100vh-3.5rem)] flex flex-col border-r z-10',
          'rounded-r-2xl overflow-hidden transition-[background-color] duration-200 ease-out',
          'border-[color:var(--sidebar-hover)]',
        )}
      >
        <CollapseToggle expanded={!collapsed} collapsed={collapsed} onToggle={toggleCollapsed} />
        <DesktopNav role={role} collapsed={collapsed} />
        {!collapsed && <Footer />}
      </div>
    </aside>
  );
}

/**
 * Mobile push-menu (below md). Fixed to the left edge and pinned BEHIND the
 * page surface (z-0). AppShell scales + slides the page aside to reveal this
 * indigo menu — the iOS "slide menu" effect. It only becomes interactive
 * once the page has slid open.
 */
export function SidebarMobile({
  role,
  mobileOpen = false,
  onClose,
}: {
  role: Role;
  mobileOpen?: boolean;
  onClose?: () => void;
}) {
  return (
    <aside
      style={{ backgroundColor: 'var(--sidebar-bg)', color: 'var(--sidebar-fg)' }}
      className={cn(
        'md:hidden fixed inset-y-0 left-0 z-0 w-[72%] max-w-xs',
        'flex flex-col',
        mobileOpen ? 'pointer-events-auto' : 'pointer-events-none',
      )}
      aria-hidden={!mobileOpen}
    >
      <Link
        href="/app/dashboard"
        onClick={onClose}
        className="px-5 py-5 flex items-center gap-3 border-b border-[color:var(--sidebar-hover)] hover:bg-[var(--sidebar-hover)] transition-colors"
        title="Go to dashboard"
      >
        <span className="bg-white/95 rounded-xl p-1.5 flex items-center justify-center">
          <BrandLogo variant="mark" height={40} />
        </span>
        <div className="flex-1">
          <div className="font-display font-extrabold leading-tight text-base tracking-wider">PPK TEX</div>
          <div className="text-[10px] uppercase tracking-wider opacity-70">Cloud ERP</div>
        </div>
      </Link>
      <NavBody role={role} onItemClick={onClose} />
      <div className="px-4 py-3 border-t border-[color:var(--sidebar-hover)] text-[10px] opacity-60">
        v0.1 - {new Date().getFullYear()} PPK Tex Industries
      </div>
    </aside>
  );
}
