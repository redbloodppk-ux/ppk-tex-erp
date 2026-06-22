import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { formatRupee, formatDate } from '@/lib/utils';
import { DecideButtons } from './decide-buttons';
import { ApprovalStatusSelect } from './approval-status-select';
import { LinkFabricSelect, type FabricOption } from './link-fabric-select';
import { CheckCircle2, XCircle, Clock, ArrowRight } from 'lucide-react';
import { CardFilter } from '@/app/components/card-filter';

export const metadata = { title: 'Costing Approvals' };

/**
 * Costing Approvals — T-B11 (CORR Group 2).
 *
 * Owner-only gate between "Pending" costings (saved from the form) and
 * "Approved" costings (referenceable by Sales Orders). The page shows:
 *
 *   • A queue of pending costings, each as a full spec card so the owner
 *     can sanity-check warp/weft/bobbin/porvai inputs + the two costs
 *     before approving.
 *   • Approve / Reject buttons that flip `costing_master.approval_status`
 *     and stamp `approved_by` + `approved_at`. The button component lives
 *     in decide-buttons.tsx (client) and uses the existing RLS policy
 *     (owner-only UPDATE) as the real enforcement.
 *   • A "recent decisions" log so the owner can see what they signed off
 *     on this week.
 *
 * Sales Order creation should join on `approval_status = 'approved'` so
 * the Pending → Active gate is hard, not advisory. See p_costing_update
 * in rls.sql for the policy.
 */
type CostingRow = {
  id: number;
  quality_code: string;
  quality_name: string;
  fabric_type: 'woven' | 'towel' | 'dupatta';
  production_mode: 'inhouse' | 'vendor' | 'both';
  warp_ends: number | null;
  pick_ppi: number | string;
  reed_count: number;
  fabric_width_in: number | string;
  fabric_length_m: number | string;
  use_porvai: boolean;
  approval_status: 'pending' | 'approved' | 'rejected';
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  created_by: string | null;
  notes: string | null;
};

type TwoCostRow = {
  id: number;
  quoted_cost_per_m: number | string | null;
  true_cost_per_m: number | string | null;
  selling_price_per_m: number | string | null;
};

