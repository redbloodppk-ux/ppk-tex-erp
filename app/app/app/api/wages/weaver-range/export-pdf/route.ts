/**
 * GET /app/api/wages/weaver-range/export-pdf?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Weaver wages across a date range as an A4-landscape PDF: a totals table
 * per weaver, then the week-by-week detail behind it.
 *
 * PPK, 2026-09-02: "we need available date range download option for Weaver
 * Wages only." Weavers only — the metre-basis section. Loom-shift and
 * weekly staff are deliberately absent.
 *
 * PDFKit's Helvetica has no rupee glyph, so amounts read "Rs." — same
 * convention as the weekly wage PDF beside this one.
 */
import { NextResponse } from 'next/server';
import PDFDocument from 'pdfkit';
import { buildWeaverRangeData, type WeaverRangeData } from '@/lib/wages/weaver-range-data';
import { createClient } from '@/lib/supabase/server';
import { recordDateBounds, clampDate, SOURCES } from '@/lib/reports/record-bounds';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isoOrNull(s: string | null): string | null {
  if (s === null) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function rs(n: number): string {
  const v = Math.round(n * 100) / 100;
  try {
    return 'Rs. ' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return 'Rs. ' + v.toFixed(2);
  }
}

/** 2026-08-31 -> 31-Aug-2026, so a date is never misread as month-first. */
function d(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${m[3]}-${months[Number(m[2]) - 1]}-${m[1]}`;
}

interface Col { header: string; width: number; align?: 'left' | 'right' }

/** Banded table that pages itself. Lifted deliberately from the weekly
 *  wage PDF so both documents look like the same mill produced them. */
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
  const totalW = cols.reduce((a, c) => a + c.width, 0);
  let y = startY;

  const drawHeader = (): void => {
    doc.save();
    doc.rect(startX, y, totalW, headerHeight).fill('#e2e8f0');
    doc.restore();
    doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(9);
    let x = startX;
    for (const c of cols) {
      doc.text(c.header, x + 4, y + 5, { width: c.width - 8, align: c.align ?? 'left', lineBreak: false });
      x += c.width;
    }
    y += headerHeight;
  };

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
      doc.rect(startX, y, totalW, rowHeight).fill('#f8fafc');
      doc.restore();
      doc.fillColor('#0f172a');
    }
    let x = startX;
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      if (!col) continue;
      const cell = r[i];
      doc.text(cell === undefined || cell === null ? '' : String(cell), x + 4, y + 4, {
        width: col.width - 8, align: col.align ?? 'left', lineBreak: false,
      });
      x += col.width;
    }
    y += rowHeight;
    zebra = !zebra;
  }
  doc.moveTo(startX, y).lineTo(startX + totalW, y)
    .strokeColor('#cbd5e1').lineWidth(0.5).stroke();
  return y + 8;
}

function buildPdf(data: WeaverRangeData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      doc.font('Helvetica-Bold').fontSize(15).fillColor('#0f172a')
        .text('Weaver Wages', left, doc.page.margins.top);
      doc.font('Helvetica').fontSize(10).fillColor('#475569')
        .text(`${d(data.from)} to ${d(data.to)}  ·  ${data.weeks.length} weeks  ·  ${data.totals.length} weavers`);
      let y = doc.y + 12;

      const R = { align: 'right' as const };
      const totalCols: Col[] = [
        { header: 'Weaver', width: 130 },
        { header: 'Code', width: 70 },
        { header: 'Weeks', width: 50, ...R },
        { header: 'Wages earned', width: 95, ...R },
        { header: 'Paid', width: 85, ...R },
        { header: 'Advances', width: 85, ...R },
        { header: 'Adjustments', width: 85, ...R },
        { header: 'Extra work', width: 85, ...R },
        { header: 'Net payable', width: 95, ...R },
      ];
      const totalRows = data.totals.map((t) => [
        t.full_name, t.code, t.weeks,
        rs(t.wages_earned), rs(t.wages_paid), rs(t.advances),
        rs(t.adjustments), rs(t.extra_work), rs(t.net_payable),
      ]);
      totalRows.push([
        'TOTAL', '', data.totals.reduce((a, t) => a + t.weeks, 0),
        rs(data.grand.wages_earned), rs(data.grand.wages_paid), rs(data.grand.advances),
        rs(data.grand.adjustments), rs(data.grand.extra_work), rs(data.grand.net_payable),
      ]);

      doc.font('Helvetica-Bold').fontSize(11).fillColor('#1e293b').text('Totals per weaver', left, y);
      y = drawTable(doc, left, y + 16, totalCols, totalRows);

      if (data.rows.length > 0) {
        doc.addPage();
        y = doc.page.margins.top;
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#1e293b').text('Week by week', left, y);
        const weekCols: Col[] = [
          { header: 'Weaver', width: 120 },
          { header: 'Week from', width: 80 },
          { header: 'Week to', width: 80 },
          { header: 'Wages earned', width: 95, ...R },
          { header: 'Paid', width: 85, ...R },
          { header: 'Advances', width: 85, ...R },
          { header: 'Adjustments', width: 85, ...R },
          { header: 'Extra work', width: 80, ...R },
          { header: 'Net payable', width: 90, ...R },
        ];
        y = drawTable(doc, left, y + 16, weekCols, data.rows.map((r) => [
          r.full_name, d(r.week_start), d(r.week_end),
          rs(r.wages_earned), rs(r.wages_paid), rs(r.advances),
          rs(r.adjustments), rs(r.extra_work), rs(r.net_payable),
        ]));
      }

      doc.end();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const fromRaw = isoOrNull(url.searchParams.get('from'));
  const toRaw = isoOrNull(url.searchParams.get('to'));
  if (!fromRaw || !toRaw) {
    return NextResponse.json({ error: 'from and to are required (YYYY-MM-DD).' }, { status: 400 });
  }
  if (toRaw < fromRaw) {
    return NextResponse.json({ error: 'The To date is before the From date.' }, { status: 400 });
  }

  const supabase = await createClient();
  const bounds = await recordDateBounds(supabase, SOURCES.production);
  const from = clampDate(fromRaw, bounds);
  const to = clampDate(toRaw, bounds);

  const data = await buildWeaverRangeData(from, to);
  const pdf = await buildPdf(data);
  const filename = `weaver-wages-${from}-to-${to}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
