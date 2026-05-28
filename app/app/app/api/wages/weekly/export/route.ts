/**
 * GET /api/wages/weekly/export?week=YYYY-MM-DD
 *
 * Returns a styled multi-sheet .xlsx workbook of the Weekly Wage Summary.
 * The workbook has six tabs at the bottom so each section opens cleanly
 * without manual splitting:
 *   1. Totals               — header row + the six totals lines
 *   2. Weekly-basis         — per-employee weekly-salary breakdown
 *   3. Loom-shift           — per-worker loom-shift wage breakdown
 *   4. Metre                — per-worker metre-produced wage breakdown
 *   5. Wage entries         — every wage entry posted in the week
 *   6. Expenses             — every expense entry posted in the week
 *
 * Every sheet uses the project's styled-cell formats (bold grey header,
 * frozen top row, rupee/number/date number formats, TOTAL footer where
 * appropriate) via lib/xlsx.ts — no external dependencies.
 */
import { NextResponse } from 'next/server';
import { buildXlsxWorkbook, type ExcelColumn, type SheetSpec } from '@/lib/xlsx';
import { buildWeeklyWageData, mondayISO } from '@/lib/wages/weekly-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isoOrNull(s: string | null): string | null {
  if (s === null) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const weekParam = isoOrNull(url.searchParams.get('week'));
  const weekStart = weekParam ?? mondayISO(new Date());

  const data = await buildWeeklyWageData(weekStart);

  /* ───── Sheet 1 — Totals ───── */
  const totalsColumns: ExcelColumn[] = [
    { key: 'label', label: 'Item', width: 28 },
    { key: 'amount', label: 'Amount', type: 'rupee', width: 18 },
  ];
  const totalsRows: Array<Record<string, unknown>> = [
    { label: 'FY label', amount: data.fy_label },
    { label: 'Week number', amount: data.week_no },
    { label: 'Week start', amount: data.week_start },
    { label: 'Week end', amount: data.week_end },
    { label: '', amount: '' },
    { label: 'Wages (settlements)', amount: data.totals.wages },
    { label: 'Advances', amount: data.totals.advances },
    { label: 'Adjustments', amount: data.totals.adjustments },
    { label: 'Same-day', amount: data.totals.same_day },
    { label: 'Expenses', amount: data.totals.expenses },
    { label: 'Net cash out', amount: data.totals.net_cash_out },
  ];
  const totalsSheet: SheetSpec = {
    sheetName: 'Totals',
    title: 'PPK TEX — Weekly Wage Summary (' + data.fy_label + ' W' + data.week_no + ')',
    columns: totalsColumns,
    rows: totalsRows,
  };

  /* ───── Sheet 2 — Weekly-basis employees ───── */
  const weeklyColumns: ExcelColumn[] = [
    { key: 'code', label: 'Code', width: 10 },
    { key: 'full_name', label: 'Name', width: 22 },
    { key: 'role', label: 'Role', width: 12 },
    { key: 'full_salary', label: 'Full salary', type: 'rupee', width: 14, total: true },
    { key: 'absent_days', label: 'Absent days', type: 'number', width: 12 },
    { key: 'weaver_absent_count', label: 'Weaver-absent', type: 'number', width: 14 },
    { key: 'expected_shift_sheds', label: 'Expected shift-sheds', type: 'number', width: 18 },
    { key: 'covered_sheds', label: 'Covered sheds', width: 20 },
    { key: 'absent_deduction', label: 'Deduction', type: 'rupee', width: 13, total: true },
    { key: 'book_salary', label: 'Book salary', type: 'rupee', width: 14, total: true },
    { key: 'wages_paid', label: 'Wages paid', type: 'rupee', width: 13, total: true },
    { key: 'advances', label: 'Advances', type: 'rupee', width: 12, total: true },
    { key: 'adjustments', label: 'Adjustments', type: 'rupee', width: 13, total: true },
    { key: 'net_payable', label: 'Net payable', type: 'rupee', width: 14, total: true },
  ];
  const weeklyRows: Array<Record<string, unknown>> = data.per_employee.map((p) => {
    const wagesPaid = data.wage_entries
      .filter(
        (w) =>
          w.employee_id === p.employee_id &&
          (w.kind === 'settlement' || w.kind === 'same_day'),
      )
      .reduce((acc, w) => acc + Number(w.amount ?? 0), 0);
    return {
      code: p.code,
      full_name: p.full_name,
      role: p.role,
      full_salary: p.full_salary,
      absent_days: p.absent_days,
      weaver_absent_count: p.weaver_absent_count,
      expected_shift_sheds: p.expected_shift_sheds,
      covered_sheds: p.covered_sheds.join(' '),
      absent_deduction: p.absent_deduction,
      book_salary: p.book_salary,
      wages_paid: wagesPaid,
      advances: p.advances,
      adjustments: p.adjustments,
      net_payable: p.net_payable,
    };
  });
  const weeklySheet: SheetSpec = {
    sheetName: 'Weekly-basis',
    columns: weeklyColumns,
    rows: weeklyRows,
  };

  /* ───── Sheet 3 — Loom-shift basis employees ───── */
  const perWorkerColumns: ExcelColumn[] = [
    { key: 'code', label: 'Code', width: 10 },
    { key: 'full_name', label: 'Name', width: 22 },
    { key: 'wages_paid', label: 'Wages paid', type: 'rupee', width: 14, total: true },
    { key: 'advances', label: 'Advances', type: 'rupee', width: 12, total: true },
    { key: 'adjustments', label: 'Adjustments', type: 'rupee', width: 13, total: true },
    { key: 'net_payable', label: 'Net payable', type: 'rupee', width: 14, total: true },
  ];
  const loomShiftSheet: SheetSpec = {
    sheetName: 'Loom-shift',
    columns: perWorkerColumns,
    rows: data.loom_shift_employees.map((p) => ({
      code: p.code,
      full_name: p.full_name,
      wages_paid: p.wages_paid,
      advances: p.advances,
      adjustments: p.adjustments,
      net_payable: p.net_payable,
    })),
  };

  /* ───── Sheet 4 — Metre-produced basis employees ───── */
  const metreSheet: SheetSpec = {
    sheetName: 'Metre',
    columns: perWorkerColumns,
    rows: data.metre_employees.map((p) => ({
      code: p.code,
      full_name: p.full_name,
      wages_paid: p.wages_paid,
      advances: p.advances,
      adjustments: p.adjustments,
      net_payable: p.net_payable,
    })),
  };

  /* ───── Sheet 5 — All wage entries this week ───── */
  const wageEntriesSheet: SheetSpec = {
    sheetName: 'Wage entries',
    columns: [
      { key: 'pay_date', label: 'Pay date', type: 'date', width: 13 },
      { key: 'employee_code', label: 'Code', width: 10 },
      { key: 'employee_name', label: 'Employee name', width: 22 },
      { key: 'kind', label: 'Kind', width: 13 },
      { key: 'period_start', label: 'Period start', type: 'date', width: 13 },
      { key: 'period_end', label: 'Period end', type: 'date', width: 13 },
      { key: 'amount', label: 'Amount', type: 'rupee', width: 14, total: true },
      { key: 'notes', label: 'Notes', width: 30 },
    ],
    rows: data.wage_entries.map((w) => ({
      pay_date: w.pay_date,
      employee_code: w.employee_code,
      employee_name: w.employee_name,
      kind: w.kind,
      period_start: w.period_start,
      period_end: w.period_end,
      amount: Number(w.amount ?? 0),
      notes: w.notes ?? '',
    })),
  };

  /* ───── Sheet 6 — Expenses this week ───── */
  const expensesSheet: SheetSpec = {
    sheetName: 'Expenses',
    columns: [
      { key: 'pay_date', label: 'Pay date', type: 'date', width: 13 },
      { key: 'category', label: 'Category', width: 22 },
      { key: 'amount', label: 'Amount', type: 'rupee', width: 14, total: true },
      { key: 'notes', label: 'Notes', width: 40 },
    ],
    rows: data.expenses.map((e) => ({
      pay_date: e.pay_date,
      category: e.category,
      amount: Number(e.amount ?? 0),
      notes: e.notes ?? '',
    })),
  };

  const workbook = buildXlsxWorkbook({
    sheets: [
      totalsSheet,
      weeklySheet,
      loomShiftSheet,
      metreSheet,
      wageEntriesSheet,
      expensesSheet,
    ],
  });

  const safeFy = data.fy_label.replace(/[^\w-]+/g, '_') || 'FY';
  const filename = 'wages-' + safeFy + '-W' + String(data.week_no).padStart(2, '0') + '-' + data.week_start + '.xlsx';

  return new NextResponse(new Uint8Array(workbook), {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="' + filename + '"',
      'Cache-Control': 'no-store',
    },
  });
}
    },
  });
}
