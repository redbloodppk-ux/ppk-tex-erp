import { PageHeader } from '@/app/components/page-header';
import {
  FileText, Wallet, Factory, Boxes, Truck, Receipt, Calculator, Users,
} from 'lucide-react';
import { ReportsBrowser, type BrowserGroup } from './reports-browser';

export const metadata = { title: 'Reports' };

/**
 * Reports index.
 *
 * PPK, 2026-09-14: "organize the report page based on group easy to
 * identify". Thirty reports in one flat two-column grid meant reading every
 * card to find the one you wanted. They are grouped by the question they
 * answer instead, in the order the questions come up: money first, then the
 * floor, then stock, then the paperwork.
 *
 * A report belongs to exactly one group. Where a report could sit in two -
 * the Sales Register is both a sales list and a GST document - it goes with
 * the job it is actually opened for.
 */
type ReportGroup =
  | 'money' | 'production' | 'stock' | 'sales' | 'gst' | 'costing' | 'people';

interface ReportLink {
  href: string;
  title: string;
  description: string;
  ready: boolean;
  group: ReportGroup;
}

const GROUP_ORDER: ReportGroup[] = [
  'money', 'production', 'stock', 'sales', 'gst', 'costing', 'people',
];

const GROUP_META: Record<ReportGroup, { label: string; blurb: string; icon: typeof FileText }> = {
  money:      { label: 'Money',            blurb: 'Cash, profit and who owes what.',              icon: Wallet },
  production: { label: 'Production',       blurb: 'What the looms and sheds actually did.',       icon: Factory },
  stock:      { label: 'Stock',            blurb: 'Yarn and bobbins on hand, and how long they last.', icon: Boxes },
  sales:      { label: 'Sales & Delivery', blurb: 'What went out of the door, and to whom.',      icon: Truck },
  gst:        { label: 'GST & Registers',  blurb: 'Filing and the bill-by-bill registers behind it.', icon: Receipt },
  costing:    { label: 'Costing & Margin', blurb: 'What a metre cost against what it was meant to.', icon: Calculator },
  people:     { label: 'People',           blurb: 'Attendance, and money lent to workers.',       icon: Users },
};