export default async function ApprovalsPage() {
  const supabase = await createClient();

  // Auth + role gate ─────────────────────────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: me } = await supabase
    .from('app_user')
    .select('role, full_name')
    .eq('id', user.id)
    .maybeSingle();
  const role     = (me as { role: string } | null)?.role;
  const isOwner  = role === 'owner';
  const isViewer = role === 'auditor' || isOwner;

  if (!isViewer) {
    // Sales/mill_manager folks can submit but not see the queue.
    redirect('/app/costing');
  }

  // Data ─────────────────────────────────────────────────────────────────────
  const [
    { data: pendingRaw },
    { data: recentRaw },
    { data: twoCostRaw },
    { data: usersRaw },
    { data: fabricsRaw },
  ] = await Promise.all([
    supabase
      .from('costing_master')
      .select('id, quality_code, quality_name, fabric_type, production_mode, warp_ends, pick_ppi, reed_count, fabric_width_in, fabric_length_m, use_porvai, approval_status, approved_at, approved_by, created_at, created_by, notes')
      .eq('approval_status', 'pending')
      .eq('status', 'active')
      .order('created_at', { ascending: true }),
    supabase
      .from('costing_master')
      .select('id, quality_code, quality_name, fabric_type, production_mode, warp_ends, pick_ppi, reed_count, fabric_width_in, fabric_length_m, use_porvai, approval_status, approved_at, approved_by, created_at, created_by, notes')
      .neq('approval_status', 'pending')
      .order('approved_at', { ascending: false, nullsFirst: false })
      .limit(20),
    // Cost view is keyed by id; fetch only what we need for both lists.
    supabase
      .from('v_costing_two_cost')
      .select('id, quoted_cost_per_m, true_cost_per_m, selling_price_per_m'),
    supabase
      .from('app_user')
      .select('id, full_name'),
    // Fabric Quality master + each one's currently-linked costing, so the
    // Linked Fabric dropdown can pre-select the already-paired fabric.
    supabase
      .from('fabric_quality')
      .select('id, code, name, costing_id')
      .eq('active', true)
      .order('name'),
  ]);

  const pending: CostingRow[] = (pendingRaw as CostingRow[] | null) ?? [];
  const recent:  CostingRow[] = (recentRaw  as CostingRow[] | null) ?? [];
  const costsById = new Map<number, TwoCostRow>(
    ((twoCostRaw as TwoCostRow[] | null) ?? []).map(r => [r.id, r]),
  );
  const userById = new Map<string, string>(
    ((usersRaw as { id: string; full_name: string }[] | null) ?? [])
      .map(u => [u.id, u.full_name]),
  );

  type FabricRow = { id: number; code: string | null; name: string; costing_id: number | null };
  const fabricRows = (fabricsRaw as FabricRow[] | null) ?? [];
  const fabrics: FabricOption[] = fabricRows.map((f) => ({ id: f.id, code: f.code, name: f.name }));
  const linkedFabricByCosting = new Map<number, number>();
  for (const f of fabricRows) {
    if (f.costing_id != null) linkedFabricByCosting.set(f.costing_id, f.id);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Costing Approvals"
        subtitle={
          isOwner
            ? 'Review and sign off on new costings before Sales Orders can quote against them.'
            : 'Read-only view of pending costings and recent decisions.'
        }
        crumbs={[{ label: 'Fabric Costing', href: '/app/costing' }, { label: 'Approvals' }]}
      />

      {/* Headline KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card p-4 border-l-4 border-amber-400">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute font-semibold">Pending review</div>
          <div className="text-3xl font-display font-extrabold text-amber-700 num">{pending.length}</div>
          <div className="text-xs text-ink-soft mt-0.5">awaiting owner sign-off</div>
        </div>
        <div className="card p-4 border-l-4 border-emerald-400">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute font-semibold">Approved (last 20)</div>
          <div className="text-3xl font-display font-extrabold text-emerald-700 num">
            {recent.filter(r => r.approval_status === 'approved').length}
          </div>
          <div className="text-xs text-ink-soft mt-0.5">live for Sales Orders</div>
        </div>
        <div className="card p-4 border-l-4 border-red-400">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute font-semibold">Rejected (last 20)</div>
          <div className="text-3xl font-display font-extrabold text-red-700 num">
            {recent.filter(r => r.approval_status === 'rejected').length}
          </div>
          <div className="text-xs text-ink-soft mt-0.5">need to be re-edited</div>
        </div>
      </div>

      {/* Pending queue ─────────────────────────────────────────────────── */}
      <section>
        <h2 className="font-display font-bold text-base mb-2 flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-600" /> Pending queue
        </h2>

        {pending.length === 0 ? (
          <div className="card p-6 text-center text-sm text-ink-soft">
            Nothing pending. New costings will land here as soon as Sales or the Mill saves them.
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map(c => {
              const costs   = costsById.get(c.id);
              const creator = c.created_by ? userById.get(c.created_by) : null;
              return (
                <article key={c.id} className="card p-5">
                  <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
                    <div>
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-mono text-xs px-2 py-0.5 rounded bg-cloud text-ink-soft">
                          {c.quality_code}
                        </span>
                        <h3 className="font-display font-bold text-lg leading-tight">{c.quality_name}</h3>
                        <span className="pill bg-indigo-50 text-indigo-700 uppercase">{c.fabric_type}</span>
                        <span className="pill bg-slate-100 text-slate-700 uppercase">{c.production_mode}</span>
                        {c.use_porvai && (
                          <span className="pill bg-purple-50 text-purple-700 uppercase">porvai</span>
                        )}
                      </div>
                      <div className="text-xs text-ink-mute mt-1">
                        Submitted by <span className="font-semibold">{creator ?? '—'}</span> on{' '}
                        <span className="font-semibold">{formatDate(c.created_at, 'long')}</span>
                      </div>
                    </div>
                    {isOwner && (
                      <DecideButtons costingId={c.id} qualityCode={c.quality_code} />
                    )}
                  </div>

                  {/* Spec & costs grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm border-t border-line/60 pt-3">
                    <Spec label="Reed × Width" value={`${c.reed_count} / ${Number(c.fabric_width_in).toFixed(2)}"`} />
                    <Spec label="Pick (PPI)"   value={Number(c.pick_ppi).toFixed(2)} />
                    <Spec label="Length"       value={`${Number(c.fabric_length_m).toFixed(2)} m`} />
                    <Spec label="Warp ends"    value={c.warp_ends?.toString() ?? '—'} />

                    <CostStat
                      label="Quoted ₹/m"
                      value={costs?.quoted_cost_per_m}
                      colour="text-indigo-700"
                    />
                    <CostStat
                      label="True ₹/m"
                      value={costs?.true_cost_per_m}
                      colour="text-amber-700"
                    />
                    <CostStat
                      label="Selling ₹/m"
                      value={costs?.selling_price_per_m}
                      colour="text-violet-700"
                    />
                    <div className="text-right">
                      <Link
                        href={`/app/costing/${c.id}/edit`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-ink-soft hover:text-ink underline decoration-dotted"
                      >
                        Open full spec <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>

                  {c.notes && (
                    <div className="mt-3 text-xs text-ink-soft border-t border-line/60 pt-2">
                      <span className="font-semibold uppercase tracking-wide text-ink-mute">Notes —</span>{' '}
                      {c.notes}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent decisions ──────────────────────────────────────────────── */}
      <section>
        <h2 className="font-display font-bold text-base mb-2">Recent decisions</h2>
        {recent.length === 0 ? (
          <div className="card p-4 text-sm text-ink-soft">No decisions yet.</div>
        ) : (
          <>
          {/* Mobile / PWA: card view. The decisions table is wide; below md
              we render each decision as a tap-friendly card. The table is
              hidden on mobile. */}
          <CardFilter placeholder="Search decisions…">
            {recent.map((r) => (
              <div key={r.id} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink break-words">{r.quality_name}</div>
                    <div className="font-mono text-xs text-ink-soft mt-0.5">{r.quality_code}</div>
                  </div>
                  <div className="shrink-0">
                    {isOwner ? (
                      <ApprovalStatusSelect costingId={r.id} initial={r.approval_status} />
                    ) : r.approval_status === 'approved' ? (
                      <span className="inline-flex items-center gap-1 pill bg-emerald-50 text-emerald-700">
                        <CheckCircle2 className="w-3 h-3" /> Approved
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 pill bg-red-50 text-red-700">
                        <XCircle className="w-3 h-3" /> Rejected
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-xs mt-2">
                  <span className="text-ink-mute">Linked Fabric: </span>
                  {r.approval_status === 'approved' ? (
                    isOwner ? (
                      <div className="mt-1">
                        <LinkFabricSelect
                          costingId={r.id}
                          fabrics={fabrics}
                          linkedFabricId={linkedFabricByCosting.get(r.id) ?? null}
                        />
                      </div>
                    ) : (
                      <span className="text-ink-soft">
                        {(() => {
                          const fid = linkedFabricByCosting.get(r.id);
                          if (fid == null) return '—';
                          const f = fabrics.find((x) => x.id === fid);
                          return f ? `${f.code ? f.code + ' - ' : ''}${f.name}` : '—';
                        })()}
                      </span>
                    )
                  ) : (
                    <span className="text-ink-mute">approved only</span>
                  )}
                </div>

                <div className="text-xs text-ink-soft mt-1">
                  <span className="text-ink-mute">Decided by: </span>{r.approved_by ? (userById.get(r.approved_by) ?? '—') : '—'}
                  {' · '}<span className="num">{r.approved_at ? formatDate(r.approved_at, 'short') : '—'}</span>
                </div>
              </div>
            ))}
          </CardFilter>

          <div className="card overflow-x-auto hidden md:block">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="text-left px-4 py-2.5 whitespace-nowrap">Code</th>
                  <th className="text-left px-4 py-2.5">Quality</th>
                  <th className="text-left px-4 py-2.5 whitespace-nowrap">Status</th>
                  <th className="text-left px-4 py-2.5 whitespace-nowrap">Linked Fabric</th>
                  <th className="text-left px-4 py-2.5 whitespace-nowrap">Decided by</th>
                  <th className="text-right px-4 py-2.5 whitespace-nowrap">Decided on</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(r => (
                  <tr key={r.id} className="border-t border-line/40">
                    <td className="px-4 py-2.5 font-mono text-xs">{r.quality_code}</td>
                    <td className="px-4 py-2.5 font-semibold">{r.quality_name}</td>
                    <td className="px-4 py-2.5">
                      {isOwner ? (
                        <ApprovalStatusSelect costingId={r.id} initial={r.approval_status} />
                      ) : r.approval_status === 'approved' ? (
                        <span className="inline-flex items-center gap-1 pill bg-emerald-50 text-emerald-700">
                          <CheckCircle2 className="w-3 h-3" /> Approved
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 pill bg-red-50 text-red-700">
                          <XCircle className="w-3 h-3" /> Rejected
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.approval_status === 'approved' ? (
                        isOwner ? (
                          <LinkFabricSelect
                            costingId={r.id}
                            fabrics={fabrics}
                            linkedFabricId={linkedFabricByCosting.get(r.id) ?? null}
                          />
                        ) : (
                          <span className="text-xs text-ink-soft">
                            {(() => {
                              const fid = linkedFabricByCosting.get(r.id);
                              if (fid == null) return '—';
                              const f = fabrics.find((x) => x.id === fid);
                              return f ? `${f.code ? f.code + ' - ' : ''}${f.name}` : '—';
                            })()}
                          </span>
                        )
                      ) : (
                        <span className="text-xs text-ink-mute">approved only</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {r.approved_by ? (userById.get(r.approved_by) ?? '—') : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-ink-soft num">
                      {r.approved_at ? formatDate(r.approved_at, 'short') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-ink-mute font-semibold">{label}</div>
      <div className="font-semibold num">{value}</div>
    </div>
  );
}

function CostStat({
  label, value, colour,
}: { label: string; value: number | string | null | undefined; colour: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-ink-mute font-semibold">{label}</div>
      <div className={`font-display font-extrabold num ${colour}`}>
        {value == null ? '—' : formatRupee(value, { decimals: 2 })}
      </div>
    </div>
  );
}
