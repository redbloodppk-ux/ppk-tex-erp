/**
 * GET /app/api/tds/statement?fy=2026-27
 *
 * The financial year's TDS position as a PDF: every month it was withheld
 * in, what was due and when, the challan that paid it, and a year total.
 *
 * PPK, 2026-09-07: "need yearly statement for download as pdf", then
 * "finacial year statement for download". April to March, which is what the
 * return is filed on — a calendar year would split a year's deductions
 * across two returns and be useless for filing.
 *
 * Every figure comes from lib/tds/liability via loadTdsMonths — the same
 * code the TDS page and the dashboard use. This route formats; it does not
 * calculate. A statement that quietly disagreed with the screen it was
 * printed from would be worse than no statement.
 */
import { NextResponse } from 'next/server';
import PDFDocument from 'pdfkit';
import { createClient } from '@/lib/supabase/server';
import { loadTdsMonths, todayISO } from '@/lib/tds/liability-data';
import { financialYearOf, assessmentYearOf, type TdsMonth } from '@/lib/tds/liability';
import { fetchAll } from '@/lib/supabase/fetch-all';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** PDFKit's Helvetica has no rupee glyph — same convention as the wage PDF. */
function rs(n: number): string {
  const v = Math.round(n * 100) / 100;
  try {
    return 'Rs. ' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return 'Rs. ' + v.toFixed(2);
  }
}

