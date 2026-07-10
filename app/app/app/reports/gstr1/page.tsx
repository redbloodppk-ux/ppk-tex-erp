/**
 * GSTR-1 Export
 *
 * Pick a return period (month) and download a JSON file in the GST portal's
 * GSTR-1 upload format. Builds the return from billed invoices + credit
 * notes (draft / cancelled excluded) for the chosen month.
 *
 * Query string:  ?period=YYYY-MM   (defaults to the current month)
 *
 * Sections: B2B, B2CL, B2CS, CDNR, CDNUR, HSN summary, Doc-issue.
 * Company GSTIN + home state come from Settings → Company (company_profile).
 */
import { createClient } from '@/lib/supabase/server';
import { loadCompany } from '@/lib/load-company';
import { fmtRupees } from '@/lib/format';
import { PageHeader } from '@/app/components/page-header';
import { buildGstr1, buildReportTables, summarise } from '@/lib/gstr1';
import type { Gstr1Invoice, Gstr1Line } from '@/lib/gstr1';
import { DownloadJsonButton } from './download-json-button';
import { ReportTables } from './report-tables';
import { AlertCircle, FileJson, Info } from 'lucide-react';

export const metadata = { title: 'GSTR-1 Export' };
export const dynamic = 'force-dynamic';

/* ── period helpers ─────────────────────────────────────────────── */

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 'YYYY-MM' → { from, to (last day), fp 'MMYYYY', label }. */
function periodBounds(period: string): {
  from: string;
  to: string;
  fp: string;
  label: string;
} {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  const safe = m ? period : currentPeriod();
  const parts = safe.split('-');
  const y = Number(parts[0]);
  const mo = Number(parts[1]);
  const from = `${y}-${String(mo).padStart(2, '0')}-01`;
  const lastDay = new Date(y, mo, 0).getDate();
  const to = `${y}-${String(mo).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const fp = `${String(mo).padStart(2, '0')}${y}`;
  const label = new Date(y, mo - 1, 1).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });
  return { from, to, fp, label };
}

/* ── DB row shapes ──────────────────────────────────────────────── */

interface LineRow {
  hsn_sac: string | null;
  description: string | null;
  quantity: number | null;
  uom: string | null;
  gst_rate_pct: number | null;
  taxable_amount: number | null;
  cgst_amount: number | null;
  sgst_amount: number | null;
  igst_amount: number | null;
}
interface InvoiceRow {
  invoice_no: string | null;
  invoice_date: string | null;
  doc_type: string | null;
  party_gstin: string | null;
  party_state: string | null;
  place_of_supply: string | null;
  is_interstate: boolean | null;
  total: number | null;
  invoice_line: LineRow[] | null;
}

/* ── page ───────────────────────────────────────────────────────── */

interface PageProps {
  searchParams: Promise<{ period?: string }>;
}

export default async function Gstr1Page({ searchParams }: PageProps) {
  const sp = await searchParams;
  const period = sp.period ?? currentPeriod();
  const { from, to, fp, label } = periodBounds(period);

  const company = await loadCompany();
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data, error } = await sb
    .from('invoice')
    .select(
      `invoice_no, invoice_date, doc_type, party_gstin, party_state, place_of_supply, is_interstate, total,
       invoice_line ( hsn_sac, description, quantity, uom, gst_rate_pct, taxable_amount, cgst_amount, sgst_amount, igst_amount )`,
    )
    .gte('invoice_date', from)
    .lte('invoice_date', to)
    .not('status', 'in', '(draft,cancelled)')
    .order('invoice_no', { ascending: true });

  const dbRows = (data as InvoiceRow[] | null) ?? [];

  const rows: Gstr1Invoice[] = dbRows
    .filter((r) => r.invoice_no && r.invoice_date && r.doc_type)
    .map((r) => ({
      invoice_no: r.invoice_no as string,
      invoice_date: r.invoice_date as string,
      doc_type: r.doc_type as string,
      party_gstin: r.party_gstin,
      party_state: r.party_state,
      place_of_supply: r.place_of_supply,
      is_interstate: r.is_interstate,
      total: r.total,
      lines: (r.invoice_line ?? []).map(
        (l): Gstr1Line => ({
          hsn_sac: l.hsn_sac,
          description: l.description,
          quantity: l.quantity,
          uom: l.uom,
          gst_rate_pct: l.gst_rate_pct,
          taxable_amount: l.taxable_amount,
          cgst_amount: l.cgst_amount,
          sgst_amount: l.sgst_amount,
          igst_amount: l.igst_amount,
        }),
      ),
    }));

  const gstr1 = buildGstr1({ gstin: company.gstin, stateCode: company.stateCode }, rows, fp);
  const sum = summarise(gstr1);
  const nothing = rows.length === 0;
  const gstinMissing = !/^[0-9]{2}[A-Z0-9]{13}$/.test(company.gstin.trim().toUpperCase());

  return (
    <div>
      <PageHeader
        title="GSTR-1 Export"
        crumbs={[{ label: 'Reports', href: '/app/reports' }, { label: 'GSTR-1 Export' }]}
        subtitle={`Download a GST-portal-ready JSON for ${label}. Built from billed invoices and credit notes — drafts and cancelled documents are left out.`}
        actions={
          <DownloadJsonButton data={gstr1} fp={fp} gstin={company.gstin} disabled={nothing || gstinMissing} />
        }
      />

      {/* Period picker */}
      <form className="card p-3 mb-4 flex flex-wrap gap-3 items-end text-sm" action="">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">Return period (month)</span>
          <input type="month" name="period" defaultValue={period} className="input" />
        </label>
        <button type="submit" className="btn-primary">
          Load
        </button>
        <div className="text-xs text-ink-mute self-center">
          GSTIN <span className="font-mono">{company.gstin}</span> · FP <span className="font-mono">{fp}</span>
        </div>
      </form>

      {gstinMissing && (
        <div className="card p-4 text-sm text-err mb-4 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Company GSTIN looks invalid or is missing.</div>
            <div className="text-xs opacity-80 mt-1">
              Set a valid 15-character GSTIN in Settings → Company before exporting.
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="card p-4 text-sm text-err mb-4 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Could not load invoices.</div>
            <div className="text-xs opacity-80 mt-1">{error.message}</div>
          </div>
        </div>
      )}

      {/* Totals strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <div className="card p-3">
          <div className="flex items-center gap-1.5 text-xs text-ink-mute">
            <FileJson className="w-4 h-4" />
            <span>Documents</span>
          </div>
          <div className="text-lg font-semibold mt-1">{rows.length}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-ink-mute">Total taxable</div>
          <div className="text-lg font-semibold mt-1">{fmtRupees(sum.totalTaxable)}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-ink-mute">Total tax (C+S+I)</div>
          <div className="text-lg font-semibold mt-1">{fmtRupees(sum.totalTax)}</div>
        </div>
      </div>

      {/* GSTR-1 report tables (official form layout) */}
      {nothing ? (
        <div className="card p-8 text-center text-sm text-ink-mute">
          No billed invoices or credit notes in {label}.
        </div>
      ) : (
        <ReportTables tables={buildReportTables(gstr1)} />
      )}

      {/* Notes */}
      <div className="card p-4 mt-4 text-xs text-ink-soft flex items-start gap-2">
        <Info className="w-4 h-4 mt-0.5 shrink-0 text-ink-mute" />
        <div className="space-y-1">
          <p>
            Outward invoices counted: tax invoices, jobwork invoices, general sales and yarn sales. Credit
            notes go into CDNR / CDNUR and are netted out of the HSN summary.
          </p>
          <p>
            Buyers with a valid GSTIN go to B2B; others to B2CS (or B2CL for interstate sales above ₹1 lakh).
            Place-of-supply codes come from the buyer&apos;s GSTIN, falling back to the state name.
          </p>
          <p>
            After downloading, open the GST portal&apos;s Returns Offline Tool (or GSTR-1 → Import), upload this
            JSON, and review before filing. Always verify totals against the Sales Register.
          </p>
        </div>
      </div>
    </div>
  );
}
