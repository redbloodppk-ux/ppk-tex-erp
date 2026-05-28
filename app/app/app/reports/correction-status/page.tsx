/**
 * Correction Status (internal build tracker)
 *
 * Mirrors `docs/CORRECTION_GUIDE_v1.1.md` — the master tracking document
 * for the 42 CORR-* cards split across six groups (F, T, P, R, A, H).
 *
 * For each card we show:
 *   • status              — done / in_progress / pending
 *   • evidence            — file path / migration / commit that proves it
 *   • short owner-facing description of what it covers
 *
 * Status is hand-curated here (not derived) — this page is a status
 * dashboard, not a build verifier. Keep it in sync when a card ships:
 * search for the card code (e.g. CORR-T1) and flip `status` to 'done'
 * plus add the evidence link.
 *
 * The owner's pending-list section at the bottom is auto-derived from the
 * card array so it can't drift.
 */
import { PageHeader } from '@/app/components/page-header';
import {
  CheckCircle2,
  Circle,
  Clock,
  ListChecks,
  Sparkles,
  AlertCircle,
} from 'lucide-react';

export const metadata = { title: 'Correction Status' };

type CardStatus = 'done' | 'in_progress' | 'pending';

interface CorrCard {
  code: string;
  title: string;
  status: CardStatus;
  evidence?: string;
  blurb: string;
}

interface CorrGroup {
  key: string;
  name: string;
  intent: string;
  cards: CorrCard[];
}

