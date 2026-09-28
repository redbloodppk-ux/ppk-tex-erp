/**
 * Notification sources — CORR-H6 (v1.1)
 *
 * Notifications are *derived* from existing tables, not persisted in
 * their own table. Sources:
 *   - Bills due (receivable) — one item per customer with unpaid /
 *     part-paid sale invoices: total pending amount + bill count.
 *   - Bills due (payable)    — one item per jobwork party with unpaid
 *     weaver bills we still owe.
 *   - Pending costing approvals — costing_master.approval_status='pending'.
 *   - Reminders due/overdue — reminder table, status='active' and
 *     due_date <= today. Upcoming (not-yet-due) reminders are left out of
 *     the bell on purpose; they only show on the dashboard widget.
 *
 * Yarn low-stock was removed by request (12-06-2026) — the operator
 * tracks cover from the Days-of-Cover report instead.
 *
 * "Clear all": the notification_clear table stores ONE timestamp per
 * user. Items whose occurred_at <= cleared_at are hidden; anything that
 * happens after the clear (new bill, new pending costing) reappears.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchCategoryLabelMap } from '@/lib/reminders/constants';
import {
  loadUnrecordedShifts, describeShift, todayISO,
} from '@/lib/attendance/unrecorded-shifts';
import { loadTdsMonths, daysUntil } from '@/lib/tds/liability-data';
import { formatDay, todayIST } from '@/lib/utils';

export type NotificationKind =
  | 'costing_approval' | 'bill_due' | 'reminder' | 'attendance_gap'
  | 'tds_overdue' | 'dc_receipt_mismatch' | 'quality_mismatch';

/** Kinds that "Clear all" must NOT hide.
 *
 *  Clear-all is for news you have read. An unrecorded shift is not news -
 *  it is an unanswered question that silently changes wages, and it stays
 *  wrong until somebody records the shift or marks it a holiday. Hiding it
 *  on a tap would put it straight back into the blind spot that let four
 *  of them through unnoticed. It disappears when it is FIXED, not when it
 *  is dismissed. */
const UNCLEARABLE: ReadonlySet<NotificationKind> = new Set([
  'attendance_gap',
  // Overdue TDS costs 1.5% more every month it is ignored. Dismissing it
  // would hide a bill that is actively growing.
  'tds_overdue',
  // Stock is wrong until the receipt is re-saved; dismissing hides it.
  'dc_receipt_mismatch',
]);

export interface NotificationItem {
  /** Stable composite id for keys + dedup. Not a DB row id. */
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** Click target — opens the page where the operator can act on it. */
  link: string;
  /** ISO timestamp this notification "happened" — sorts the feed and
   *  drives Clear-all (items at or before cleared_at are hidden). */
  occurred_at: string;
  /** Visual severity. The bell colours the dot by the worst pending item. */
  severity: 'info' | 'warn' | 'critical';
}

export interface NotificationFeed {
  total: number;
  worstSeverity: 'info' | 'warn' | 'critical' | null;
  items: NotificationItem[];
}

const RECEIVABLE_DOC_TYPES = ['tax_invoice', 'yarn_sale', 'general_sale'];
const PAYABLE_DOC_TYPES    = ['jobwork_invoice', 'weaving_bill'];

