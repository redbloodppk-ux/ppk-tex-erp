/**
 * GET /api/wages/weekly/export?week=YYYY-MM-DD
 *
 * Returns a CSV download of the Weekly Wage Summary for the requested week.
 * The CSV has multiple sections separated by blank rows so the accountant
 * can open it in Excel and split or pivot freely:
 *   1. Header (FY label, week no, range, totals)
 *   2. Weekly-basis per-employee table
 *   3. Loom-shift basis per-employee table
 *   4. Metre-produced basis per-employee table
 *   5. All wage entries this week
 *   6. All expense entries this week
 */
import { NextResponse } from 'next/server';
import { buildWeeklyWageData, mondayISO } from '@/lib/wages/weekly-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isoOrNull(s: string | null): string | null {
  if (s === null) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Escape a single CSV field per RFC 4180. */
function csv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function row(cells: Array<string | number | null | undefined>): string {
  return cells.map(csv).join(',');
}

function money(n: number): string {
  // Plain number with two decimals — Excel-friendly, no rupee symbol noise.
  return (Math.round(n * 100) / 100).toFixed(2);
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const weekParam = isoOrNull(url.searchParams.get('week'));
  const weekStart = weekParam ?? mondayISO(new Date());

  const data = await buildWeeklyWageData(weekStart);

  const lines: string[] = [];

  // 1. Header.
  lines.push(row(['PPK TEX Weekly Wage Summary']));
  lines.push(row(['FY', data.fy_label, 'Week', data.week_no, 'Range', `${data.week_start} to ${data.week_end}`]));
  lines.push('');

  lines.push(row(['Totals']));
  lines.push(row(['Wages (settlements)', money(data.totals.wages)]));
  lines.push(row(['Advances', money(data.totals.advances)]));
  lines.push(row(['Adjustments', money(data.totals.adjustments)]));
  lines.push(row(['Same-day', money(data.totals.same_day)]));
  lines.push(row(['Expenses', money(data.totals.expenses)]));
  lines.push(row(['Net cash out', money(data.totals.net_cash_out)]));
  lines.push('');

  // 2. Weekly-basis employees.
  lines.push(row(['Weekly-basis employees']));
  lines.push(row([
    'Code', 'Name', 'Role',
    'Full salary', 'Absent days', 'Weaver-absent', 'Expected shift-sheds',
    'Covered sheds', 'Deduction', 'Book salary',
    'Wages paid', 'Advances', 'Adjustments', 'Net payable',
  ]));
  for (const p of data.per_employee) {
    const wagesPaid = data.wage_entries
      .filter((w) => w.employee_id === p.employee_id && (w.kind === 'settlement' || w.kind === 'same_day'))
      .reduce((acc, w) => acc + Number(w.amount ?? 0), 0);
    lines.push(row([
      p.code, p.full_name, p.role,
      money(p.full_salary),
      p.absent_days,
      p.weaver_absent_count,
      p.expected_shift_sheds,
      p.covered_sheds.join(' '),
      money(p.absent_deduction),
      money(p.book_salary),
      money(wagesPaid),
      money(p.advances),
      money(p.adjustments),
      money(p.net_payable),
    ]));
  }
  lines.push('');

  // 3. Loom-shift basis employees.
  lines.push(row(['Loom-shift basis employees']));
  lines.push(row(['Code', 'Name', 'Wages paid', 'Advances', 'Adjustments', 'Net payable']));
  for (const p of data.loom_shift_employees) {
    lines.push(row([
      p.code, p.full_name,
      money(p.wages_paid), money(p.advances), money(p.adjustments), money(p.net_payable),
    ]));
  }
  lines.push('');

  // 4. Metre-produced basis employees.
  lines.push(row(['Metre-produced basis employees']));
  lines.push(row(['Code', 'Name', 'Wages paid', 'Advances', 'Adjustments', 'Net payable']));
  for (const p of data.metre_employees) {
    lines.push(row([
      p.code, p.full_name,
      money(p.wages_paid), money(p.advances), money(p.adjustments), money(p.net_payable),
    ]));
  }
  lines.push('');

  // 5. Wage entries.
  lines.push(row(['All wage entries this week']));
  lines.push(row(['Pay date', 'Employee code', 'Employee name', 'Kind', 'Period start', 'Period end', 'Amount', 'Notes']));
  for (const w of data.wage_entries) {
    lines.push(row([
      w.pay_date, w.employee_code, w.employee_name, w.kind,
      w.period_start, w.period_end, money(Number(w.amount ?? 0)), w.notes ?? '',
    ]));
  }
  lines.push('');

  // 6. Expenses.
  lines.push(row(['Expenses this week']));
  lines.push(row(['Pay date', 'Category', 'Amount', 'Notes']));
  for (const e of data.expenses) {
    lines.push(row([
      e.pay_date, e.category, money(Number(e.amount ?? 0)), e.notes ?? '',
    ]));
  }

  // Prepend BOM so Excel detects UTF-8 (preserves any non-ASCII names).
  const body = '\uFEFF' + lines.join('\r\n') + '\r\n';

  const safeFy = data.fy_label.replace(/[^\w-]+/g, '_') || 'FY';
  const filename = `wages-${safeFy}-W${String(data.week_no).padStart(2, '0')}-${data.week_start}.csv`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