const GROUPS: CorrGroup[] = [
  {
    key: 'F',
    name: 'Foundation Fixes',
    intent: 'TypeScript strict, money types, test infra, formulas, security advisor cleanup.',
    cards: [
      { code: 'CORR-F1', title: 'Re-enable TypeScript strict mode', status: 'done',
        evidence: 'next.config.mjs + tsconfig.json',
        blurb: 'Strict checks back on; build errors no longer ignored.' },
      { code: 'CORR-F2', title: 'Money/measurement column audit', status: 'done',
        evidence: 'db/migrations/003_money_numeric_types.sql',
        blurb: 'Confirmed no float8/real in money or weight columns.' },
      { code: 'CORR-F3', title: 'Test infrastructure (Vitest + Playwright)', status: 'done',
        evidence: 'vitest.config.ts, playwright.config.ts, lib/money.ts',
        blurb: 'Unit + E2E test runners wired with first smoke tests.' },
      { code: 'CORR-F4', title: 'Cost formula library', status: 'done',
        evidence: 'lib/formulas/* (14 formulas, ≥95% coverage)',
        blurb: 'All 14 fabric-cost formulas as pure Decimal functions.' },
      { code: 'CORR-F5', title: 'Database security advisor cleanup', status: 'done',
        evidence: 'db/migrations/004_security_hardening.sql',
        blurb: 'Closed 7 ERROR-level RLS/policy/function issues.' },
    ],
  },
  {
    key: 'T',
    name: 'True Cost Engine',
    intent: 'Freeze per-batch true costs; surface plan-vs-actual variance.',
    cards: [
      { code: 'CORR-T1', title: 'Per-batch cost snapshot on insert', status: 'done',
        evidence: 'db/migrations/005_costing_approval_and_batch_snapshot.sql',
        blurb: 'Trigger freezes warp/weft/pick/bobbin/porvai/overhead/true cost when a batch is created.' },
      { code: 'CORR-T2', title: 'Costing approval workflow', status: 'done',
        evidence: 'app/costing/approvals/page.tsx + migration 005',
        blurb: 'Owner-only approval step before a costing can be used by a SO.' },
      { code: 'CORR-T3', title: 'Sizing cost folded into True Cost', status: 'done',
        evidence: 'db/migrations/006_batch_sizing_cost_snapshot.sql',
        blurb: 'Batch true cost now includes the actual sizing ₹/m from the pavu_assign chain.' },
      { code: 'CORR-T4', title: 'Plan-vs-actual variance view', status: 'done',
        evidence: 'db/migrations/007_batch_sizing_variance.sql (v_batch_sizing_variance)',
        blurb: 'Side-by-side plan vs actual ₹/m and total ₹ drift per batch.' },
    ],
  },
  {
    key: 'P',
    name: 'Production Intelligence',
    intent: 'Production batch entry, listing, codes, loom utilisation, outsource link.',
    cards: [
      { code: 'CORR-P1', title: 'Production batch entry screen', status: 'done',
        evidence: 'app/production/new/page.tsx',
        blurb: 'Owner-friendly form for finishing a woven batch (loom, lots, metres, dates).' },
      { code: 'CORR-P2', title: 'Production listing screen', status: 'done',
        evidence: 'app/production/page.tsx',
        blurb: 'List of all finished batches with the variance column inline.' },
      { code: 'CORR-P3', title: 'Batch code auto-generation', status: 'done',
        evidence: 'db/migrations/008_batch_code_autogen.sql',
        blurb: 'Server-side trigger assigns BATCH/YY-YY/seq when a batch is inserted.' },
      { code: 'CORR-P4', title: 'Loom utilisation dashboard', status: 'done',
        blurb: 'Per-loom % uptime + metres-per-shift roll-up (needs a view + a tile).',
        evidence: 'migration 020 (production_shift_log) + /app/production/shift-log entry screen + migration 021 (v_loom_shift_utilisation) + Loom Utilisation tile on /app/dashboard' },
      { code: 'CORR-P5', title: 'Outsource / jobwork production link', status: 'done',
        evidence: 'migration 040 (production_batch.outsource_order_id + v_production_batch_with_source) + /app/outsource list + /app/outsource/new + /app/outsource/[id] receive-fabric-form',
        blurb: 'Outsource orders now produce a real production_batch on delivery. Vendor pick paise is frozen as actual_pick_cost_per_m so True Cost / profit-by-quality include outsourced metres automatically.' },
    ],
  },
  {
    key: 'R',
    name: 'Reports & Dashboards',
    intent: 'Read-only owner reports — sales, stock, ageing, margin, cash, exports.',
    cards: [
      { code: 'CORR-R1', title: 'Sales register', status: 'done',
        evidence: 'app/reports/sales-register/page.tsx + migration 011',
        blurb: 'Every billed invoice with GST split + signed totals. Credit notes net out for true period sales.' },
      { code: 'CORR-R2', title: 'Stock report', status: 'done',
        evidence: 'app/reports/stock-on-hand/page.tsx + migration 012',
        blurb: 'Yarn lots on hand with weighted-average cost, reorder alerts, days of cover.' },
      { code: 'CORR-R3', title: 'Sizing spend report', status: 'done',
        evidence: 'app/reports/sizing-spend/page.tsx + migration 009',
        blurb: 'Monthly + per-vendor sizing ₹, weighted ₹/kg, batch variance top-50.' },
      { code: 'CORR-R4', title: 'Customer ageing', status: 'done',
        evidence: 'app/reports/customer-ageing/page.tsx + migration 013',
        blurb: 'Outstanding receivables bucketed 0-30 / 31-60 / 61-90 / 90+. Credit notes net out.' },
      { code: 'CORR-R5', title: 'Profit by Quality', status: 'done',
        evidence: 'app/reports/profit-by-quality/page.tsx + migration 010',
        blurb: 'Per-quality margin = revenue (ex-GST) − frozen true cost.' },
      { code: 'CORR-R6', title: 'Variance dashboard', status: 'done',
        evidence: 'app/reports/variance/page.tsx + migration 015 (v_variance_by_batch, v_variance_by_quality)',
        blurb: 'Planned-vs-actual cost-per-m rolled up by quality (produced-m weighted) and listed by batch.' },
      { code: 'CORR-R7', title: 'Cash-flow snapshot', status: 'done',
        evidence: 'app/reports/cashflow/page.tsx + migration 014',
        blurb: '7/30/90-day in vs out plus upcoming receivables and payables on both sides.' },
      { code: 'CORR-R8', title: 'Loom utilisation report', status: 'done',
        evidence: 'app/reports/loom-utilisation/page.tsx + migration 016 (v_loom_utilisation)',
        blurb: 'Per-loom workload from batches: metres, rejection %, active days, idle looms. Pick rate/RPM/downtime deferred — no shift log exists.' },
      { code: 'CORR-R9', title: 'Yarn days-of-cover dashboard', status: 'done',
        evidence: 'app/reports/days-of-cover/page.tsx + migration 017 (v_yarn_cover_dashboard)',
        blurb: 'Per-yarn days-of-cover drill-down with KPI tiles, out-of-stock and reorder alerts. Cover shows Idle when no warp consumption in the last 30 days.' },
      { code: 'CORR-R10', title: 'Bobbin consumption report', status: 'done',
        evidence: 'app/reports/bobbin-consumption/page.tsx + migration 018 (v_bobbin_consumption)',
        blurb: 'Per-bobbin ₹/m and split-piece reconciliation. Consumption columns read zero until production batches name their bobbins.' },
      { code: 'CORR-R11', title: 'Invoice → DC delivery report', status: 'done',
        evidence: 'app/reports/invoice-delivery/page.tsx + migration 019 (delivery_challan, dc_line, v_invoice_delivery_status)',
        blurb: 'Shows which invoices have full / partial / missing delivery challans. Migration 019 also lays down the delivery_challan + dc_line tables per owner decision D11; the DC entry screen + PDF remain card R-DC1.' },
      { code: 'CORR-R12', title: 'Excel export across reports', status: 'done',
        blurb: 'Dependency-free .xlsx generator; styled "Generate Excel report" button on all 11 report pages, exporting the on-screen filtered rows.' },
    ],
  },
  {
    key: 'A',
    name: 'Attendance',
    intent: 'Morning / night shift attendance, wage roll-up, holidays.',
    cards: [
      { code: 'CORR-A1', title: 'Attendance entry screen', status: 'done',
        evidence: 'app/attendance/page.tsx (list) + app/attendance/mark/page.tsx (day-grid entry, 5 statuses, shed picker, offline queue)',
        blurb: 'Day-grid entry with statuses: present, absent, half-day, late, none. Includes shed picker for weavers and winders.' },
      { code: 'CORR-A2', title: 'Shift master + roster', status: 'done',
        evidence: 'employee.default_shift column + migration 023 (night shift toggle) + shift filter on attendance entry',
        blurb: 'Morning (8am-8pm) / Night (8pm-8am) shifts modelled as a per-employee field; shift toggle drives the mark screen.' },
      { code: 'CORR-A3', title: 'Public holiday calendar', status: 'done',
        evidence: 'attendance_day.non_working + non_working_reason enum + /app/reports/attendance-holidays',
        blurb: 'Holiday / power-cut / maintenance flag on the attendance_day; report screen lists all non-working days.' },
      { code: 'CORR-A4', title: 'Wage calculation engine', status: 'done',
        evidence: 'migrations 031/033/034/038 (wage_entry + v_batch_wage_allocation + weekly basis) + /app/wages + /app/wages/weekly',
        blurb: 'Wage entries spread across in-house batches by metres / loom-shifts / weekly basis. Weekly summary screen with winder-deduction logic.' },
      { code: 'CORR-A5', title: 'Attendance report (monthly)', status: 'done',
        evidence: 'migration 026 (v_attendance_*) + /app/reports/attendance-monthly + /app/reports/attendance-by-role + /app/reports/attendance-daily',
        blurb: 'Per-employee present/absent counts across monthly, by-role and daily views.' },
      { code: 'CORR-A7', title: 'Wages payout export', status: 'done',
        evidence: 'lib/wages/weekly-data.ts + /api/wages/weekly/export (CSV) + /api/wages/weekly/export-pdf (pdfkit, A4 landscape) + Export Excel/Download PDF buttons on /app/wages/weekly header',
        blurb: 'CSV (Excel-friendly) and PDF downloads of each week\u2019s payout breakdown: per-employee summary, raw wage entries, expenses.' },
    ],
  },
  {
    key: 'H',
    name: 'Production Hardening',
    intent: 'PWA, observability, backups, rollback, E2E, deploy automation.',
    cards: [
      { code: 'CORR-H1', title: 'PWA install flow polish', status: 'pending',
        blurb: 'Icon, splash, install prompt, offline indicator.' },
      { code: 'CORR-H2', title: 'Server error logging (Sentry/Logtail)', status: 'pending',
        blurb: 'Capture server-action and edge-function errors with stack traces.' },
      { code: 'CORR-H3', title: 'Audit log viewer', status: 'pending',
        evidence: 'app/audit/page.tsx (skeleton)',
        blurb: 'UI to browse the audit_log table with filters.' },
      { code: 'CORR-H4', title: 'Rate limiting on writes', status: 'pending',
        blurb: 'Prevent runaway insert loops from a single user/session.' },
      { code: 'CORR-H5', title: 'PDF templates for invoice / DC', status: 'pending',
        blurb: "Server-rendered PDFs matching the user's existing paperwork." },
      { code: 'CORR-H6', title: 'Notification fan-out', status: 'pending',
        evidence: 'app/notifications/page.tsx (skeleton)',
        blurb: 'In-app + email for approvals, overdue invoices, low-stock alerts.' },
      { code: 'CORR-H7', title: 'Backup runbook + restore drill', status: 'pending',
        blurb: 'Documented PITR procedure + quarterly restore test.' },
      { code: 'CORR-H8', title: 'Rollback runbook', status: 'pending',
        blurb: 'Reversible-migration discipline + 60-day rollback shakedown window.' },
      { code: 'CORR-H9', title: 'Playwright E2E suite (15 scenarios)', status: 'pending',
        blurb: 'Critical-path smoke tests against the prod URL.' },
    ],
  },
];

