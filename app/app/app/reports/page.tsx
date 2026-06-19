import Link from 'next/link';

import { PageHeader } from '@/app/components/page-header';
import { FileText, ArrowRight } from 'lucide-react';

export const metadata = { title: 'Reports' };

interface ReportLink {
  href: string;
  title: string;
  description: string;
  ready: boolean;
}

const REPORTS: ReportLink[] = [
  {
    href: '/app/reports/sizing-spend',
    title: 'Sizing Spend',
    description:
      'Monthly spend, per-vendor breakdown, and planned-vs-actual variance for sizing jobs.',
    ready: true,
  },
  {
    href: '/app/reports/sales-register',
    title: 'Sales Register',
    description:
      'Every billed invoice with GST split (CGST/SGST/IGST). Credit notes net out automatically.',
    ready: true,
  },
  {
    href: '/app/reports/agent-commission',
    title: 'Agent Commission',
    description:
      'Agent / broker-wise sales & purchase brokerage. Per agent: brokered business value plus commission payable, paid and outstanding. Date filter and per-document drill-down. Commission is always an outflow you owe the agent.',
    ready: true,
  },
  {
    href: '/app/reports/purchase-register',
    title: 'Purchase Register',
    description:
      'Every supplier bill in one place — yarn, bobbin, sizing, fabric and outsource weaving. CGST/SGST/IGST split with "with GST / without GST" filter.',
    ready: true,
  },
  {
    href: '/app/reports/stock-on-hand',
    title: 'Stock on Hand',
    description:
      'Yarn lots on hand with weighted-average cost, reorder alerts, and days of cover.',
    ready: true,
  },
  {
    href: '/app/reports/customer-ageing',
    title: 'Customer Ageing',
    description: 'Outstanding receivables bucketed 0-30 / 31-60 / 61-90 / 90+.',
    ready: true,
  },
  {
    href: '/app/reports/profit-by-quality',
    title: 'Profit by Quality',
    description: 'Margin per quality from costing snapshot to invoice.',
    ready: true,
  },
  {
    href: '/app/reports/cashflow',
    title: 'Cash-flow Snapshot',
    description:
      'Money in vs out for 7/30/90 days, plus upcoming receivables and payables on both sides. Includes Bank Entries (EB, loan EMI, etc.).',
    ready: true,
  },
  {
    href: '/app/reports/pnl',
    title: 'Period P&L',
    description:
      'Profit & Loss for any window — Revenue minus COGS, wages, factory expenses, bank expenses, plus other income. Net profit at the bottom. Balance-sheet items (cash withdrawals, loan principal, GST payment) are excluded.',
    ready: true,
  },
  {
    href: '/app/reports/financial-summary',
    title: 'Financial Summary',
    description:
      'Year-end snapshot. Pick a financial year and see party-wise receivable / payable plus a warehouse stock matrix (in-house / job-work / outsource / sizing × warp / weft / porvai / bobbin) as of 31-March.',
    ready: true,
  },
  {
    href: '/app/reports/variance',
    title: 'Variance Dashboard',
    description:
      'Planned cost-per-metre vs the actual cost frozen onto each batch, rolled up by quality and listed by batch.',
    ready: true,
  },
  {
    href: '/app/reports/production-vs-delivery',
    title: 'Production vs Delivery',
    description:
      'Per-quality variance between metres produced (shift logs for in-house; fabric receipts for jobwork & outsource) and metres delivered on DCs. Flags qualities where production is drifting from dispatch.',
    ready: true,
  },
  {
    href: '/app/reports/loom-utilisation',
    title: 'Loom Utilisation',
    description:
      'Per-loom workload from production batches: metres woven, rejection %, active days, and idle looms.',
    ready: true,
  },
  {
    href: '/app/reports/days-of-cover',
    title: 'Yarn Days-of-Cover',
    description:
      'How long each yarn count will last at the recent run-rate, with out-of-stock and reorder alerts.',
    ready: true,
  },
  {
    href: '/app/reports/bobbin-stock',
    title: 'Bobbin Stock',
    description:
      'Every bobbin: opening stock, purchases in, weaving consumption out, empty spools returned, and the metre + piece balance.',
    ready: true,
  },
  {
    href: '/app/reports/bobbin-consumption',
    title: 'Bobbin Consumption',
    description:
      'Cost per metre of each warp beam plus a split-piece reconciliation of how many bobbins have been used up.',
    ready: true,
  },
  {
    href: '/app/reports/invoice-delivery',
    title: 'Invoice Delivery Status',
    description:
      'Which sales invoices still need a Delivery Challan — missing, partial, or fully delivered.',
    ready: true,
  },
  {
    href: '/app/reports/fabric-movements',
    title: 'Fabric Movements',
    description:
      'Per-event log of every fabric receipt and invoice line — what came in from production, what shipped out, and which invoices are still unpaid.',
    ready: true,
  },
  {
    href: '/app/reports/attendance-daily',
    title: 'Daily Attendance',
    description:
      'Everyone marked on one chosen date, across both shifts, with a present/absent/half-day/late/early-leave summary and a holiday banner when the day is a non-working day.',
    ready: true,
  },
  {
    href: '/app/reports/attendance-monthly',
    title: 'Monthly Attendance',
    description:
      'Per-employee summary for one month — present, absent, half-day, late, early-leave counts plus total attendance days. Filter by role.',
    ready: true,
  },
  {
    href: '/app/reports/attendance-by-role',
    title: 'Attendance by Role',
    description:
      'Roll-up of attendance by role (weaver / sizer / loader…) for one month with a present-% bar to spot short-staffed roles at a glance.',
    ready: true,
  },
  {
    href: '/app/reports/shed-running',
    title: 'Shed Running',
    description:
      'Which sheds were running each shift in a week, month or year. Green = at least one weaver present, red = idle, gray = holiday. % uptime per shed.',
    ready: true,
  },
  {
    href: '/app/reports/attendance-holidays',
    title: 'Holidays / Non-working Days',
    description:
      'Days (or shifts) the shed did not run in a chosen range — power cut, national holiday, maintenance, other — with who marked them.',
    ready: true,
  },
  {
    href: '/app/reports/weaver-production',
    title: 'Weaver Production by Quality',
    description:
      'Weekly metres woven per weaver broken down by fabric quality — pivot table with totals.',
    ready: true,
  },
  {
    href: '/app/reports/production',
    title: 'Total Production',
    description:
      'Total metres woven from the shift log for any day, week, month or financial year. Filter by shed, weaver and quality; breaks down by date, shed, quality and weaver.',
    ready: true,
  },
];

export default function ReportsIndex() {
  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Read-only dashboards for understanding what happened. Add filters and export later."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {REPORTS.map(r => (
          <ReportCard key={r.title} report={r} />
        ))}
      </div>
    </div>
  );
}

function ReportCard({ report }: { report: ReportLink }) {
  const inner = (
    <div className="card p-4 flex items-start gap-3 h-full">
      <span className="text-ink-mute mt-0.5">
        <FileText className="w-4 h-4" />
      </span>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">{report.title}</h3>
          {!report.ready && (
            <span className="text-xs text-ink-mute bg-cloud/60 px-2 py-0.5 rounded">
              Soon
            </span>
          )}
        </div>
        <p className="text-sm text-ink-soft mt-1">{report.description}</p>
      </div>
      {report.ready && (
        <span className="text-ink-mute mt-0.5">
          <ArrowRight className="w-4 h-4" />
        </span>
      )}
    </div>
  );

  if (!report.ready) return <div className="opacity-60">{inner}</div>;
  return (
    <Link href={report.href} className="block hover:opacity-90">
      {inner}
    </Link>
  );
}
