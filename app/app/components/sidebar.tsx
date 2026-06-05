'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Users, Calculator, Package, PackageCheck, Boxes, ShoppingCart, Receipt,
  Truck, Hammer, RefreshCw, ClipboardList, BadgeIndianRupee, Wallet,
  FileBarChart, ClockAlert, Bell, Settings, BookCheck,
  Factory, X, Disc3, Layers, Warehouse, Gauge, Calendar, Activity,
  Building2,
} from 'lucide-react';
import { BrandLogo } from './brand-logo';

type Role = 'owner' | 'mill_manager' | 'sales_manager' | 'accounts' | 'floor_operator' | 'auditor';

type GroupKey = 'overview' | 'sales' | 'inventory' | 'production' | 'people' | 'insights' | 'admin';

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
  // Overview
  { href: '/app/dashboard',     label: 'Dashboard',          icon: LayoutDashboard, group: 'overview',   roles: ['owner','mill_manager','sales_manager','accounts','floor_operator','auditor'] },

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
  { href: '/app/payments',          label: 'Payments',         icon: Wallet,          group: 'sales',      roles: ['owner','accounts','sales_manager','auditor'] },

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
  { href: '/app/resale',        label: 'Resale',             icon: RefreshCw,       group: 'production', roles: ['owner','mill_manager','accounts','auditor'] },

  // People (HR)
  { href: '/app/employees',     label: 'Employees',          icon: Users,           group: 'people',     roles: ['owner','mill_manager','accounts','auditor'] },
  { href: '/app/attendance',    label: 'Attendance',         icon: ClipboardList,   group: 'people',     roles: ['owner','mill_manager','floor_operator','accounts','auditor'] },
  { href: '/app/wages',         label: 'Wages',              icon: BadgeIndianRupee,group: 'people',     roles: ['owner','accounts','auditor'] },
  { href: '/app/wages/weekly',  label: 'Weekly Summary',     icon: Calendar,        group: 'insights',   roles: ['owner','accounts','auditor'] },
  { href: '/app/expenses',      label: 'Expenses',           icon: Wallet,          group: 'people',     roles: ['owner','accounts','auditor'] },

  // Insights
  { href: '/app/reports',       label: 'Reports',            icon: FileBarChart,    group: 'insights',   roles: ['owner','accounts','sales_manager','mill_manager','auditor'] },
  { href: '/app/yarn',          label: 'Yarn Reports',       icon: Boxes,           group: 'insights',   roles: ['owner','mill_manager','accounts','auditor'] },
  { href: '/app/reports/shed-running', label: 'Shed Running', icon: Activity,        group: 'insights',   roles: ['owner','mill_manager','accounts','auditor'] },
  { href: '/app/alerts',        label: 'Stale Alerts',       icon: ClockAlert,      group: 'insights',   roles: ['owner','mill_manager','accounts','auditor'] },
  { href: '/app/notifications', label: 'Notifications',      icon: Bell,            group: 'insights',   roles: ['owner','mill_manager','sales_manager','accounts','floor_operator','auditor'] },

  // Admin
  { href: '/app/parties',       label: 'Parties',            icon: Users,           group: 'admin',      roles: ['owner','sales_manager','mill_manager','accounts','auditor'] },
  { href: '/app/ledgers',       label: 'Ledgers',            icon: BookCheck,       group: 'admin',      roles: ['owner','accounts','auditor'] },
  { href: '/app/settings',      label: 'Settings',           icon: Settings,        group: 'admin',      roles: ['owner','auditor'] },
  { href: '/app/audit',         label: 'Audit Log',          icon: BookCheck,       group: 'admin',      roles: ['owner','auditor'] },
];

const GROUP_ORDER: readonly GroupKey[] = [
  'overview', 'sales', 'inventory', 'production', 'people', 'insights', 'admin',
];

const GROUP_LABEL: Record<GroupKey, string> = {
  overview:   'Overview',
  sales:      'Sales & Customers',
  inventory:  'Inventory & Purchases',
  production: 'Production',
  people:     'People & Payroll',
  insights:   'Reports & Alerts',
  admin:      'Admin',
};

function NavBody({
  role,
  onItemClick,
}: {
  role: Role;
  onItemClick?: () => void;
}) {
  const pathname = usePathname();
  const visible = NAV.filter(n => n.roles.includes(role));
  const grouped = GROUP_ORDER.map(g => ({
    group: g,
    items: visible.filter(i => i.group === g),
  })).filter(g => g.items.length > 0);

  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
      {grouped.map(({ group, items }) => (
        <div key={group}>
          <div className="px-2 mb-1.5 text-[10px] uppercase tracking-wider font-semibold text-ink-mute">
            {GROUP_LABEL[group]}
          </div>
          <ul className="space-y-0.5">
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
        </div>
      ))}
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