function countByStatus(cards: CorrCard[]): Record<CardStatus, number> {
  return cards.reduce(
    (acc, c) => {
      acc[c.status] += 1;
      return acc;
    },
    { done: 0, in_progress: 0, pending: 0 } as Record<CardStatus, number>,
  );
}

export default function CorrectionStatusReport() {
  const allCards = GROUPS.flatMap((g) => g.cards);
  const overall = countByStatus(allCards);
  const total = allCards.length;
  const pctDone = Math.round((overall.done / total) * 100);
  const pending = allCards.filter((c) => c.status !== 'done');

  return (
    <div>
      <PageHeader
        title="Correction Status"
        subtitle={`Build progress against the 42-card Correction Guide v1.1. ${overall.done} of ${total} done (${pctDone}%).`}
      />

      <div className="card p-4 mb-6">
        <div className="flex flex-wrap items-baseline gap-3 mb-2">
          <span className="text-sm text-ink-mute">Overall</span>
          <span className="text-2xl font-semibold">
            {overall.done}
            <span className="text-ink-mute text-base font-normal"> / {total}</span>
          </span>
          <span className="text-emerald-700 text-sm">{pctDone}% done</span>
          {overall.in_progress > 0 && (
            <span className="text-amber-700 text-sm">{overall.in_progress} in progress</span>
          )}
          <span className="text-ink-soft text-sm">{overall.pending} pending</span>
        </div>
        <ProgressBar done={overall.done} inProgress={overall.in_progress} total={total} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {GROUPS.map((g) => {
          const c = countByStatus(g.cards);
          return (
            <div key={g.key} className="card p-3">
              <div className="text-xs text-ink-mute uppercase tracking-wide">Group {g.key}</div>
              <div className="font-medium text-sm">{g.name}</div>
              <div className="mt-2 text-lg font-semibold">
                {c.done}
                <span className="text-ink-mute text-sm font-normal"> / {g.cards.length}</span>
              </div>
            </div>
          );
        })}
      </div>

      {GROUPS.map((g) => (<GroupSection key={g.key} group={g} />))}

      <div className="mt-8">
        <div className="flex items-baseline gap-2 mb-2">
          <ListChecks className="w-4 h-4 text-ink-mute" />
          <h2 className="text-base font-semibold">Pending list ({pending.length})</h2>
          <span className="text-xs text-ink-mute">
            Recommended sequence: finish T → P → R → A → H within each group.
          </span>
        </div>
        {pending.length === 0 ? (
          <div className="card p-6 text-center text-sm text-emerald-700">
            <Sparkles className="w-4 h-4 inline mr-1" /> All 42 cards done. Time to retire this dashboard.
          </div>
        ) : (
          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-mute bg-cloud/40">
                <tr>
                  <th className="text-left px-3 py-2 w-28">Card</th>
                  <th className="text-left px-3 py-2 w-32">Status</th>
                  <th className="text-left px-3 py-2">What it covers</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((c) => (
                  <tr key={c.code} className="border-t border-line/40">
                    <td className="px-3 py-2 font-mono text-xs">{c.code}</td>
                    <td className="px-3 py-2"><StatusBadge status={c.status} /></td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{c.title}</div>
                      <div className="text-xs text-ink-soft mt-0.5">{c.blurb}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-ink-mute mt-6">
        This page is a hand-curated tracker. When a card ships, edit{' '}
        <code className="font-mono text-[11px] bg-cloud/40 px-1 rounded">app/reports/correction-status/page.tsx</code>{' '}
        and flip the card&rsquo;s <code>status</code> to <code>&apos;done&apos;</code> with an <code>evidence</code> path.
      </p>
    </div>
  );
}

function GroupSection({ group }: { group: CorrGroup }) {
  const c = countByStatus(group.cards);
  return (
    <section className="mb-6">
      <div className="flex items-baseline gap-2 mb-2 mt-2">
        <h2 className="text-base font-semibold">{group.key}. {group.name}</h2>
        <span className="text-xs text-ink-mute">{group.intent}</span>
        <span className="ml-auto text-xs text-ink-soft">{c.done}/{group.cards.length} done</span>
      </div>
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-ink-mute bg-cloud/40">
            <tr>
              <th className="text-left px-3 py-2 w-28">Card</th>
              <th className="text-left px-3 py-2 w-32">Status</th>
              <th className="text-left px-3 py-2">Title &amp; evidence</th>
            </tr>
          </thead>
          <tbody>
            {group.cards.map((card) => (
              <tr key={card.code} className="border-t border-line/40">
                <td className="px-3 py-2 font-mono text-xs">{card.code}</td>
                <td className="px-3 py-2"><StatusBadge status={card.status} /></td>
                <td className="px-3 py-2">
                  <div className="font-medium">{card.title}</div>
                  <div className="text-xs text-ink-soft mt-0.5">{card.blurb}</div>
                  {card.evidence && (
                    <div className="text-[11px] text-ink-mute font-mono mt-0.5">{card.evidence}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: CardStatus }) {
  if (status === 'done') {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-semibold">
        <CheckCircle2 className="w-3.5 h-3.5" /> Done
      </span>
    );
  }
  if (status === 'in_progress') {
    return (
      <span className="inline-flex items-center gap-1 text-amber-700 text-xs font-semibold">
        <Clock className="w-3.5 h-3.5" /> In progress
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-ink-mute text-xs">
      <Circle className="w-3.5 h-3.5" /> Pending
    </span>
  );
}

interface ProgressBarProps {
  done: number;
  inProgress: number;
  total: number;
}

function ProgressBar({ done, inProgress, total }: ProgressBarProps) {
  const donePct = (done / total) * 100;
  const inProgPct = (inProgress / total) * 100;
  return (
    <div className="w-full h-2 rounded-full bg-cloud/60 overflow-hidden flex">
      <div className="h-full bg-emerald-500" style={{ width: `${donePct}%` }} title={`${done} done`} />
      <div className="h-full bg-amber-400" style={{ width: `${inProgPct}%` }} title={`${inProgress} in progress`} />
    </div>
  );
}
