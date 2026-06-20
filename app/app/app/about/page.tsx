import type { Metadata } from 'next';
import {
  Layers, Palette, Database, ClipboardCheck, FileText,
  FlaskConical, Wrench, Info, Plug, BadgeCheck, Truck, MessageCircle,
} from 'lucide-react';
import { PageHeader } from '@/app/components/page-header';

export const metadata: Metadata = {
  title: 'About — PPK TEX Cloud ERP',
};

interface Tool {
  name: string;
  version: string;
  purpose: string;
}

interface StackGroup {
  category: string;
  icon: React.ComponentType<{ className?: string }>;
  tools: Tool[];
}

interface Integration {
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  provider: string;
  purpose: string;
}

/**
 * External APIs and third-party services the ERP talks to. Providers are
 * configured via environment variables; see the relevant route/lib files.
 */
const INTEGRATIONS: Integration[] = [
  {
    name: 'GST Number Verification',
    icon: BadgeCheck,
    provider: 'Sandbox / AppyFlow',
    purpose: 'Looks up a GSTIN and auto-fills the party\u2019s legal name and address, so customer and supplier records stay accurate.',
  },
  {
    name: 'E-Way Bill Generation',
    icon: Truck,
    provider: 'MasterGST (GSP) — NIC EWB v1.03',
    purpose: 'Generates government e-way bills for invoices directly from the app, required for moving goods above the value threshold.',
  },
  {
    name: 'WhatsApp Sharing',
    icon: MessageCircle,
    provider: 'wa.me click-to-chat',
    purpose: 'Sends invoices and delivery challans to customers on WhatsApp with one tap — no number saving needed.',
  },
  {
    name: 'Supabase Cloud',
    icon: Database,
    provider: 'Postgres + Auth + Realtime',
    purpose: 'The cloud database, secure staff login and live data sync that the whole application runs on.',
  },
];

/**
 * Versions are taken from app/package.json (the "^" prefix is dropped for
 * display). Keep this list in sync when dependencies are bumped.
 */
const STACK: StackGroup[] = [
  {
    category: 'Framework & Language',
    icon: Layers,
    tools: [
      { name: 'Next.js', version: '15.1', purpose: 'React framework — App Router, server components, routing' },
      { name: 'React', version: '19.0', purpose: 'UI library for building the interface' },
      { name: 'TypeScript', version: '5.6', purpose: 'Typed JavaScript — catches errors before they ship' },
      { name: 'Node.js', version: '22 (LTS)', purpose: 'Runtime that builds and serves the app' },
    ],
  },
  {
    category: 'User Interface & Styling',
    icon: Palette,
    tools: [
      { name: 'Tailwind CSS', version: '3.4', purpose: 'Utility-first styling for the whole app' },
      { name: 'lucide-react', version: '0.460', purpose: 'Icon set used across the sidebar and pages' },
      { name: 'Recharts', version: '2.13', purpose: 'Charts and graphs on dashboards and reports' },
      { name: '@tailwindcss/forms + typography', version: '0.5', purpose: 'Form-control and rich-text styling presets' },
      { name: 'clsx + tailwind-merge + CVA', version: '2.x / 0.7', purpose: 'Clean, conflict-free CSS class composition' },
    ],
  },
  {
    category: 'Backend & Data',
    icon: Database,
    tools: [
      { name: 'Supabase (Postgres)', version: 'JS SDK 2.45', purpose: 'Cloud database, authentication and row-level security' },
      { name: '@supabase/ssr', version: '0.7', purpose: 'Secure session handling on the server' },
      { name: 'Supabase CLI', version: '1.219', purpose: 'Database migrations and type generation' },
      { name: 'decimal.js', version: '10.4', purpose: 'Exact money/quantity maths — no rounding errors' },
      { name: 'date-fns', version: '4.1', purpose: 'Date handling and formatting' },
    ],
  },
  {
    category: 'Forms & Validation',
    icon: ClipboardCheck,
    tools: [
      { name: 'react-hook-form', version: '7.53', purpose: 'Fast, reliable data-entry forms' },
      { name: 'Zod', version: '3.23', purpose: 'Schema validation for inputs and API data' },
      { name: '@hookform/resolvers', version: '3.9', purpose: 'Connects Zod validation to the forms' },
    ],
  },
  {
    category: 'Documents & PWA',
    icon: FileText,
    tools: [
      { name: 'PDFKit', version: '0.15', purpose: 'Generates invoices, delivery challans and reports as PDF' },
      { name: 'next-pwa', version: '5.6', purpose: 'Installable app + offline support on phone and desktop' },
      { name: 'sharp', version: '0.34', purpose: 'Generates app icons and splash images' },
    ],
  },
  {
    category: 'Testing',
    icon: FlaskConical,
    tools: [
      { name: 'Vitest', version: '2.1', purpose: 'Unit testing of calculations and logic' },
      { name: 'Testing Library', version: '16.0', purpose: 'Component behaviour tests' },
      { name: 'Playwright', version: '1.49', purpose: 'End-to-end testing of full user flows' },
    ],
  },
  {
    category: 'Build & Tooling',
    icon: Wrench,
    tools: [
      { name: 'ESLint', version: '9.15', purpose: 'Code-quality and consistency checks' },
      { name: 'PostCSS + Autoprefixer', version: '8.4 / 10.4', purpose: 'Processes CSS for browser compatibility' },
      { name: 'Git + GitHub', version: '—', purpose: 'Version control and code hosting' },
    ],
  },
];

