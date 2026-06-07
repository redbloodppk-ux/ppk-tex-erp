/**
 * Notification sources — CORR-H6
 *
 * v1 strategy: notifications are *derived* from existing tables / views,
 * not persisted in their own `notifications` table. This avoids a
 * persistent fan-out service while still surfacing the four signals the
 * Correction Guide asked for.
 *
 * Sources implemented in v1:
 *   - Pending costing approvals — `costing_master.approval_status='pending'`
 *   - Critical low-stock yarn   — `v_yarn_cover_dashboard.cover_status IN ('critical','out')`
 *
 * Sources deferred to v1.1 (mostly because the data model needs more
 * thought, not because the wiring is hard):
 *   - Overdue invoices — needs a due_date or terms-from-party calc.
 *   - Variance flags > 5% — depends on the CORR-P1 jsonb being populated
 *     consistently across batch sources.
 *
 * Each notification is normalised into a single shape so the bell, the
 * dropdown, and the /app/notifications list can all consume one feed.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type NotificationKind = 'costing_approval' | 'yarn_low';

export interface NotificationItem {
  /** Stable composite id for keys + dedup. Not a DB row id. */
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** Click target — opens the page where the operator can act on it. */
  link: string;
  /** ISO timestamp this notification "happened" — sorts the feed. */
  occurred_at: string;
  /** Visual severity. The bell colours the dot by the worst pending item. */
  severity: 'info' | 'warn' | 'critical';
}

export interface NotificationFeed {
  total: number;
  worstSeverity: 'info' | 'warn' | 'critical' | null;
  items: NotificationItem[];
}

/** Pull every active notification. Cheap enough to call on every page
 *  request for a single-tenant ERP; cap at 100 to bound payload size. */
export async function fetchNotifications(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public', any>,
): Promise<NotificationFeed> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const [pendingApprovals, lowStock] = await Promise.all([
    fetchPendingApprovals(sb),
    fetchLowStock(sb),
  ]);

  const items = [...pendingApprovals, ...lowStock]
    // Most recent / most urgent first. Critical bubbles to the top.
    .sort((a, b) => {
      const sev = sevRank(b.severity) - sevRank(a.severity);
      if (sev !== 0) return sev;
      return b.occurred_at < a.occurred_at ? -1 : 1;
    })
    .slice(0, 100);

  const worstSeverity = items[0]?.severity ?? null;
  return { total: items.length, worstSeverity, items };
}

/** Lightweight count-only call for the bell. Avoids fetching bodies on
 *  every poll. */
export async function fetchNotificationCount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public', any>,
): Promise<{ total: number; worstSeverity: 'info' | 'warn' | 'critical' | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const [{ count: approvals }, lowStockSev] = await Promise.all([
    sb.from('costing_master')
      .select('id', { count: 'exact', head: true })
      .eq('approval_status', 'pending'),
    countLowStock(sb),
  ]);

  const approvalCount = approvals ?? 0;
  const total = approvalCount + lowStockSev.count;
  let worst: 'info' | 'warn' | 'critical' | null = null;
  if (lowStockSev.count > 0) worst = lowStockSev.worst;
  if (approvalCount > 0 && (worst == null || sevRank('warn') > sevRank(worst))) worst = 'warn';
  return { total, worstSeverity: worst };
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchLowStock(sb: any): Promise<NotificationItem[]> {
  const { data } = await sb
    .from('v_yarn_cover_dashboard')
    .select('yarn_count_id, code, display_name, available_kg, days_of_cover, cover_status')
    .in('cover_status', ['critical', 'out'])
    .order('days_of_cover', { ascending: true, nullsFirst: true })
    .limit(50);
  return ((data ?? []) as Array<{
    yarn_count_id: number; code: string; display_name: string;
    available_kg: number | string | null;
    days_of_cover: number | null;
    cover_status: 'out' | 'critical' | 'low' | 'idle' | 'ok';
  }>).map((r) => {
    const isOut = r.cover_status === 'out';
    const days = r.days_of_cover != null ? Math.round(r.days_of_cover) : null;
    const kg = Number(r.available_kg ?? 0).toFixed(1);
    return {
      id: `lowstock:${r.yarn_count_id}`,
      kind: 'yarn_low' as const,
      title: isOut
        ? `Out of stock: ${r.code}`
        : `Yarn cover critical: ${r.code} (${days ?? '?'} days)`,
      body: `${r.display_name} — ${kg} kg available`,
      link: `/app/reports/days-of-cover?count=${r.yarn_count_id}`,
      // We don't have a precise "when did it go critical" timestamp;
      // surface "now" so it stays near the top of the feed.
      occurred_at: new Date().toISOString(),
      severity: isOut ? 'critical' as const : 'warn' as const,
    };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function countLowStock(sb: any): Promise<{ count: number; worst: 'critical' | 'warn' }> {
  const { data } = await sb
    .from('v_yarn_cover_dashboard')
    .select('cover_status')
    .in('cover_status', ['critical', 'out']);
  const rows = (data ?? []) as Array<{ cover_status: string }>;
  const hasOut = rows.some((r) => r.cover_status === 'out');
  return { count: rows.length, worst: hasOut ? 'critical' : 'warn' };
}

function sevRank(s: 'info' | 'warn' | 'critical'): number {
  switch (s) {
    case 'critical': return 2;
    case 'warn':     return 1;
    case 'info':     return 0;
  }
}
