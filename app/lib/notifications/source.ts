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
 *
 * Yarn low-stock was removed by request (12-06-2026) — the operator
 * tracks cover from the Days-of-Cover report instead.
 *
 * "Clear all": the notification_clear table stores ONE timestamp per
 * user. Items whose occurred_at <= cleared_at are hidden; anything that
 * happens after the clear (new bill, new pending costing) reappears.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type NotificationKind = 'costing_approval' | 'bill_due';

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

  const [pendingApprovals, billDues, clearedAt] = await Promise.all([
    fetchPendingApprovals(sb),
    fetchBillDues(sb),
    fetchClearedAt(sb),
  ]);

  const items = [...pendingApprovals, ...billDues]
    .filter((i) => clearedAt == null || i.occurred_at > clearedAt)
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

function sevRank(s: 'info' | 'warn' | 'critical'): number {
  switch (s) {
    case 'critical': return 2;
    case 'warn':     return 1;
    case 'info':     return 0;
  }
}