export default function AboutPage(): React.ReactElement {
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="About"
        subtitle="The technology behind PPK TEX Cloud ERP"
        crumbs={[{ label: 'Dashboard', href: '/app/dashboard' }, { label: 'About' }]}
      />

      {/* Overview */}
      <div className="card p-6 mb-6">
        <div className="flex items-start gap-3">
          <span className="shrink-0 w-10 h-10 rounded-xl bg-indigo/10 text-indigo flex items-center justify-center">
            <Info className="w-5 h-5" />
          </span>
          <div>
            <h2 className="text-lg font-display font-bold text-ink">PPK TEX Cloud ERP</h2>
            <p className="text-sm text-ink-soft mt-1 leading-relaxed">
              A cloud-based ERP built to run a textile weaving business end to end —
              fabric costing, sales orders, delivery challans, invoices, yarn and
              fabric inventory, sizing and weaving production, job work, payroll and
              finance. It works in any browser and installs as an app on phone and
              desktop, with offline support for the shop floor. All data is stored
              securely in the cloud with role-based access for each staff member.
            </p>
          </div>
        </div>
      </div>

      {/* Stack groups */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {STACK.map((group) => {
          const Icon = group.icon;
          return (
            <section key={group.category} className="card p-5">
              <h3 className="flex items-center gap-2 text-sm font-bold text-ink mb-3">
                <Icon className="w-4 h-4 text-indigo" />
                {group.category}
              </h3>
              <ul className="space-y-2.5">
                {group.tools.map((tool) => (
                  <li key={tool.name} className="flex flex-col gap-0.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-ink">{tool.name}</span>
                      <span className="shrink-0 text-[11px] font-mono text-ink-mute bg-cloud/60 rounded px-1.5 py-0.5">
                        {tool.version}
                      </span>
                    </div>
                    <span className="text-xs text-ink-soft leading-snug">{tool.purpose}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {/* External APIs & Integrations */}
      <section className="card p-6 mt-6">
        <h3 className="flex items-center gap-2 text-sm font-bold text-ink mb-1">
          <Plug className="w-4 h-4 text-indigo" />
          External APIs &amp; Integrations
        </h3>
        <p className="text-xs text-ink-soft mb-4 leading-relaxed">
          Services the ERP connects to. All keys are stored securely as
          environment variables, never in the code.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {INTEGRATIONS.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.name} className="flex items-start gap-3 rounded-xl border border-line/60 bg-cloud/30 p-4">
                <span className="shrink-0 w-9 h-9 rounded-lg bg-indigo/10 text-indigo flex items-center justify-center">
                  <Icon className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-semibold text-ink">{item.name}</span>
                    <span className="text-[11px] font-mono text-ink-mute bg-cloud/60 rounded px-1.5 py-0.5">
                      {item.provider}
                    </span>
                  </div>
                  <p className="text-xs text-ink-soft leading-snug mt-1">{item.purpose}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Footer meta */}
      <div className="card p-5 mt-6 text-sm text-ink-soft">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-mute mb-0.5">Application</div>
            <div className="font-semibold text-ink">PPK TEX Cloud ERP</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-mute mb-0.5">Version</div>
            <div className="font-semibold text-ink">v0.1.0</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-mute mb-0.5">Owner</div>
            <div className="font-semibold text-ink">PPK Tex Industries</div>
          </div>
        </div>
      </div>
    </div>
  );
}