function d(iso: string | null | undefined): string {
  if (!iso) return '-';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${m[3]}-${months[Number(m[2]) - 1]}-${m[1]}`;
}

interface Col { header: string; width: number; align?: 'left' | 'right' }

function drawTable(
  doc: PDFKit.PDFDocument, startX: number, startY: number,
  cols: Col[], rows: Array<Array<string | number>>, boldLast = false,
): number {
  const headerHeight = 18, rowHeight = 16, bottomMargin = 34;
  const totalW = cols.reduce((a, c) => a + c.width, 0);
  let y = startY;

  const header = (): void => {
    doc.save(); doc.rect(startX, y, totalW, headerHeight).fill('#e2e8f0'); doc.restore();
    doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(8.5);
    let x = startX;
    for (const c of cols) {
      doc.text(c.header, x + 4, y + 5, { width: c.width - 8, align: c.align ?? 'left', lineBreak: false });
      x += c.width;
    }
    y += headerHeight;
  };

  header();
  let zebra = false;
  rows.forEach((r, i) => {
    const isLast = boldLast && i === rows.length - 1;
    if (y + rowHeight > doc.page.height - bottomMargin) {
      doc.addPage(); y = doc.page.margins.top; header(); zebra = false;
    }
    if (isLast) {
      doc.save(); doc.rect(startX, y, totalW, rowHeight).fill('#f1f5f9'); doc.restore();
    } else if (zebra) {
      doc.save(); doc.rect(startX, y, totalW, rowHeight).fill('#f8fafc'); doc.restore();
    }
    doc.font(isLast ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor('#0f172a');
    let x = startX;
    cols.forEach((c, ci) => {
      const cell = r[ci];
      doc.text(cell == null ? '' : String(cell), x + 4, y + 4,
        { width: c.width - 8, align: c.align ?? 'left', lineBreak: false });
      x += c.width;
    });
    y += rowHeight;
    zebra = !zebra;
  });

  doc.moveTo(startX, y).lineTo(startX + totalW, y)
    .strokeColor('#cbd5e1').lineWidth(0.5).stroke();
  return y + 10;
}

interface Challan {
  period_month: string; paid_date: string; challan_no: string | null;
  amount: number; interest_amount: number;
}

function buildPdf(
  fy: string, months: TdsMonth[], challans: Challan[],
  company: { name: string; tan: string | null },
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      doc.font('Helvetica-Bold').fontSize(15).fillColor('#0f172a')
        .text('TDS Statement', left, doc.page.margins.top);
      doc.font('Helvetica').fontSize(10).fillColor('#475569')
        .text(`${company.name}  ·  TAN ${company.tan ?? 'not set'}  ·  Financial year ${fy}`
          + `  ·  Assessment year ${months[0] ? assessmentYearOf(months[0].month) : '-'}`);
      doc.fontSize(8).fillColor('#64748b')
        .text('Tax withheld on supplier bills, month by month, with the challan that paid it.');
      let y = doc.y + 12;

      const R = { align: 'right' as const };
      const cols: Col[] = [
        { header: 'Month deducted', width: 100 },
        { header: 'TDS withheld', width: 90, ...R },
        { header: 'Due by', width: 80 },
        { header: 'Challan no.', width: 130 },
        { header: 'Paid on', width: 80 },
        { header: 'TDS paid', width: 85, ...R },
        { header: 'Interest paid', width: 85, ...R },
        { header: 'Still owed', width: 85, ...R },
        { header: 'Status', width: 80 },
      ];

      const byMonth = new Map<string, Challan[]>();
      for (const c of challans) {
        byMonth.set(c.period_month, [...(byMonth.get(c.period_month) ?? []), c]);
      }

      let tW = 0, tPaid = 0, tInt = 0, tOwed = 0;
      const rows: Array<Array<string | number>> = months.map((m) => {
        const cs = byMonth.get(m.month) ?? [];
        const paid = cs.reduce((t, c) => t + Number(c.amount ?? 0), 0);
        const intr = cs.reduce((t, c) => t + Number(c.interest_amount ?? 0), 0);
        tW += m.tds; tPaid += paid; tInt += intr; tOwed += m.outstanding;
        return [
          m.label,
          rs(m.tds),
          d(m.dueDate),
          cs.map((c) => c.challan_no ?? '-').join(', ') || '-',
          cs.length > 0 ? cs.map((c) => d(c.paid_date)).join(', ') : '-',
          paid > 0 ? rs(paid) : '-',
          intr > 0 ? rs(intr) : '-',
          m.outstanding > 0 ? rs(m.outstanding) : '-',
          // "Settled" covers a month paid within a rupee: the portal takes
          // whole rupees, so paise can never be remitted exactly.
          m.outstanding > 0 ? (m.overdue ? 'OVERDUE' : 'Due') : 'Settled',
        ];
      });
      rows.push(['TOTAL', rs(tW), '', '', '', rs(tPaid), rs(tInt), tOwed > 0 ? rs(tOwed) : '-', '']);

      y = drawTable(doc, left, y, cols, rows, true);

      doc.font('Helvetica').fontSize(8).fillColor('#64748b')
        .text(
          'Amounts withheld are computed on the taxable value of each bill, before GST. '
          + 'A month shows as settled once the challan covers it to within one rupee, because the '
          + 'portal accepts whole rupees only.',
          left, y + 2, { width: doc.page.width - left * 2 },
        );
      doc.text(`Generated ${d(todayISO())}. Figures as recorded in PPK TEX ERP.`,
        left, doc.y + 4);

      doc.end();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const today = todayISO();
  const fy = url.searchParams.get('fy') ?? financialYearOf(today.slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(fy)) {
    return NextResponse.json({ error: 'fy must look like 2026-27.' }, { status: 400 });
  }

  const supabase = await createClient();

  // Same loader as the TDS page — this route formats, it does not compute.
  const { months: allMonths } = await loadTdsMonths(supabase, today);
  const months = allMonths.filter((m) => financialYearOf(m.month) === fy);

  const paid = await fetchAll<Challan>((lo, hi) =>
    (supabase as unknown as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      from: (t: string) => any;
    }).from('tds_payment')
      .select('period_month, paid_date, challan_no, amount, interest_amount')
      .order('id', { ascending: true })
      .range(lo, hi));
  const challans = paid.rows.filter((c) => financialYearOf(c.period_month) === fy);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: cp } = await (supabase as any)
    .from('company_profile').select('legal_name, display_name, tan').limit(1).maybeSingle();
  const company = {
    name: (cp?.legal_name || cp?.display_name || 'PPK TEX') as string,
    tan: (cp?.tan ?? null) as string | null,
  };

  if (months.length === 0 && challans.length === 0) {
    return NextResponse.json(
      { error: `No TDS recorded in financial year ${fy}.` }, { status: 404 },
    );
  }

  const pdf = await buildPdf(fy, months, challans, company);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="tds-statement-${fy}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