const REPORTS: ReportLink[] = [
  // ---- Money -----------------------------------------------------------
  {
    href: '/app/reports/cashbook',
    title: 'Daily Cash Book',
    description:
      'One day of the cash drawer — opening balance, every receipt and payment in the order it was entered, and the balance after each one. Closing figure matches the Cash in Hand card on the dashboard.',
    ready: true, group: 'money',
  },
  {
    href: '/app/reports/cashflow',
    title: 'Cash-flow Snapshot',
    description:
      'Money in vs out for 7/30/90 days, plus upcoming receivables and payables on both sides. Includes Bank Entries (EB, loan EMI, etc.).',
    ready: true, group: 'money',
  },
  {
    href: '/app/reports/pnl',
    title: 'Period P&L',
    description:
      'Profit & Loss for any window — Revenue minus COGS, wages, factory expenses, bank expenses, plus other income. Net profit at the bottom. Balance-sheet items (cash withdrawals, loan principal, GST payment) are excluded.',
    ready: true, group: 'money',
  },
  {
    href: '/app/reports/customer-ageing',
    title: 'Customer Ageing',
    description: 'Outstanding receivables bucketed 0-30 / 31-60 / 61-90 / 90+.',
    ready: true, group: 'money',
  },
  {
    href: '/app/reports/financial-summary',
    title: 'Financial Summary',
    description:
      'Year-end snapshot. Pick a financial year and see party-wise receivable / payable plus a warehouse stock matrix (in-house / job-work / outsource / sizing × warp / weft / porvai / bobbin) as of 31-March.',
    ready: true, group: 'money',
  },

  // ---- Production ------------------------------------------------------
  {
    href: '/app/reports/production',
    title: 'Total Production',
    description:
      'Total metres woven from the shift log for any day, week, month or financial year. Filter by shed, weaver and quality; breaks down by date, shed, quality and weaver.',
    ready: true, group: 'production',
  },
  {
    href: '/app/reports/weaver-production',
    title: 'Weaver Production by Quality',
    description:
      'Weekly metres woven per weaver broken down by fabric quality — pivot table with totals.',
    ready: true, group: 'production',
  },
  {
    href: '/app/reports/loom-efficiency',
    title: 'Loom Efficiency & Cost',
    description:
      'Actual loom efficiency % and cost/metre vs. the target set on Settings — trended week/month/year, shed-wise, with charts. Answers "how is it going" over time.',
    ready: true, group: 'production',
  },
  {
    href: '/app/reports/loom-utilisation',
    title: 'Loom Utilisation',
    description:
      'Per-loom workload from production batches: metres woven, rejection %, active days, and idle looms.',
    ready: true, group: 'production',
  },
  {
    href: '/app/reports/shed-running',
    title: 'Shed Running',
    description:
      'Which sheds were running each shift in a week, month or year. Green = at least one weaver present, red = idle, gray = holiday. % uptime per shed.',
    ready: true, group: 'production',
  },
  {
    href: '/app/reports/production-vs-delivery',
    title: 'Production vs Delivery',
    description:
      'Per-quality variance between metres produced (shift logs for in-house; fabric receipts for jobwork & outsource) and metres delivered on DCs. Flags qualities where production is drifting from dispatch.',
    ready: true, group: 'production',
  },
  {
    href: '/app/reports/pavu-mount-history',
    title: 'Pavu Mount History',
    description:
      'History of every beam mount event — which pavu went on which loom, when it mounted and unmounted, and how many metres it produced. Filter by date range, loom, shed, mode, quality and ends.',
    ready: true, group: 'production',
  },

  // ---- Stock -----------------------------------------------------------
  {
    href: '/app/reports/stock-on-hand',
    title: 'Stock on Hand',
    description:
      'Yarn lots on hand with weighted-average cost, reorder alerts, and days of cover. Filter by in-house, jobwork or outsource.',
    ready: true, group: 'stock',
  },
  {
    // Moved out of the sidebar on PPK's request, 2026-09-14: it is a
    // read-only view of yarn lots and suppliers, so it belongs with the
    // other stock reports rather than taking a slot in Reports & Alerts.
    href: '/app/yarn',
    title: 'Yarn & Suppliers',
    description:
      'Yarn purchase lots delivered to the mill — lot number, count, supplier, quantity and rate — with days-of-cover cards for the counts actually on the shelf. Lots sent straight to the sizing mill are not shown.',
    ready: true, group: 'stock',
  },
  {
    href: '/app/reports/days-of-cover',
    title: 'Yarn Days-of-Cover',
    description:
      'How long each yarn count will last at the recent run-rate, with out-of-stock and reorder alerts.',
    ready: true, group: 'stock',
  },
  {
    href: '/app/reports/bobbin-stock',
    title: 'Bobbin Stock',
    description:
      'Every bobbin: opening stock, purchases in, weaving consumption out, empty spools returned, and the metre + piece balance.',
    ready: true, group: 'stock',
  },
  {
    href: '/app/reports/bobbin-consumption',
    title: 'Bobbin Consumption',
    description:
      'Cost per metre of each warp beam plus a split-piece reconciliation of how many bobbins have been used up.',
    ready: true, group: 'stock',
  },

  // ---- Sales & Delivery ------------------------------------------------
  {
    href: '/app/reports/invoice-delivery',
    title: 'Invoice Delivery Status',
    description:
      'Which sales invoices still need a Delivery Challan — missing, partial, or fully delivered.',
    ready: true, group: 'sales',
  },
  {
    href: '/app/reports/fabric-movements',
    title: 'Fabric Movements',
    description:
      'Per-event log of every fabric receipt and invoice line — what came in from production, what shipped out, and which invoices are still unpaid.',
    ready: true, group: 'sales',
  },
  {
    href: '/app/reports/agent-commission',
    title: 'Agent Commission',
    description:
      'Agent / broker-wise sales & purchase brokerage. Per agent: brokered business value plus commission payable, paid and outstanding. Date filter and per-document drill-down. Commission is always an outflow you owe the agent.',
    ready: true, group: 'sales',
  },

  // ---- GST & Registers -------------------------------------------------
  {
    href: '/app/reports/gstr1',
    title: 'GSTR-1 Export',
    description:
      'Pick a month and download a GST-portal-ready GSTR-1 JSON — B2B, B2CL, B2CS, credit notes, HSN summary and doc-issue, all in the upload format.',
    ready: true, group: 'gst',
  },
  {
    href: '/app/reports/sales-register',
    title: 'Sales Register',
    description:
      'Every billed invoice with GST split (CGST/SGST/IGST). Credit notes net out automatically.',
    ready: true, group: 'gst',
  },
  {
    href: '/app/reports/purchase-register',
    title: 'Purchase Register (GSTR 2B)',
    description:
      'Every supplier bill in one place — yarn, bobbin, sizing, fabric and outsource weaving. CGST/SGST/IGST split with "with GST / without GST" filter.',
    ready: true, group: 'gst',
  },

  // ---- Costing & Margin ------------------------------------------------
  {
    href: '/app/reports/profit-by-quality',
    title: 'Profit by Quality',
    description: 'Margin per quality from costing snapshot to invoice.',
    ready: true, group: 'costing',
  },
  {
    href: '/app/reports/variance',
    title: 'Variance Dashboard',
    description:
      'Planned cost-per-metre vs the actual cost frozen onto each batch, rolled up by quality and listed by batch.',
    ready: true, group: 'costing',
  },
  {
    // Moved off the sidebar on PPK's request, 2026-09-14. It is a read-only
    // audit of overhead changes, read next to Profit-by-Quality to explain
    // a margin shift — a costing report, not a settings screen. Still
    // reachable from the calibration page header.
    href: '/app/settings/looms-calibration/history',
    title: 'LOOMS Calibration History',
    description:
      'Every change to the per-metre overhead — power, labour, maintenance, depreciation, insurance — with who changed it, when, and the rupee movement per line. Use it to tie a margin shift on Profit by Quality to a specific calibration edit.',
    ready: true, group: 'costing',
  },
  {
    href: '/app/reports/sizing-spend',
    title: 'Sizing Spend',
    description:
      'Monthly spend, per-vendor breakdown, and planned-vs-actual variance for sizing jobs.',
    ready: true, group: 'costing',
  },

  // ---- People ----------------------------------------------------------
  {
    href: '/app/reports/attendance-daily',
    title: 'Daily Attendance',
    description:
      'Everyone marked on one chosen date, across both shifts, with a present/absent/half-day/late/early-leave summary and a holiday banner when the day is a non-working day.',
    ready: true, group: 'people',
  },
  {
    href: '/app/reports/attendance-monthly',
    title: 'Monthly Attendance',
    description:
      'Per-employee summary for one month — present, absent, half-day, late, early-leave counts plus total attendance days. Filter by role.',
    ready: true, group: 'people',
  },
  {
    href: '/app/reports/attendance-by-role',
    title: 'Attendance by Role',
    description:
      'Roll-up of attendance by role (weaver / sizer / loader…) for one month with a present-% bar to spot short-staffed roles at a glance.',
    ready: true, group: 'people',
  },
  {
    href: '/app/reports/attendance-holidays',
    title: 'Holidays / Non-working Days',
    description:
      'Days (or shifts) the shed did not run in a chosen range — power cut, national holiday, maintenance, other — with who marked them.',
    ready: true, group: 'people',
  },
  {
    href: '/app/reports/employee-loan-statement',
    title: 'Employee Loan Statement',
    description:
      'Per-worker loan ledger — every cash advance given and every repayment withheld from wages, with a running outstanding balance. Filter by employee and date.',
    ready: true, group: 'people',
  },
];

export default function ReportsIndex() {
  const browserGroups: BrowserGroup[] = GROUP_ORDER.map((key) => ({
    key,
    label: GROUP_META[key].label,
    blurb: GROUP_META[key].blurb,
    reports: REPORTS.filter((r) => r.group === key).map((r) => ({
      href: r.href, title: r.title, description: r.description, ready: r.ready,
    })),
  })).filter((g) => g.reports.length > 0);

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Read-only dashboards for understanding what happened. Point at a group to see its reports; click to keep it open."
      />
      {/* The group row and the card list are interactive (hover previews, a
          click pins), so they live in a client component. This page stays a
          server component because it exports metadata. Icons are resolved
          on the other side: a component cannot cross the boundary. */}
      <ReportsBrowser groups={browserGroups} />
    </div>
  );
}
