'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Users, Calculator, Package, Boxes, ShoppingCart, Receipt,
  Truck, Hammer, RefreshCw, ClipboardList, BadgeIndianRupee, Wallet,
  CreditCard, FileBarChart, ClockAlert, Bell, Settings, BookCheck,
  Factory, X, Disc3, Layers, Warehouse, Gauge,
} from 'lucide-react';

type Role = 'owner' | 'mill_manager' | 'sales_manager' | 'accounts' | 'floor_operator' | 'auditor';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Role[];
  group: 'core' | 'sales' | 'production' | 'finance' | 'admin';
}

const NAV: NavItem[] = [
  { href: '/app/dashboard',     label: 'Dashboard',          icon: LayoutDashboard, group: 'core',       roles: ['owner','mill_manager','sales_manager','accounts','floor_operator','auditor'] },
  { href: '/app/customers',     label: 'Customers',          icon: Users,           group: 'sales',      roles: ['owner','sales_manager','accounts','auditor'] },
  { href: '/app/costing',       label: 'Fabric Costing',     icon: Calculator,      group: 'sales',      roles: ['owner','mill_manager','sales_manager','auditor'] },
  { href: '/app/orders',        label: 'Sales Orders',       icon: ShoppingCart,    group: 'sales',      roles: ['owner','sales_manager','mill_manager','accounts','auditor'] },
  { href: '/app/invoices',      label: 'Invoices',           icon: Receipt,         group: 'sales',      roles: ['owner','sales_manager','accounts','auditor'] },
  { href: '/app/yarn',          label: 'Yarn & Mills',       icon: Boxes,           group: 'production', roles: ['owner','mill_manager','accounts','auditor'] },
  { href: '/app/sizing',        label: 'Sizing Jobs',        icon: Disc3,           group: 'production', roles: ['owner','mill_manager','floor_operator','accounts','auditor'] },
  { href: '/app/pavu',          label: 'Pavu (Sized Beams)', icon: Layers,          group: 'production', roles: ['owner','mill_manager','floor_operator','auditor'] },
  { href: '/app/warehouse',     label: 'Warehouse',          icon: Warehouse,       group: 'production', roles: ['owner','mill_manager','accounts','auditor'] },
  { href: '/app/bobbin',        label: 'Bobbin Stock',       icon: Package,         group: 'production', roles: ['owner','mill_manager','auditor'] },
  { href: '/app/production',    label: 'Production',         icon: Factory,         group: 'production', roles: ['owner','mill_manager','floor_operator','auditor'] },
  { href: '/app/production/shift-log', label: 'Shift Log',   icon: Gauge,           group: 'production', roles: ['owner','mill_manager','floor_operator','auditor'] },
  { href: '/app/outsource',     label: 'Outsource Weaving',  icon: Truck,           group: 'production', roles: ['owner','mill_manager','accounts','auditor'] },
  { href: '/app/jobwork',       label: 'Job Work',           icon: Hammer,          group: 'production', roles: ['owner','mill_manager','accounts','auditor'] },
  { href: '/app/resale',        label: 'Resale',             icon: RefreshCw,       group: 'production', roles: ['owner','mill_manager','accounts','auditor'] },
  { href: '/app/employees',     label: 'Employees',          icon: Users,           group: 'production', roles: ['owner','mill_manager','accounts','auditor'] },
  { href: '/app/attendance',    label: 'Attendance',         icon: ClipboardList,   group: 'production', roles: ['owner','mill_manager','floor_operator','accounts','auditor'] },
  { href: '/app/wages',         label: 'Wages',              icon: BadgeIndianRupee,group: 'finance',    roles: ['owner','accounts','auditor'] },
  { href: '/app/pay-customer',  label: 'Customer Payments',  icon: Wallet,          group: 'finance',    roles: ['owner','accounts','sales_manager','auditor'] },
  { href: '/app/pay-purchase',  label: 'Purchase Payments',  icon: CreditCard,      group: 'finance',    roles: ['owner','accounts','auditor'] },
  { href: '/app/reports',       label: 'Reports',            icon: FileBarChart,    group: 'finance',    roles: ['owner','accounts','sales_manager','mill_manager','auditor'] },
  { href: '/app/audit',         label: 'Audit Log',          icon: BookCheck,       group: 'admin',      roles: ['owner','auditor'] },
  { href: '/app/notifications', label: 'Notifications',      icon: Bell,            group: 'admin',      roles: ['owner','mill_manager','sales_manager','accounts','floor_operator','auditor'] },
  { href: '/app/alerts',        label: 'Stale Alerts',       icon: ClockAlert,      group: 'admin',      roles: ['owner','mill_manager','accounts','auditor'] },
  { href: '/app/settings',      label: 'Settings',           icon: Settings,        group: 'admin',      roles: ['owner','auditor'] },
];

const GROUP_LABEL: Record<NavItem['group'], string> = {
  core:       'Overview',
  sales:      'Sales',
  production: 'Production',
  finance:    'Finance',
  admin:      'Administration',
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
  const grouped = (['core','sales','production','finance','admin'] as const).map(g => ({
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

function Brand() {
  return (
    <div className="px-5 py-5 border-b border-line/60 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo to-violet flex items-center justify-center text-white font-bold text-sm">
        PT
      </div>
      <div>
        <div className="font-display font-extrabold text-ink leading-tight text-sm">PPK TEX</div>
        <div className="text-[10px] uppercase tracking-wider text-ink-mute">Cloud ERP</div>
      </div>
    </div>
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
          <div className="px-5 py-5 border-b border-line/60 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo to-violet flex items-center justify-center text-white font-bold text-sm">
              PT
            </div>
            <div className="flex-1">
              <div className="font-display font-extrabold text-ink leading-tight text-sm">PPK TEX</div>
              <div className="text-[10px] uppercase tracking-wider text-ink-mute">Cloud ERP</div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-cloud"
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
