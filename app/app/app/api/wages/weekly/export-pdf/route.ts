/**
 * GET /api/wages/weekly/export-pdf?week=YYYY-MM-DD
 *
 * Returns an A4-landscape PDF of the Weekly Wage Summary for the requested
 * week. The PDF mirrors the CSV sections but is laid out for printing /
 * sharing with the accountant:
 *   - Header (FY label, week no, range)
 *   - Totals strip
 *   - Weekly-basis employees table
 *   - Loom-shift and Metre-produced employee tables
 *   - All wage entries + expenses
 *
 * PDFKit's default Helvetica font does not include the Indian rupee glyph,
 * so we render amounts with the "Rs." prefix instead of ₹.
 */
import { NextResponse } from 'next/server';
import PDFDocument from 'pdfkit';
import { buildWeeklyWageData, mondayISO, type WeeklyData } from '@/lib/wages/weekly-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isoOrNull(s: string | null): string | null {
  if (s === null) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function rs(n: number): string {
  const v = Math.round(n * 100) / 100;
  // Indian grouping (1,23,456.78). Falls back to plain if Intl unavailable.
  try {
    return 'Rs. ' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return 'Rs. ' + v.toFixed(2);
  }
}

interface Col {
  header: string;
  width: number;
  align?: 'left' | 'right';
}

/**
 * Draw a simple banded table. Returns the y-coordinate AFTER the table.
 * Pages itself automatically if the next row would overflow the bottom.
 */
function drawTable(
  doc: PDFKit.PDFDocument,
  startX: number,
  startY: number,
  cols: Col[],
  rows: Array<Array<string | number>>,
): number {
  const headerHeight = 18;
  const rowHeight = 16;
  const bottomMargin = 30;

  let y = startY;

  function drawHeader(): void {
    doc.save();
    doc.rect(startX, y, cols.reduce((a, c) => a + c.width, 0), headerHeight)
      .fill('#e2e8f0');
    doc.restore();
    doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(9);
    let x = startX;
    for (const c of cols) {
      doc.text(c.header, x + 4, y + 5, {
        width: c.width - 8,
        align: c.align ?? 'left',
        lineBreak: false,
      });
      x += c.width;
    }
    y += headerHeight;
  }

  drawHeader();

  doc.font('Helvetica').fontSize(8.5).fillColor('#0f172a');
  let zebra = false;
  for (const r of rows) {
    if (y + rowHeight > doc.page.height - bottomMargin) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeader();
      doc.font('Helvetica').fontSize(8.5).fillColor('#0f172a');
      zebra = false;
    }
    if (zebra) {
      doc.save();
      doc.rect(startX, y, cols.reduce((a, c) => a + c.width, 0), rowHeight)
        .fill('#f8fafc');
      doc.restore();
      doc.fillColor('#0f172a');
    }
    let x = startX;
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      if (!col) continue;
      const cell = r[i];
      doc.text(cell === undefined || cell === null ? '' : String(cell), x + 4, y + 4, {
        width: col.width - 8,
        align: col.align ?? 'left',
        lineBreak: false,
      });
      x += col.width;
    }
    y += rowHeight;
    zebra = !zebra;
  }

  // Bottom border.
  doc.moveTo(startX, y)
    .lineTo(startX + cols.reduce((a, c) => a + c.width, 0), y)
    .strokeColor('#cbd5e1')
    .lineWidth(0.5)
    .stroke();

  return y + 8;
}

function ensureSpace(doc: PDFKit.PDFDocument, y: number, needed: number): number {
  const bottom = doc.page.height - 30;
  if (y + needed > bottom) {
    doc.addPage();
    return doc.page.margins.top;
  }
  return y;
}

function sectionHeader(doc: PDFKit.PDFDocument, title: string, y: number): number {
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#1e293b')
    .text(title, doc.page.margins.left, y);
  return y + 16;
}