function formatINR(n: number): string {
  return '\u20B9' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

/** Pull every active notification, minus anything the user cleared. */
export async function fetchNotifications(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public', any>,
): Promise<NotificationFeed> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const [pendingApprovals, billDues, dueReminders, attendanceGaps, tdsOverdue, dcMismatch, qualityMismatch, clearedAt] =
    await Promise.all([
      fetchPendingApprovals(sb),
      fetchBillDues(sb),
      fetchDueReminders(sb),
      fetchAttendanceGaps(sb),
      fetchTdsOverdue(sb),
      fetchDcReceiptMismatch(sb),
      fetchQualityMismatch(sb),
      fetchClearedAt(sb),
    ]);

  const items = [
    ...pendingApprovals, ...billDues, ...dueReminders,
    ...attendanceGaps, ...tdsOverdue, ...dcMismatch, ...qualityMismatch,
  ]
    .filter((i) => UNCLEARABLE.has(i.kind) || clearedAt == null || i.occurred_at > clearedAt)
    // Most urgent first, then most recent.
    .sort((a, b) => {
      const sev = sevRank(b.severity) - sevRank(a.severity);
      if (sev !== 0) return sev;
      return b.occurred_at < a.occurred_at ? -1 : 1;
    })
    .slice(0, 100);

  const worstSeverity = items[0]?.severity ?? null;
  return { total: items.length, worstSeverity, items };
}

/** Count-only call for the bell badge. Delegates to the full fetch so
 *  Clear-all and every source rule stay in exactly one place. */
export async function fetchNotificationCount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public', any>,
): Promise<{ total: number; worstSeverity: 'info' | 'warn' | 'critical' | null }> {
  const feed = await fetchNotifications(supabase);
  return { total: feed.total, worstSeverity: feed.worstSeverity };
}

