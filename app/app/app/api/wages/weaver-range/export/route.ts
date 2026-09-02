/**
 * GET /app/api/wages/weaver-range/export?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Weaver wages across a date range as a styled .xlsx, one row per weaver
 * per week plus a per-weaver total and a grand total.
 *
 * PPK, 2026-09-02: "we need available date range download option for Weaver
 * Wages only." The Weekly Wage Summary is locked to a single week, which is
 * right for paying people and no use for looking back over a season.
 *
 * Weavers only — the metre-basis section. Loom-shift and weekly employees
 * are deliberately absent; he asked for weavers and a report that quietly
 * includes more than its title says is worse than one that includes less.
 */
import { NextResponse } from 'next/server';
import { buildXlsxWorkbook, type ExcelColumn, type SheetSpec } from '@/lib/xlsx';
import { buildWeaverRangeData } from '@/lib/wages/weaver-range-data';
import { createClient } from '@/lib/supabase/server';
import { recordDateBounds, clampDate, SOURCES } from '@/lib/reports/record-bounds';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// One round of queries per week in the range, so a long range is genuinely
// slow. See the note in weaver-range-data on why it is done that way.
export const maxDuration = 60;

function isoOrNull(s: string | null): string | null {
  if (s === null) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
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

  // Clamp to the dates that have records. Without it a range reaching back
  // before the books produces week after week of empty rows and a total
  // that looks like a real, low figure.
  const supabase = await createClient();
  const bounds = await recordDateBounds(supabase, SOURCES.production);
  const from = clampDate(fromRaw, bounds);
  const to = clampDate(toRaw, bounds);

  const data = await buildWeaverRangeData(from, to);

  // `total: true` marks the columns that get a TOTAL footer; the label
  // lands in the first text column on its own.
  const money = (key: string, label: string, width = 15): ExcelColumn =>
    ({ key, label, type: 'rupee', width, total: true });

  const weekColumns: ExcelColumn[] = [
    { key: 'full_name',  label: 'Weaver',    width: 24 },
    { key: 'code',       label: 'Code',      width: 12 },
    { key: 'week_start', label: 'Week from', type: 'date', width: 14 },
    { key: 'week_end',   label: 'Week to',   type: 'date', width: 14 },
    money('wages_earned', 'Wages earned', 16),
    money('wages_paid',   'Paid'),
    money('advances',     'Advances'),
    money('adjustments',  'Adjustments'),
    money('extra_work',   'Extra work'),
    money('net_payable',  'Net payable', 16),
  ];

  const totalColumns: ExcelColumn[] = [
    { key: 'full_name', label: 'Weaver', width: 24 },
    { key: 'code',      label: 'Code',   width: 12 },
    { key: 'weeks',     label: 'Weeks',  type: 'number', width: 10, total: true },
    money('wages_earned', 'Wages earned', 16),
    money('wages_paid',   'Paid'),
    money('advances',     'Advances'),
    money('adjustments',  'Adjustments'),
    money('extra_work',   'Extra work'),
    money('net_payable',  'Net payable', 16),
  ];

  const sheets: SheetSpec[] = [
    {
      sheetName: 'Weaver totals',
      title: `Weaver wages ${data.from} to ${data.to}`,
      columns: totalColumns,
      rows: data.totals as unknown as Array<Record<string, unknown>>,
    },
    {
      sheetName: 'Per week',
      title: `Week by week ${data.from} to ${data.to}`,
      columns: weekColumns,
      rows: data.rows as unknown as Array<Record<string, unknown>>,
    },
    {
      sheetName: 'Range',
      columns: [
        { key: 'label', label: 'Item', width: 26 },
        { key: 'value', label: 'Value', width: 22 },
      ],
      rows: [
        { label: 'From', value: data.from },
        { label: 'To', value: data.to },
        { label: 'Weeks covered', value: data.weeks.length },
        { label: 'Weavers with activity', value: data.totals.length },
        { label: '', value: '' },
        { label: 'Wages earned', value: data.grand.wages_earned },
        { label: 'Paid', value: data.grand.wages_paid },
        { label: 'Advances', value: data.grand.advances },
        { label: 'Adjustments', value: data.grand.adjustments },
        { label: 'Extra work', value: data.grand.extra_work },
        { label: 'Net payable', value: data.grand.net_payable },
      ],
    },
  ];

  const workbook = buildXlsxWorkbook({ sheets });
  const filename = `weaver-wages-${data.from}-to-${data.to}.xlsx`;

  return new NextResponse(new Uint8Array(workbook), {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
