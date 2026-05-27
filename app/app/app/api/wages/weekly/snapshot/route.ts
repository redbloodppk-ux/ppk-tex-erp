/**
 * POST /api/wages/weekly/snapshot
 *
 * UPSERTs a weekly_wage_summary row keyed by (fy_label, week_no). The page
 * computes the payload server-side and the operator clicks Save — we just
 * persist what's already on screen.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

interface SnapshotBody {
  fy_label: string;
  week_no: number;
  week_start: string;
  week_end: string;
  totals: Record<string, number>;
  per_employee: ReadonlyArray<Record<string, unknown>>;
  wage_entries: ReadonlyArray<Record<string, unknown>>;
  expenses: ReadonlyArray<Record<string, unknown>>;
}

function parse(body: unknown): SnapshotBody | string {
  if (typeof body !== 'object' || body === null) return 'Body must be JSON.';
  const b = body as Record<string, unknown>;
  if (typeof b.fy_label !== 'string' || b.fy_label.length === 0) return 'fy_label required.';
  if (typeof b.week_no !== 'number' || !Number.isFinite(b.week_no)) return 'week_no required.';
  if (typeof b.week_start !== 'string') return 'week_start required.';
  if (typeof b.week_end !== 'string') return 'week_end required.';
  if (typeof b.totals !== 'object' || b.totals === null) return 'totals required.';
  if (!Array.isArray(b.per_employee)) return 'per_employee required.';
  if (!Array.isArray(b.wage_entries)) return 'wage_entries required.';
  if (!Array.isArray(b.expenses)) return 'expenses required.';
  return {
    fy_label: b.fy_label,
    week_no: b.week_no,
    week_start: b.week_start,
    week_end: b.week_end,
    totals: b.totals as Record<string, number>,
    per_employee: b.per_employee as ReadonlyArray<Record<string, unknown>>,
    wage_entries: b.wage_entries as ReadonlyArray<Record<string, unknown>>,
    expenses: b.expenses as ReadonlyArray<Record<string, unknown>>,
  };
}

export async function POST(req: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = parse(raw);
  if (typeof parsed === 'string') {
    return NextResponse.json({ ok: false, error: parsed }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });
  }

  const row = {
    fy_label: parsed.fy_label,
    week_no: parsed.week_no,
    week_start: parsed.week_start,
    week_end: parsed.week_end,
    totals: parsed.totals,
    per_employee: parsed.per_employee,
    wage_entries: parsed.wage_entries,
    expenses: parsed.expenses,
    created_by: user.id,
  };

  // weekly_wage_summary added in migration 037 — types lag.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('weekly_wage_summary')
    .upsert([row as never], { onConflict: 'fy_label,week_no' });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