function buildPdf(data: WeeklyData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margins: { top: 36, bottom: 36, left: 36, right: 36 },
        info: {
          Title: `Weekly Wages ${data.fy_label} W${data.week_no}`,
          Author: 'PPK TEX ERP',
          Subject: `${data.week_start} to ${data.week_end}`,
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ---- Header ----
      doc.font('Helvetica-Bold').fontSize(16).fillColor('#0f172a')
        .text('PPK TEX', doc.page.margins.left, doc.page.margins.top);
      doc.font('Helvetica').fontSize(11).fillColor('#475569')
        .text('Weekly Wage Summary', doc.page.margins.left, doc.page.margins.top + 19);
      const headerRight = `${data.fy_label}  ·  Week ${data.week_no}  ·  ${data.week_start} to ${data.week_end}`;
      doc.font('Helvetica').fontSize(10).fillColor('#0f172a')
        .text(headerRight, doc.page.margins.left, doc.page.margins.top + 36, {
          width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
          align: 'right',
        });

      let y = doc.page.margins.top + 56;

      // ---- Totals strip ----
      const tiles: Array<{ label: string; value: number; emph?: boolean }> = [
        { label: 'Wages (settlements)', value: data.totals.wages },
        { label: 'Advances', value: data.totals.advances },
        { label: 'Adjustments', value: data.totals.adjustments },
        { label: 'Same-day', value: data.totals.same_day },
        { label: 'Expenses', value: data.totals.expenses },
        { label: 'Net cash out', value: data.totals.net_cash_out, emph: true },
      ];
      const tileWidth = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / tiles.length;
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        if (!t) continue;
        const x = doc.page.margins.left + i * tileWidth;
        doc.save();
        doc.rect(x + 2, y, tileWidth - 4, 40)
          .fill(t.emph ? '#eef2ff' : '#f1f5f9');
        doc.restore();
        doc.font('Helvetica').fontSize(7.5).fillColor(t.emph ? '#4338ca' : '#64748b')
          .text(t.label.toUpperCase(), x + 8, y + 6, { width: tileWidth - 16, lineBreak: false });
        doc.font('Helvetica-Bold').fontSize(11).fillColor(t.emph ? '#3730a3' : '#0f172a')
          .text(rs(t.value), x + 8, y + 19, { width: tileWidth - 16, lineBreak: false });
      }
      y += 52;

      // ---- Weekly-basis employees ----
      y = ensureSpace(doc, y, 60);
      y = sectionHeader(doc, 'Weekly-basis employees', y);
      const weeklyCols: Col[] = [
        { header: 'Code', width: 50 },
        { header: 'Name', width: 110 },
        { header: 'Role', width: 50 },
        { header: 'Full salary', width: 65, align: 'right' },
        { header: 'Abs / W-abs', width: 65, align: 'right' },
        { header: 'Deduction', width: 65, align: 'right' },
        { header: 'Book salary', width: 70, align: 'right' },
        { header: 'Wages paid', width: 70, align: 'right' },
        { header: 'Advances', width: 60, align: 'right' },
        { header: 'Adjust.', width: 55, align: 'right' },
        { header: 'Net payable', width: 70, align: 'right' },
      ];
      const weeklyRows = data.per_employee.map((p) => {
        const role = (p.role ?? '').toLowerCase();
        const absCol = role === 'fitter'
          ? `${p.absent_days} d`
          : role === 'winder'
            ? `${p.weaver_absent_count} / ${p.expected_shift_sheds}`
            : '—';
        const wagesPaid = data.wage_entries
          .filter((w) => w.employee_id === p.employee_id && (w.kind === 'settlement' || w.kind === 'same_day'))
          .reduce((acc, w) => acc + Number(w.amount ?? 0), 0);
        // Deduction cell: gross deduction for absent/weaver-gap, plus a
        // reallocation credit line for substitutes who covered others.
        let dedCol: string;
        if (role === 'winder' && p.reallocated_in > 0) {
          dedCol = p.absent_deduction > 0
            ? `-${rs(p.absent_deduction)} / +${rs(p.reallocated_in)}`
            : '+' + rs(p.reallocated_in);
        } else {
          dedCol = p.absent_deduction > 0 ? '-' + rs(p.absent_deduction) : '—';
        }
        return [
          p.code,
          p.full_name,
          p.role,
          rs(p.full_salary),
          absCol,
          dedCol,
          rs(p.book_salary),
          rs(wagesPaid),
          rs(p.advances),
          rs(p.adjustments),
          rs(p.net_payable),
        ];
      });
      if (weeklyRows.length === 0) weeklyRows.push(['—', 'No weekly-basis employees', '', '', '', '', '', '', '', '', '']);
      y = drawTable(doc, doc.page.margins.left, y, weeklyCols, weeklyRows);

      // ---- Loom-shift basis ----
      y = ensureSpace(doc, y, 60);
      y = sectionHeader(doc, 'Loom-shift basis employees', y);
      const workerCols: Col[] = [
        { header: 'Code', width: 60 },
        { header: 'Name', width: 200 },
        { header: 'Wages paid', width: 90, align: 'right' },
        { header: 'Advances', width: 90, align: 'right' },
        { header: 'Adjustments', width: 90, align: 'right' },
        { header: 'Net payable', width: 90, align: 'right' },
      ];
      const loomRows = data.loom_shift_employees.map((p) => [
        p.code, p.full_name,
        rs(p.wages_paid), rs(p.advances), rs(p.adjustments), rs(p.net_payable),
      ]);
      if (loomRows.length === 0) loomRows.push(['—', 'No loom-shift basis employees', '', '', '', '']);
      y = drawTable(doc, doc.page.margins.left, y, workerCols, loomRows);

      // ---- Weaver Wages (metre basis) ----
      y = ensureSpace(doc, y, 60);
      y = sectionHeader(doc, 'Weaver Wages', y);
      const weaverWageCols: Col[] = [
        { header: 'Code', width: 55 },
        { header: 'Name', width: 175 },
        { header: 'Wages earned', width: 85, align: 'right' },
        { header: 'Wages paid', width: 75, align: 'right' },
        { header: 'Advances', width: 70, align: 'right' },
        { header: 'Adjustments', width: 80, align: 'right' },
        { header: 'Net payable', width: 80, align: 'right' },
      ];
      const metreRows = data.metre_employees.map((p) => [
        p.code, p.full_name,
        rs(p.wages_earned),
        rs(p.wages_paid), rs(p.advances), rs(p.adjustments), rs(p.net_payable),
      ]);
      if (metreRows.length === 0) metreRows.push(['—', 'No weaver-wage employees', '', '', '', '', '']);
      y = drawTable(doc, doc.page.margins.left, y, weaverWageCols, metreRows);

      // ---- Wage entries ----
      y = ensureSpace(doc, y, 60);
      y = sectionHeader(doc, 'All wage entries this week', y);
      const wageCols: Col[] = [
        { header: 'Pay date', width: 70 },
        { header: 'Code', width: 50 },
        { header: 'Employee', width: 150 },
        { header: 'Kind', width: 65 },
        { header: 'Period', width: 130 },
        { header: 'Amount', width: 80, align: 'right' },
        { header: 'Notes', width: 225 },
      ];
      const wageRows = data.wage_entries.map((w) => [
        w.pay_date, w.employee_code, w.employee_name, w.kind,
        `${w.period_start} – ${w.period_end}`,
        rs(Number(w.amount ?? 0)),
        w.notes ?? '',
      ]);
      if (wageRows.length === 0) wageRows.push(['—', '', 'No wage entries', '', '', '', '']);
      y = drawTable(doc, doc.page.margins.left, y, wageCols, wageRows);

      // ---- Expenses ----
      y = ensureSpace(doc, y, 60);
      y = sectionHeader(doc, 'Expenses this week', y);
      const expCols: Col[] = [
        { header: 'Pay date', width: 80 },
        { header: 'Category', width: 150 },
        { header: 'Amount', width: 100, align: 'right' },
        { header: 'Notes', width: 440 },
      ];
      const expRows = data.expenses.map((e) => [
        e.pay_date, e.category, rs(Number(e.amount ?? 0)), e.notes ?? '',
      ]);
      if (expRows.length === 0) expRows.push(['—', 'No expenses', '', '']);
      y = drawTable(doc, doc.page.margins.left, y, expCols, expRows);

      // Footer on every page.
      const pageRange = doc.bufferedPageRange();
      for (let i = 0; i < pageRange.count; i++) {
        doc.switchToPage(pageRange.start + i);
        doc.font('Helvetica').fontSize(7.5).fillColor('#94a3b8')
          .text(
            `Generated ${new Date().toISOString().slice(0, 19).replace('T', ' ')} · Page ${i + 1} of ${pageRange.count}`,
            doc.page.margins.left,
            doc.page.height - 22,
            {
              width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
              align: 'center',
              lineBreak: false,
            },
          );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const weekParam = isoOrNull(url.searchParams.get('week'));
  const weekStart = weekParam ?? mondayISO(new Date());

  const data = await buildWeeklyWageData(weekStart);

  let pdf: Buffer;
  try {
    pdf = await buildPdf(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'PDF generation failed.';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  const safeFy = data.fy_label.replace(/[^\w-]+/g, '_') || 'FY';
  const filename = `wages-${safeFy}-W${String(data.week_no).padStart(2, '0')}-${data.week_start}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(pdf.length),
      'Cache-Control': 'no-store',
    },
  });
}
