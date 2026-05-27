// offlineQueue.ts — CORR-A7
//
// Tiny localStorage-backed queue for attendance saves made while the PWA is
// offline. The mark page tries Supabase first; if the network is down or the
// request fails, it stashes the full payload here. When the browser fires the
// `online` event, OfflineSync drains the queue and replays each payload with
// sync_source = 'offline_pwa' so the audit trail shows which rows came from
// the queued path.
//
// Keep this file tiny and dependency-free — it runs in the browser only.

const KEY = 'ppk.attendance.offlineQueue.v1';

export type QueuedEntry = {
  employee_id: string;
  status: 'present' | 'absent' | 'half_day' | 'late' | 'early_leave' | 'none';
  day_weight: number;
  // "HH:MM" or null. Only meaningful for late / early_leave / half_day.
  actual_in_time?: string | null;
  actual_out_time?: string | null;
  // Legacy single-shed column; mirrored from shed_nos[0].
  shed_no?: string | null;
  // Multi-shed coverage (migration 038). Winders may cover several sheds in
  // one shift; weavers will normally have a single-element array.
  shed_nos?: string[] | null;
  notes?: string | null;
};

export type QueuedPayload = {
  // Stable client id so we can dedupe / remove on flush success.
  id: string;
  // ISO date (YYYY-MM-DD) of the attendance day.
  mark_date: string;
  shift: 'morning' | 'night';
  // Optional non-working day reason — when set, entries[] is usually empty.
  non_working_reason?: 'power_cut' | 'national_holiday' | 'maintenance' | 'other' | null;
  non_working_note?: string | null;
  entries: QueuedEntry[];
  // When the supervisor pressed Save on the phone.
  queued_at: string;
};

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readRaw(): QueuedPayload[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as QueuedPayload[];
  } catch {
    return [];
  }
}

function writeRaw(items: QueuedPayload[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Quota or private-mode failure — nothing we can do here. The mark page
    // will surface a generic error to the user.
  }
}

export function listQueued(): QueuedPayload[] {
  return readRaw();
}

export function queueCount(): number {
  return readRaw().length;
}

export function enqueue(payload: Omit<QueuedPayload, 'id' | 'queued_at'>): QueuedPayload {
  const item: QueuedPayload = {
    ...payload,
    id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    queued_at: new Date().toISOString(),
  };
  const items = readRaw();
  // If the same date+shift is already queued, replace it — the supervisor
  // re-saved with updated statuses and the latest one wins.
  const filtered = items.filter(
    (q) => !(q.mark_date === item.mark_date && q.shift === item.shift),
  );
  filtered.push(item);
  writeRaw(filtered);
  return item;
}

export function removeQueued(id: string): void {
  const items = readRaw();
  writeRaw(items.filter((q) => q.id !== id));
}

export function clearQueue(): void {
  writeRaw([]);
}