/** The user's Clear-all marker, or null if they never cleared. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchClearedAt(sb: any): Promise<string | null> {
  try {
    const { data: auth } = await sb.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return null;
    const { data } = await sb
      .from('notification_clear')
      .select('cleared_at')
      .eq('user_id', uid)
      .maybeSingle();
    return data?.cleared_at ?? null;
  } catch {
    // Table missing (migration 160 not applied) — show everything.
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchPendingApprovals(sb: any): Promise<NotificationItem[]> {
  const { data } = await sb
    .from('costing_master')
    .select('id, quality_code, quality_name, created_at, created_by')
    .eq('approval_status', 'pending')
    .order('created_at', { ascending: false })
    .limit(50);
  return ((data ?? []) as Array<{
    id: number; quality_code: string; quality_name: string;
    created_at: string; created_by: string | null;
  }>).map((r) => ({
    id: `approval:${r.id}`,
    kind: 'costing_approval' as const,
    title: `Costing pending approval: ${r.quality_code}`,
    body: r.quality_name,
    link: `/app/costing/approvals?focus=${r.id}`,
    occurred_at: r.created_at,
    severity: 'warn' as const,
  }));
}

/** One notification per party with bills still carrying a balance —
 *  customers that owe US (receivable) and jobwork parties WE owe
 *  (payable). occurred_at = the newest open bill's created_at, so a
 *  fresh bill resurfaces the party even after a Clear-all. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchBillDues(sb: any): Promise<NotificationItem[]> {
  const { data } = await sb
    .from('invoice')
    .select('id, invoice_no, doc_type, party_name, customer_id, jobwork_party_id, balance, invoice_date, created_at')
    .gt('balance', 0)
    .in('doc_type', [...RECEIVABLE_DOC_TYPES, ...PAYABLE_DOC_TYPES])
    .limit(1000);

  interface InvRow {
    id: number; invoice_no: string; doc_type: string;
    party_name: string | null; customer_id: number | null;
    jobwork_party_id: number | null;
    balance: number | string | null;
    invoice_date: string | null; created_at: string | null;
  }

  interface PartyAgg {
    name: string;
    due: number;
    bills: number;
    latest: string;
    receivable: boolean;
    link: string;
  }
  const byParty = new Map<string, PartyAgg>();

  for (const r of ((data ?? []) as InvRow[])) {
    const receivable = RECEIVABLE_DOC_TYPES.includes(r.doc_type);
    const key = receivable
      ? `recv:${r.customer_id ?? r.party_name ?? r.id}`
      : `pay:${r.jobwork_party_id ?? r.party_name ?? r.id}`;
    const occurred = r.created_at ?? (r.invoice_date != null ? `${r.invoice_date}T00:00:00Z` : new Date().toISOString());
    let agg = byParty.get(key);
    if (!agg) {
      agg = {
        name: r.party_name ?? 'Unknown party',
        due: 0,
        bills: 0,
        latest: occurred,
        receivable,
        link: receivable
          ? '/app/invoices'
          : (r.jobwork_party_id != null ? `/app/payments?party=${r.jobwork_party_id}` : '/app/payments'),
      };
      byParty.set(key, agg);
    }
    agg.due += Number(r.balance ?? 0);
    agg.bills += 1;
    if (occurred > agg.latest) agg.latest = occurred;
  }

  return Array.from(byParty.entries()).map(([key, p]) => ({
    id: `billdue:${key}`,
    kind: 'bill_due' as const,
    title: p.receivable
      ? `To collect: ${p.name} — ${formatINR(p.due)}`
      : `To pay: ${p.name} — ${formatINR(p.due)}`,
    body: `${p.bills} bill${p.bills === 1 ? '' : 's'} pending`,
    link: p.link,
    occurred_at: p.latest,
    severity: 'warn' as const,
  }));
}

/** Reminders that are due today or overdue — active only. Upcoming (not
 *  yet due) reminders don't clutter the bell; they still show on the
 *  dashboard widget's wider window. occurred_at = due_date, so a
 *  recurring reminder's next cycle (new due_date after Mark Done) reads
 *  as a fresh event and resurfaces past a Clear-all automatically. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchDueReminders(sb: any): Promise<NotificationItem[]> {
  const today = todayIST();
  const [{ data }, categoryLabels] = await Promise.all([
    sb
      .from('reminder')
      .select('id, title, description, category, due_date, repeat')
      .eq('status', 'active')
      .lte('due_date', today)
      .order('due_date', { ascending: true })
      .limit(50),
    fetchCategoryLabelMap(sb),
  ]);

  return ((data ?? []) as Array<{
    id: number; title: string; description: string | null;
    category: string; due_date: string; repeat: string;
  }>).map((r) => {
    const overdue = r.due_date < today;
    const dueLabel = overdue ? `Overdue since ${r.due_date}` : 'Due today';
    return {
      id: `reminder:${r.id}`,
      kind: 'reminder' as const,
      title: r.title,
      body: `${categoryLabels[r.category] ?? r.category} — ${dueLabel}`,
      link: `/app/reminders?focus=${r.id}`,
      occurred_at: `${r.due_date}T00:00:00Z`,
      severity: overdue ? ('critical' as const) : ('warn' as const),
    };
  });
}

/**
 * Shifts that were never recorded — neither worked nor marked a holiday.
 *
 * Critical, because the consequence is silent and financial: the shift
 * drops out of the week, every winder's per-slot rate rises, and no shed
 * on it can be counted idle. Four went unnoticed for two months.
 *
 * Ninety days back. Older than that and the weeks are long settled, so
 * the warning would be noise rather than something to act on.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAttendanceGaps(sb: any): Promise<NotificationItem[]> {
  const today = todayISO();
  const from = new Date();
  from.setDate(from.getDate() - 90);
  const gaps = await loadUnrecordedShifts(sb, todayISO(from), today);
  return gaps.slice(0, 20).map((g) => ({
    id: `attendance_gap:${g.date}:${g.shift}`,
    kind: 'attendance_gap' as const,
    title: `${describeShift(g)} was never recorded`,
    body: 'Wages for that week may be wrong. Record the shift, or mark it a holiday.',
    link: `/app/attendance/mark?date=${g.date}&shift=${g.shift}`,
    occurred_at: `${g.date}T00:00:00Z`,
    severity: 'critical' as const,
  }));
}

/**
 * TDS months past their 5th.
 *
 * Critical, and not clearable, because the amount GROWS: 1.5% per month
 * or part month under section 201(1A), stepping up on the 1st rather than
 * day by day. A reminder you can dismiss would be worse than none.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchTdsOverdue(sb: any): Promise<NotificationItem[]> {
  const today = todayISO();
  const { months } = await loadTdsMonths(sb, today);
  return months
    .filter((m) => m.overdue && m.outstanding > 0.005)
    .map((m) => ({
      id: `tds_overdue:${m.month}`,
      kind: 'tds_overdue' as const,
      title: `TDS for ${m.label} is ${Math.abs(daysUntil(m.dueDate, today))} days overdue`,
      body:
        `\u20B9${m.outstanding.toFixed(2)} tax + \u20B9${m.interest.toFixed(2)} interest ` +
        `= \u20B9${m.payable.toFixed(2)}. Was due ${m.dueDate}. Another 1.5% is added each month.`,
      link: `/app/tds/new?month=${m.month}`,
      occurred_at: `${m.dueDate}T00:00:00Z`,
      severity: 'critical' as const,
    }));
}

/**
 * A DC corrected after its fabric receipt was saved (migration 310).
 * The receipt still consumed warp / weft / bobbin for the OLD quantity
 * until it is opened, Edited and saved again. PPK, 2026-09-26: JDC/0059
 * went 705 -> 702 while FR/0121 stayed at 705.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchDcReceiptMismatch(sb: any): Promise<NotificationItem[]> {
  try {
    const { data } = await sb
      .from('v_dc_receipt_mismatch')
      .select('dc_code, dc_date, bill_to_name, dc_qty, receipt_id, receipt_code, receipt_qty, changed_at')
      .order('dc_date', { ascending: false })
      .limit(20);
    return ((data ?? []) as Array<{
      dc_code: string; dc_date: string; bill_to_name: string | null; dc_qty: number;
      receipt_id: number; receipt_code: string; receipt_qty: number; changed_at: string | null;
    }>).map((r) => ({
      id: `dc_receipt:${r.receipt_id}`,
      kind: 'dc_receipt_mismatch' as const,
      title: `${r.dc_code} says ${Number(r.dc_qty)}, receipt ${r.receipt_code} says ${Number(r.receipt_qty)}`,
      body: 'Warehouse stock was taken for the receipt figure. Open the receipt, tap Edit and save to re-apply it.',
      link: `/app/jobwork/fabric-receipt/${r.receipt_id}`,
      occurred_at: r.changed_at ?? `${r.dc_date}T00:00:00Z`,
      severity: 'critical' as const,
    }));
  } catch {
    return []; // view missing (migration 310 not applied)
  }
}

/**
 * Shift-log rows whose quality is not the beam's (migration 310). New rows
 * already take the beam's quality (308); these are older saves or a beam
 * change entered late. PPK, 2026-09-26: L-31, 23 Sep, 30" vs beam 34".
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchQualityMismatch(sb: any): Promise<NotificationItem[]> {
  try {
    const { data } = await sb
      .from('v_shift_log_beam_mismatch')
      .select('shift_log_id, log_date, shift, loom_code, logged_quality, beam_quality')
      .order('log_date', { ascending: false })
      .limit(20);
    return ((data ?? []) as Array<{
      shift_log_id: number; log_date: string; shift: string; loom_code: string;
      logged_quality: string | null; beam_quality: string | null;
    }>).map((r) => ({
      id: `quality_mismatch:${r.shift_log_id}`,
      kind: 'quality_mismatch' as const,
      title: `${r.loom_code} on ${formatDay(r.log_date)}: logged ${r.logged_quality ?? '?'}, beam is ${r.beam_quality ?? '?'}`,
      body: 'Folding pay, costing and stock by quality use the logged quality. Check the entry or the beam change date.',
      link: `/app/production/shift-log?date=${r.log_date}&shift=${r.shift}`,
      occurred_at: `${r.log_date}T00:00:00Z`,
      severity: 'warn' as const,
    }));
  } catch {
    return [];
  }
}

function sevRank(s: 'info' | 'warn' | 'critical'): number {
  switch (s) {
    case 'critical': return 2;
    case 'warn':     return 1;
    case 'info':     return 0;
  }
}
