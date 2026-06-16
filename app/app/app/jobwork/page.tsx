'use client';
/**
 * /app/jobwork â€” Job Work command centre with five tabs.
 *
 * 1. Bobbin given    : read-only list of bobbin rows tagged jobwork; Restock
 *                      clones the row with fresh date/qty/supplier.
 * 2. Warp beam given : add + table with inline edit, delete, restock.
 * 3. Weft bag given  : add + table with inline edit, delete, restock.
 * 4. Warp yarn given : add + table with inline edit, delete, restock.
 * 5. Status          : pivot + per-party balance + per-quality split.
 */
import Link from 'next/link';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, Plus, Trash2, Pencil, Check, X, RefreshCw, ArrowLeft, Unlock } from 'lucide-react';

// This page services TWO routes: /app/jobwork and /app/outsource. The
// only difference is which `jobwork_party.kind` rows it filters to â€”
// 'jobwork' for Job Work parties, 'outsource' for Outsource Weavers
// (migration 113 added the `kind` column + sync trigger). Page title,
// subtitle, and the "Manage" link all switch accordingly.
type PartyKind = 'jobwork' | 'outsource';
interface PageVariant {
  kind: PartyKind;
  title: string;
  subtitle: string;
  manageHref: string;
  manageLabel: string;
  /** Label used wherever the form / table needs to refer to the party
   *  this page targets â€” "Jobwork Party" on /app/jobwork,
   *  "Outsourcing party" on /app/outsource. */
  partyLabel: string;
  /** Used in invoice / DC text (e.g. "Weaving Bill" vs "Job Work Bill"). */
  billLabel: string;
  dcLabel: string;
}
const VARIANTS: Record<PartyKind, PageVariant> = {
  jobwork: {
    kind: 'jobwork',
    title: 'Job Work',
    subtitle: 'Track bobbin / warp beam / weft bag issued to each jobwork party. Inline edit, delete, restock supported.',
    manageHref: '/app/parties?type=3',
    manageLabel: 'Manage Jobwork Parties',
    partyLabel: 'Jobwork Party',
    billLabel: 'Job Work Bill',
    dcLabel: 'Job Work DC',
  },
  outsource: {
    kind: 'outsource',
    title: 'Outsource Weaving',
    subtitle: 'Track bobbin / warp beam / weft bag issued to each outsource weaver. Inline edit, delete, restock supported.',
    manageHref: '/app/parties?type=5',
    manageLabel: 'Manage Outsource Weavers',
    partyLabel: 'Outsourcing party',
    billLabel: 'Weaving Bill',
    dcLabel: 'Outsource Weaving DC',
  },
};

import { JobworkDcTab } from './dc-tab';
import { JobworkPaymentTab } from './payment-tab';

type Tab = 'dc' | 'bobbin' | 'warp_beam' | 'weft_bag' | 'warp_yarn' | 'payment' | 'weavers';

interface PartyOpt { id: number; code: string; name: string; }
interface QualityOpt { id: number; code: string | null; name: string; production_mode: 'inhouse' | 'job_work' | 'outsourcing' | null; }
interface CountOpt { id: number; code: string; display_name: string; }
interface EndsOpt { id: number; code: string; name: string; }
interface FabricDefaults { warp_count_id: number | null; ends_id: number | null; total_ends: number | null; }

interface BobbinRow {
  /** jobwork_bobbin_issue.id (migration 141). One row per
   *  "issued N pieces of bobbin X to party Y on date Z" event. */
  id: number;
  /** Canonical bobbin master id (BB-<ends>) this issue refers to.
   *  Used by Restock to clone the row and by the master dropdown. */
  bobbin_id: number;
  code: string; description: string;
  ends_per_bobbin: number; bobbin_metre: number; quantity: number; gst_pct: number;
  bobbin_price: number; jobwork_party_id: number | null; vendor_id: number | null;
  /** Unified-party FK pointing at the bobbin supplier. Selected on
   *  load alongside vendor_id. Used as the default supplier when
   *  logging a bobbin-return back to the source. */
  supplier_party_id: number | null;
  purchase_date: string | null; invoice_no: string | null; is_lurex: boolean;
  notes: string | null;
  /** Original purchase quantity, preserved by migration 090. Used in
   *  the read-only "history" display so reductions by fabric receipts
   *  don't shrink the issued quantity shown on this page. */
  original_quantity: number | null;
}

interface BobbinMasterOpt {
  id: number;
  code: string;
  ends_per_bobbin: number;
  bobbin_metre: number | null;
  is_lurex: boolean;
}
interface WarpBeamRow {
  id: number; jobwork_party_id: number;
  fabric_quality_id: number | null; warp_count_id: number | null;
  given_date: string; total_ends: number | null;
  tape_length_m: number | null; beam_count: number;
  total_metres: number | null; reference_no: string | null; notes: string | null;
  supplier_party_id: number | null;
  /** Original issued metres preserved from migration 090. Used on the
   *  history list so reductions don't shrink the display. */
  original_metres: number | null;
  /** Pavu link â€” singular FK on 1-to-1 mirror rows created by the
   *  Pavu Master sync; null on aggregate rows. */
  pavu_id: number | null;
  /** Pavu ids on aggregate rows created by the Add warp beam given
   *  form; null on mirror rows. The Release action reverts whichever
   *  set is non-null. */
  pavu_ids: number[] | null;
}
interface WeftBagRow {
  id: number; jobwork_party_id: number;
  yarn_count_id: number | null; given_date: string;
  bag_count: number | null; total_kg: number | null;
  reference_no: string | null; notes: string | null;
  supplier_party_id: number | null;
  /** Original issued kg preserved from migration 090. Used on the
   *  history list so reductions don't shrink the display. */
  original_kg: number | null;
}

/** One bobbin-return event. Each row is an empty-bobbin shipment back
 *  to the supplier after weaving consumed the yarn. */
interface BobbinReturnRow {
  id: number;
  bobbin_id: number;
  supplier_party_id: number | null;
  jobwork_party_id: number | null;
  return_date: string;
  quantity_pcs: number;
  reference_no: string | null;
  notes: string | null;
}
interface WarpYarnRow {
  id: number;
  jobwork_party_id: number;
  fabric_quality_id: number | null;
  ends_id: number | null;
  warp_count_id: number | null;
  given_date: string;
  total_kg: number | null;
  sizing_rate_per_kg: number | null;
  total_cost: number | null;
  reference_no: string | null;
  notes: string | null;
  supplier_party_id: number | null;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDate(s: string | null): string {
  if (!s) return '-';
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + d.getFullYear();
}

export default function JobworkPage(): React.ReactElement {
  const supabase = createClient();
  const pathname = usePathname();
  const variant: PageVariant = pathname.startsWith('/app/outsource') ? VARIANTS.outsource : VARIANTS.jobwork;
  const [tab, setTab] = useState<Tab>('dc');
  const [parties, setParties] = useState<PartyOpt[]>([]);
  const [allParties, setAllParties] = useState<PartyOpt[]>([]);
  const [bobbinSuppliers, setBobbinSuppliers] = useState<PartyOpt[]>([]);
  const [sizingParties, setSizingParties] = useState<PartyOpt[]>([]);
  const [fabricDefaults, setFabricDefaults] = useState<Map<number, FabricDefaults>>(new Map());
  const [qualities, setQualities] = useState<QualityOpt[]>([]);
  const [counts, setCounts] = useState<CountOpt[]>([]);
  const [endsOptions, setEndsOptions] = useState<EndsOpt[]>([]);
  const [bobbins, setBobbins] = useState<BobbinRow[]>([]);
  const [bobbinMasters, setBobbinMasters] = useState<BobbinMasterOpt[]>([]);
  const [bobbinReturns, setBobbinReturns] = useState<BobbinReturnRow[]>([]);
  const [warpBeams, setWarpBeams] = useState<WarpBeamRow[]>([]);
  const [weftBags, setWeftBags] = useState<WeftBagRow[]>([]);
  const [warpYarns, setWarpYarns] = useState<WarpYarnRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // Resolve party_type ids for the typed dropdowns (Bobbin Supplier for
    // bobbin restock, Sizing Party for the warp-beam supplier). If a type
    // row doesn't exist yet, the corresponding list falls back to empty -
    // user can create it in Settings -> Party Types.
    const ptRes = await sb
      .from('party_type_master')
      .select('id, name')
      .in('name', ['Bobbin Supplier', 'Sizing Party']);
    const ptList: Array<{ id: number; name: string }> = (ptRes.data ?? []) as Array<{ id: number; name: string }>;
    const bobbinSupplierTypeId = ptList.find((t) => t.name === 'Bobbin Supplier')?.id ?? null;
    const sizingPartyTypeId    = ptList.find((t) => t.name === 'Sizing Party')?.id ?? null;

    const [p, ap, bs, sp, q, c, b, w, wb, br, bm, em, wy] = await Promise.all([
      // Filter jobwork_party by kind so the same code services both
      // /app/jobwork (kind='jobwork') and /app/outsource (kind='outsource').
      sb.from('jobwork_party').select('id, code, name').eq('status', 'active').eq('kind', variant.kind).order('name'),
      sb.from('party').select('id, code, name').eq('status', 'active').order('name'),
      bobbinSupplierTypeId === null
        ? Promise.resolve({ data: [], error: null })
        : sb.from('party').select('id, code, name').eq('status', 'active').contains('party_type_ids', [bobbinSupplierTypeId]).order('name'),
      sizingPartyTypeId === null
        ? Promise.resolve({ data: [], error: null })
        : sb.from('party').select('id, code, name').eq('status', 'active').contains('party_type_ids', [sizingPartyTypeId]).order('name'),
      // calc_snapshot carries the warp_count_id, ends_id, total_ends entered
      // on the Fabric Quality form - we use it to auto-fill the warp beam
      // form when a fabric is picked.
      sb.from('fabric_quality').select('id, code, name, production_mode, calc_snapshot').eq('active', true).order('name'),
      sb.from('yarn_count').select('id, code, display_name').neq('status', 'archived').order('code'),
      // Bobbin Given = events from jobwork_bobbin_issue (migration 141).
      // The bobbin master is joined so the row still carries
      // ends_per_bobbin / bobbin_metre / code / is_lurex for display â€”
      // those properties belong to the bobbin master, not the issue
      // event. We reshape the result into BobbinRow below so the
      // existing BobbinTab UI keeps working.
      sb.from('jobwork_bobbin_issue').select(`id, jobwork_party_id, bobbin_id, issue_date, pieces_issued, original_pieces, supplier_party_id, reference_no, notes,
              bobbin:bobbin_id ( id, code, ends_per_bobbin, bobbin_metre, is_lurex )`).eq('status', 'active').order('issue_date', { ascending: false, nullsFirst: false }),
      sb.from('jobwork_warp_beam').select('id, jobwork_party_id, fabric_quality_id, warp_count_id, given_date, total_ends, tape_length_m, beam_count, total_metres, original_metres, reference_no, notes, supplier_party_id, pavu_id, pavu_ids').eq('status', 'active').order('given_date', { ascending: false }),
      sb.from('jobwork_weft_bag').select('id, jobwork_party_id, yarn_count_id, given_date, bag_count, total_kg, original_kg, reference_no, notes, supplier_party_id').eq('status', 'active').order('given_date', { ascending: false }),
      // Bobbin returns - empty pieces sent back to the supplier after
      // weaving consumed the yarn. We aggregate these per bobbin in
      // BobbinTab to show "Returned" counts.
      sb.from('bobbin_return').select('id, bobbin_id, supplier_party_id, jobwork_party_id, return_date, quantity_pcs, reference_no, notes').eq('status', 'active').order('return_date', { ascending: false }),
      // Bobbin master filtered to production_mode = the current variant
      // (jobwork on /app/jobwork, outsource on /app/outsource). Migration
      // 142 makes bobbin one row per (ends, mode), so the same page can
      // service both flows by just changing the eq below.
      sb.from('bobbin').select('id, code, ends_per_bobbin, bobbin_metre, is_lurex').eq('production_mode', variant.kind).neq('status', 'archived').order('ends_per_bobbin'),
      // Ends master â€” populates the Ends spec dropdown on the Warp Yarn
      // tab. Same shape used by the Fabric Quality form.
      sb.from('ends_master').select('id, code, name').eq('active', true).order('ends_count'),
      // Warp yarn (sizing) given â€” parallels jobwork_warp_beam /
      // jobwork_weft_bag. Filtered to active rows only.
      sb.from('jobwork_warp_yarn').select('id, jobwork_party_id, fabric_quality_id, ends_id, warp_count_id, given_date, total_kg, sizing_rate_per_kg, total_cost, reference_no, notes, supplier_party_id').eq('status', 'active').order('given_date', { ascending: false }),
    ]);
    // Don't propagate the bobbin_return error if migration 093 hasn't
    // been applied yet - we just treat it as empty.
    const errObj = [p, ap, bs, sp, q, c, b, w, wb, bm, em, wy].find((r) => r.error);
    if (errObj) {
      setError(errObj.error.message);
    } else {
      // Build map: fabric_quality_id -> {warp_count_id, ends_id, total_ends}
      // from each fabric's calc_snapshot. Snapshot fields are stored as
      // strings (form state), so coerce to number.
      type QualityRow = { id: number; code: string | null; name: string; production_mode: 'inhouse' | 'job_work' | 'outsourcing' | null; calc_snapshot: Record<string, unknown> | null };
      const qRows = (q.data ?? []) as QualityRow[];
      const defaults = new Map<number, FabricDefaults>();
      const toNumOrNull = (v: unknown): number | null => {
        if (v === null || v === undefined || v === '') return null;
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) ? n : null;
      };
      for (const row of qRows) {
        const snap = row.calc_snapshot ?? {};
        const endsId      = toNumOrNull(snap['endsId']);
        const warpCountId = toNumOrNull(snap['warpCountId']);
        const totalEnds   = toNumOrNull(snap['totalEnds']);
        if (endsId !== null || warpCountId !== null || totalEnds !== null) {
          defaults.set(row.id, { warp_count_id: warpCountId, ends_id: endsId, total_ends: totalEnds });
        }
      }

      setParties((p.data ?? []) as PartyOpt[]);
      setAllParties((ap.data ?? []) as PartyOpt[]);
      setBobbinSuppliers((bs.data ?? []) as PartyOpt[]);
      setSizingParties((sp.data ?? []) as PartyOpt[]);
      setQualities(qRows.map((r) => ({ id: r.id, code: r.code, name: r.name, production_mode: r.production_mode })));
      setCounts((c.data ?? []) as CountOpt[]);
      setFabricDefaults(defaults);
      // Reshape jobwork_bobbin_issue rows into BobbinRow so the
      // existing BobbinTab UI can render them without further changes.
      // The id is the issue id (writes/updates use this); bobbin_id is
      // the canonical master.
      type IssueWithBobbin = {
        id: number; jobwork_party_id: number; bobbin_id: number;
        issue_date: string | null;
        pieces_issued: number | string | null;
        original_pieces: number | string | null;
        supplier_party_id: number | null;
        reference_no: string | null; notes: string | null;
        bobbin: { id: number; code: string | null; ends_per_bobbin: number | null;
                  bobbin_metre: number | string | null; is_lurex: boolean | null } | null;
      };
      const reshaped: BobbinRow[] = ((b.data ?? []) as IssueWithBobbin[]).map((r) => ({
        id: r.id,
        bobbin_id: r.bobbin_id,
        code: r.bobbin?.code ?? `JB-${r.id}`,
        description: r.notes ?? '',
        ends_per_bobbin: Number(r.bobbin?.ends_per_bobbin ?? 0),
        bobbin_metre: Number(r.bobbin?.bobbin_metre ?? 0),
        quantity: Number(r.pieces_issued ?? 0),
        gst_pct: 0,
        bobbin_price: 0,
        jobwork_party_id: r.jobwork_party_id,
        vendor_id: null,
        supplier_party_id: r.supplier_party_id,
        purchase_date: r.issue_date,
        invoice_no: r.reference_no,
        is_lurex: Boolean(r.bobbin?.is_lurex ?? false),
        notes: r.notes,
        original_quantity: r.original_pieces == null ? null : Number(r.original_pieces),
      }));
      setBobbins(reshaped);
      setBobbinMasters((bm.data ?? []) as BobbinMasterOpt[]);
      setWarpBeams((w.data ?? []) as WarpBeamRow[]);
      setWeftBags((wb.data ?? []) as WeftBagRow[]);
      setEndsOptions((em.data ?? []) as EndsOpt[]);
      setWarpYarns((wy.data ?? []) as WarpYarnRow[]);
      // bobbin_return table may not exist yet (migration 093). Tolerate
      // missing data without breaking the page.
      setBobbinReturns(((br?.data ?? []) as BobbinReturnRow[]) ?? []);
      setError(null);
    }
    setLoading(false);
  }, [supabase, variant.kind]);

  useEffect(() => { void load(); }, [load]);

  const partyById = useMemo(() => new Map(parties.map((p) => [p.id, p])), [parties]);
  const allPartyById = useMemo(() => new Map(allParties.map((p) => [p.id, p])), [allParties]);
  const qualityById = useMemo(() => new Map(qualities.map((q) => [q.id, q])), [qualities]);
  const countById = useMemo(() => new Map(counts.map((c) => [c.id, c])), [counts]);
  const endsById = useMemo(() => new Map(endsOptions.map((e) => [e.id, e])), [endsOptions]);

  return (
    <div>
      <PageHeader
        title={variant.title}
        subtitle={variant.subtitle}
        actions={
          <Link href={variant.manageHref} className="btn-ghost">
            {variant.manageLabel}
          </Link>
        }
      />

      {/* Warp beam given is OUTSOURCE-ONLY now â€” jobwork parties no
          longer receive warp beams. The tab is suppressed when
          variant.kind === 'jobwork', and we redirect the active tab
          off it if the operator was already viewing it. */}
      <div className="border-b border-line mb-4 flex gap-1 flex-wrap">
        <TabButton active={tab === 'dc'}        onClick={() => setTab('dc')}>DC</TabButton>
        <TabButton active={tab === 'bobbin'}    onClick={() => setTab('bobbin')}>Bobbin given</TabButton>
        {/* Warp beam given — shown on BOTH jobwork and outsource. The
            inside-the-tab sizing-job cascade only runs for outsource
            (kind !== 'outsource' early-returns), so jobwork users get a
            simpler add form without auto-narrowed sizing dropdowns. */}
        <TabButton active={tab === 'warp_beam'} onClick={() => setTab('warp_beam')}>Warp beam given</TabButton>
        <TabButton active={tab === 'weft_bag'}  onClick={() => setTab('weft_bag')}>Weft bag given</TabButton>
        {/* Warp yarn given — hidden on jobwork (operators use Warp Beam
            instead). Still shown on outsource where the sizing /
            warp-yarn flow makes sense. */}
        {variant.kind === 'outsource' && (
          <TabButton active={tab === 'warp_yarn'} onClick={() => setTab('warp_yarn')}>Warp yarn given</TabButton>
        )}
        <TabButton active={tab === 'payment'}   onClick={() => setTab('payment')}>Payment Status</TabButton>
        {variant.kind === 'outsource' && (
          <TabButton active={tab === 'weavers'} onClick={() => setTab('weavers')}>Weavers</TabButton>
        )}
      </div>

      {error && <div className="card p-3 mb-3 text-err text-sm">{error}</div>}
      {loading ? (
        <div className="card p-6 text-ink-mute text-sm flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading...
        </div>
      ) : tab === 'dc' ? (
        <JobworkDcTab parties={parties} qualities={qualities} kind={variant.kind} />
      ) : tab === 'bobbin' ? (
        <BobbinTab
          rows={bobbins.filter((b) => b.jobwork_party_id != null && partyById.has(b.jobwork_party_id))}
          returns={bobbinReturns}
          partyById={partyById}
          bobbinSuppliers={bobbinSuppliers}
          allParties={allParties}
          bobbinMasters={bobbinMasters}
          partyLabel={variant.partyLabel}
          onChanged={load}
        />
      ) : tab === 'warp_beam' ? (
        <WarpBeamTab
          rows={warpBeams.filter((w) => w.jobwork_party_id != null && partyById.has(w.jobwork_party_id))}
          parties={parties} qualities={qualities} counts={counts}
          sizingParties={sizingParties} fabricDefaults={fabricDefaults}
          partyById={partyById} qualityById={qualityById} countById={countById}
          partyLabel={variant.partyLabel}
          kind={variant.kind}
          onChanged={load}
        />
      ) : tab === 'weft_bag' ? (
        <WeftBagTab
          rows={weftBags.filter((w) => w.jobwork_party_id != null && partyById.has(w.jobwork_party_id))}
          parties={parties} counts={counts} allParties={allParties}
          partyById={partyById} countById={countById} allPartyById={allPartyById}
          partyLabel={variant.partyLabel}
          onChanged={load}
        />
      ) : tab === 'warp_yarn' && variant.kind === 'outsource' ? (
        <WarpYarnTab
          rows={warpYarns.filter((r) => r.jobwork_party_id != null && partyById.has(r.jobwork_party_id))}
          parties={parties} qualities={qualities} counts={counts}
          endsOptions={endsOptions} allParties={allParties}
          partyById={partyById} qualityById={qualityById} countById={countById}
          endsById={endsById} allPartyById={allPartyById}
          partyLabel={variant.partyLabel}
          onChanged={load}
        />
      ) : tab === 'weavers' && variant.kind === 'outsource' ? (
        <WeaversTab parties={parties} />
      ) : (
        <JobworkPaymentTab parties={parties} kind={variant.kind} />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick}
      className={'px-4 py-2 text-sm font-semibold border-b-2 -mb-px ' +
        (active ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-ink-soft hover:text-ink')}>
      {children}
    </button>
  );
}

/* ===== Weavers tab â€” read-only directory of Outsource Weaver parties =====
 *
 * The `parties` prop on this page comes from the `jobwork_party` table
 * (filtered by `kind='outsource'`), not the unified `party` master, so
 * row links go to the jobwork-parties routes â€” /app/parties/[id] would
 * 404 because the ids don't exist on `party`.
 *
 * We also fetch each row's extra columns (gstin / phone / city) from
 * the same jobwork_party table so the display stays consistent with
 * the route the edit pencil opens.
 */
function WeaversTab({ parties }: { parties: PartyOpt[] }): React.ReactElement {
  const [extra, setExtra] = useState<Map<number, { gstin: string | null; phone: string | null; city: string | null }>>(new Map());
  const supabase = createClient();

  useEffect(() => {
    if (parties.length === 0) { setExtra(new Map()); return; }
    let cancelled = false;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data } = await sb
        .from('jobwork_party')
        .select('id, gstin, phone, city')
        .in('id', parties.map((p) => p.id));
      if (cancelled) return;
      const m = new Map<number, { gstin: string | null; phone: string | null; city: string | null }>();
      for (const p of (data ?? []) as Array<{ id: number; gstin: string | null; phone: string | null; city: string | null }>) {
        m.set(p.id, { gstin: p.gstin, phone: p.phone, city: p.city });
      }
      setExtra(m);
    })();
    return () => { cancelled = true; };
  }, [parties, supabase]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p className="text-sm text-ink-mute">
          Outsource Weaver parties â€” {parties.length} total. Edit a row to manage GSTIN, address, and contact info.
        </p>
        <Link href="/app/jobwork-parties/new?kind=outsource" className="btn-primary text-xs">
          <Plus className="w-3.5 h-3.5" /> Add weaver
        </Link>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[800px]">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left  px-4 py-3">Code</th>
              <th className="text-left  px-4 py-3">Name</th>
              <th className="text-left  px-4 py-3 hidden md:table-cell">GSTIN</th>
              <th className="text-left  px-4 py-3 hidden lg:table-cell">Phone</th>
              <th className="text-left  px-4 py-3 hidden lg:table-cell">City</th>
              <th className="text-right px-4 py-3 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {parties.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-ink-soft">
                  No Outsource Weaver parties yet.{' '}
                  <Link href="/app/jobwork-parties/new?kind=outsource" className="text-indigo font-semibold">
                    Add the first one &rarr;
                  </Link>
                </td>
              </tr>
            ) : parties.map((p) => {
              const x = extra.get(p.id);
              return (
                <tr key={p.id} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-4 py-3 font-mono text-xs">{p.code}</td>
                  <td className="px-4 py-3 font-semibold">
                    <Link href={`/app/jobwork-parties/${p.id}`} className="text-ink hover:text-indigo">{p.name}</Link>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell font-mono text-xs">{x?.gstin ?? 'â€”'}</td>
                  <td className="px-4 py-3 hidden lg:table-cell text-ink-soft text-xs">{x?.phone ?? 'â€”'}</td>
                  <td className="px-4 py-3 hidden lg:table-cell text-ink-soft text-xs">{x?.city ?? 'â€”'}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/app/jobwork-parties/${p.id}`}
                      className="p-1 rounded hover:bg-indigo-50 text-indigo-700 inline-flex"
                      title="Edit weaver"
                    >
                      <Pencil className="w-4 h-4" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ===== Restock mini-form (popover under a row) ===== */
function RestockForm({ onCancel, onSave, parties, qtyFields }: {
  onCancel: () => void;
  onSave: (data: { given_date: string; supplier_party_id: string; qty: Record<string, string> }) => Promise<void>;
  parties: PartyOpt[];
  qtyFields: { key: string; label: string; step?: number }[];
}) {
  const [date, setDate] = useState(todayISO());
  const [supplier, setSupplier] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  return (
    <div className="p-3 bg-indigo-50/40 border-y border-indigo-200 grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
      <div className="min-w-0">
        <label className="label text-[10px]">Received date *</label>
        <input type="date" className="input h-8 text-sm w-full" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      {qtyFields.map((f) => (
        <div key={f.key} className="min-w-0">
          <label className="label text-[10px]">{f.label}</label>
          <input type="number" step={f.step ?? 1} className="input num h-8 text-sm w-full"
            value={qty[f.key] ?? ''} onChange={(e) => setQty({ ...qty, [f.key]: e.target.value })} />
        </div>
      ))}
      {/* Supplier party spans 2 grid cols so long names like "ABC SIZING
          TEXTILES PRIVATE LIMITED" stay readable. */}
      <div className="min-w-0 md:col-span-2">
        <label className="label text-[10px]">Supplier party</label>
        <select className="input h-8 text-sm w-full" value={supplier} onChange={(e) => setSupplier(e.target.value)} title={parties.find((p) => String(p.id) === supplier)?.name}>
          <option value="">--- none ---</option>
          {parties.map((p) => (
            <option key={p.id} value={p.id} title={p.name}>{p.name}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-1.5 justify-end min-w-0 md:col-span-2">
        <button type="button" onClick={onCancel} className="btn-ghost h-8 text-xs">Cancel</button>
        <button type="button" disabled={busy} onClick={async () => {
          setBusy(true);
          await onSave({ given_date: date, supplier_party_id: supplier, qty });
          setBusy(false);
        }} className="btn-primary h-8 text-xs whitespace-nowrap">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Restock
        </button>
      </div>
    </div>
  );
}

/* ===== Bobbin tab ===== */
function BobbinTab({ rows, returns, partyById, bobbinSuppliers, allParties, bobbinMasters, partyLabel, onChanged }: {
  rows: BobbinRow[]; returns: BobbinReturnRow[];
  partyById: Map<number, PartyOpt>; bobbinSuppliers: PartyOpt[]; allParties: PartyOpt[];
  /** Canonical bobbin master list (1:1 with bobbin_ends_master). Used
   *  to populate the "Pick bobbin" dropdown on the Add and Restock
   *  forms so the operator selects an existing spec rather than typing
   *  ends / metres / price every time. */
  bobbinMasters: BobbinMasterOpt[];
  /** Label for the dropdown that picks which party to give the bobbin
   *  to â€” "Jobwork Party" on /app/jobwork, "Outsourcing party" on
   *  /app/outsource. */
  partyLabel: string;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [restockId, setRestockId] = useState<number | null>(null);
  const [returnId, setReturnId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<BobbinRow | null>(null);
  // Total qty returned per bobbin_id - shown alongside the "given" qty
  // so the operator sees the outstanding balance with the supplier.
  const returnedByBobbinId = new Map<number, number>();
  for (const r of returns) {
    if (r.bobbin_id == null) continue;
    returnedByBobbinId.set(
      r.bobbin_id,
      (returnedByBobbinId.get(r.bobbin_id) ?? 0) + Number(r.quantity_pcs ?? 0),
    );
  }
  void allParties;
  // Add-new form state. The form panel only renders when showAdd=true so
  // the table isn't pushed down by an empty form on first load.
  const [showAdd, setShowAdd] = useState<boolean>(false);
  const [addBusy, setAddBusy] = useState<boolean>(false);
  // â”€â”€â”€ Multi-item Add form â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Top section (party + date + supplier + reference) is shared
  // across every line item in this submission. Items[] holds one
  // entry per bobbin spec, each with its own quantity. One Save
  // inserts N rows into jobwork_bobbin_issue in a single Promise.all.
  interface AddItem {
    bobbin_id: string;
    qty: string;
    /** Metres per piece. Prefills from the bobbin master when a bobbin
     *  is picked, but the operator can override (partial bobbin /
     *  short piece / typo correction). Used only for the in-form
     *  Total m calculation â€” the bobbin master's m/pc is the canonical
     *  value and is not changed by editing this field. */
    metre_per_pc: string;
  }
  function makeEmptyItem(): AddItem { return { bobbin_id: '', qty: '', metre_per_pc: '' }; }
  const [addForm, setAddForm] = useState<{
    jobwork_party_id: string;
    purchase_date: string;
    supplier_party_id: string;
    reference_no: string;
    notes: string;
    items: AddItem[];
  }>({
    jobwork_party_id: '',
    purchase_date: todayISO(),
    supplier_party_id: '',
    reference_no: '',
    notes: '',
    items: [makeEmptyItem()],
  });

  function resetAddForm(): void {
    setAddForm({
      jobwork_party_id: '',
      purchase_date: todayISO(),
      supplier_party_id: '',
      reference_no: '',
      notes: '',
      items: [makeEmptyItem()],
    });
  }

  function addItemRow(): void {
    setAddForm((f) => ({ ...f, items: [...f.items, makeEmptyItem()] }));
  }
  function removeItemRow(idx: number): void {
    setAddForm((f) => ({
      ...f,
      items: f.items.length > 1 ? f.items.filter((_, i) => i !== idx) : f.items,
    }));
  }
  function patchItem(idx: number, patch: Partial<AddItem>): void {
    setAddForm((f) => ({
      ...f,
      items: f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    }));
  }

  // When the operator picks a bobbin we prefill metre_per_pc from the
  // bobbin master. The form's metre_per_pc field remains editable so
  // a partial bobbin or typo can be corrected for this submission's
  // total calculation only.
  function pickBobbinForItem(idx: number, bobbinId: string): void {
    const bm = bobbinId === '' ? null : bobbinMasters.find((m) => m.id === Number(bobbinId)) ?? null;
    const prefill = bm?.bobbin_metre != null ? String(bm.bobbin_metre) : '';
    patchItem(idx, { bobbin_id: bobbinId, metre_per_pc: prefill });
  }

  async function addBobbin(): Promise<void> {
    const partyId = addForm.jobwork_party_id === '' ? null : Number(addForm.jobwork_party_id);
    if (partyId === null) { window.alert('Select a jobwork party.'); return; }
    // Each non-empty item becomes one row. Empty rows (no bobbin
    // picked) are skipped so the operator can leave trailing blank
    // rows around without it being an error.
    const validItems = addForm.items.filter((it) => it.bobbin_id !== '' && Number(it.qty) > 0);
    if (validItems.length === 0) {
      window.alert('Pick a bobbin and enter a positive quantity for at least one line.');
      return;
    }
    // Cross-check: any line with bobbin picked but qty <= 0 â€” surface
    // the row number so the operator can fix it.
    const badIdx = addForm.items.findIndex((it) => it.bobbin_id !== '' && !(Number(it.qty) > 0));
    if (badIdx !== -1) {
      window.alert(`Line ${badIdx + 1}: enter a positive quantity (pcs).`);
      return;
    }
    setAddBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const payloads = validItems.map((it) => ({
      jobwork_party_id: partyId,
      bobbin_id: Number(it.bobbin_id),
      issue_date: addForm.purchase_date,
      pieces_issued: Number(it.qty),
      original_pieces: Number(it.qty),
      supplier_party_id: addForm.supplier_party_id === '' ? null : Number(addForm.supplier_party_id),
      reference_no: addForm.reference_no.trim() === '' ? null : addForm.reference_no.trim(),
      notes: addForm.notes.trim() === '' ? null : addForm.notes.trim(),
      status: 'active',
    }));
    // Single INSERT with the array â€” Postgres processes it as one
    // statement, all-or-nothing.
    const { error } = await sb.from('jobwork_bobbin_issue').insert(payloads);
    setAddBusy(false);
    if (error) { window.alert('Add failed: ' + error.message); return; }
    resetAddForm();
    setShowAdd(false);
    onChanged();
  }

  async function restock(parent: BobbinRow, data: { given_date: string; supplier_party_id: string; qty: Record<string, string> }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const qty = Number(data.qty.qty ?? 0);
    if (qty <= 0) { window.alert('Quantity required'); return; }
    const supplierPartyId = data.supplier_party_id === '' ? null : Number(data.supplier_party_id);
    // Restock = a fresh jobwork_bobbin_issue row pointing at the same
    // canonical bobbin master. We never spawn a new bobbin code.
    const payload = {
      jobwork_party_id: parent.jobwork_party_id,
      bobbin_id: parent.bobbin_id,
      issue_date: data.given_date,
      pieces_issued: qty,
      original_pieces: qty,
      supplier_party_id: supplierPartyId,
      reference_no: `RESTOCK-${parent.code}`,
      notes: 'Restock of ' + parent.code
             + (supplierPartyId !== null ? ' from party #' + supplierPartyId : ''),
      status: 'active',
    };
    const { error } = await sb.from('jobwork_bobbin_issue').insert(payload);
    if (error) { window.alert('Restock failed: ' + error.message); return; }
    setRestockId(null);
    onChanged();
  }

  async function saveEdit(): Promise<void> {
    if (!editForm) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    // Editing the issued qty resets BOTH original_pieces (the history
    // value) and pieces_issued (the live balance). The bobbin master
    // properties (ends, metre, lurex) live on the bobbin master and are
    // not editable from this form â€” they belong to a different concern.
    const editedQty = Number(editForm.original_quantity ?? editForm.quantity ?? 0);
    const payload = {
      jobwork_party_id: editForm.jobwork_party_id,
      issue_date: editForm.purchase_date,
      pieces_issued: editedQty,
      original_pieces: editedQty,
      notes: editForm.notes,
    };
    const { error } = await sb.from('jobwork_bobbin_issue').update(payload).eq('id', editForm.id);
    if (error) { window.alert('Save failed: ' + error.message); return; }
    setEditingId(null);
    setEditForm(null);
    onChanged();
  }

  async function del(id: number): Promise<void> {
    if (!window.confirm('Delete this bobbin entry? This cannot be undone.')) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    // Soft-delete by status flip - matches what the page already filters
    // out via .eq('status', 'active').
    const { error } = await sb.from('jobwork_bobbin_issue').update({ status: 'archived' }).eq('id', id);
    if (error) { window.alert('Delete failed: ' + error.message); return; }
    onChanged();
  }

  /** Log a return of empty bobbin pieces back to the supplier. */
  async function logReturn(parent: BobbinRow, data: { given_date: string; supplier_party_id: string; qty: Record<string, string> }): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const qty = Math.trunc(Number(data.qty.qty ?? 0));
    if (qty <= 0) { window.alert('Quantity must be greater than zero.'); return; }
    const payload = {
      bobbin_id: parent.id,
      supplier_party_id: data.supplier_party_id === '' ? (parent.supplier_party_id ?? null) : Number(data.supplier_party_id),
      jobwork_party_id: parent.jobwork_party_id,
      return_date: data.given_date,
      quantity_pcs: qty,
      reference_no: null,
      notes: null,
      status: 'active',
    };
    const { error } = await sb.from('bobbin_return').insert(payload);
    if (error) { window.alert('Return failed: ' + error.message); return; }
    setReturnId(null);
    onChanged();
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-ink-mute">Bobbin issued to jobwork parties. Use Add to log a new bobbin spec; Restock to log a fresh batch of an existing spec.</p>
        <button type="button" onClick={() => setShowAdd((v) => !v)} className="btn-primary">
          {showAdd ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showAdd ? 'Cancel' : 'Add bobbin given'}
        </button>
      </div>

      {/* Inline add form â€” multi-item. Party + date + supplier picked
          once at the top, then a list of line items (bobbin + qty,
          with ends and m/pc + total metres auto-filled from the
          master). One Save inserts N rows into jobwork_bobbin_issue. */}
      {showAdd && (
        <div className="card p-3 mb-3 space-y-3">
          {/* Top: shared facts for every line in this submission */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="label text-xs">{partyLabel} *</label>
              <select
                className="input h-9 text-sm"
                value={addForm.jobwork_party_id}
                onChange={(e) => setAddForm({ ...addForm, jobwork_party_id: e.target.value })}
              >
                <option value="">--- select ---</option>
                {Array.from(partyById.values()).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label text-xs">Issue date *</label>
              <input
                type="date"
                className="input h-9 text-sm"
                value={addForm.purchase_date}
                onChange={(e) => setAddForm({ ...addForm, purchase_date: e.target.value })}
              />
            </div>
            <div>
              <label className="label text-xs">Supplier (optional)</label>
              <select
                className="input h-9 text-sm"
                value={addForm.supplier_party_id}
                onChange={(e) => setAddForm({ ...addForm, supplier_party_id: e.target.value })}
              >
                <option value="">---</option>
                {bobbinSuppliers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label text-xs">Reference (DC / Slip no.)</label>
              <input
                className="input h-9 text-sm"
                placeholder="(optional)"
                value={addForm.reference_no}
                onChange={(e) => setAddForm({ ...addForm, reference_no: e.target.value })}
              />
            </div>
            <div className="md:col-span-4">
              <label className="label text-xs">Notes</label>
              <input
                className="input h-9 text-sm"
                placeholder="(applies to every line below)"
                value={addForm.notes}
                onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })}
              />
            </div>
          </div>

          {/* Line items: one row per bobbin spec being issued. Column
              order Bobbin â†’ Qty â†’ M/pc â†’ Total m so the operator
              reads the same way they think: "BB-JW-36, 10 pcs of
              2000 m/pc = 20,000 m". M/pc prefills from the master but
              is editable so partial bobbins / short pieces can be
              entered. */}
          <div className="border border-line/40 rounded-md overflow-hidden">
            <table className="w-full text-sm table-fixed">
              {/* Fixed column widths so the Bobbin select doesn't eat
                  all the space and push Qty / M/pc inputs awkwardly
                  far apart with stray gaps. */}
              <colgroup>
                <col className="w-10" />     {/* #            */}
                <col />                       {/* Bobbin (flex) */}
                <col className="w-32" />     {/* Qty          */}
                <col className="w-32" />     {/* M/pc         */}
                <col className="w-28" />     {/* Total m      */}
                <col className="w-12" />     {/* delete       */}
              </colgroup>
              <thead className="bg-cloud/60 text-[10px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="px-2 py-2 text-left">#</th>
                  <th className="px-2 py-2 text-left">Bobbin *</th>
                  <th className="px-2 py-2 text-right">Qty (pcs) *</th>
                  <th className="px-2 py-2 text-right">M/pc</th>
                  <th className="px-2 py-2 text-right">Total m</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {addForm.items.map((it, idx) => {
                  const bm = it.bobbin_id === '' ? null : bobbinMasters.find((m) => m.id === Number(it.bobbin_id)) ?? null;
                  const qtyN = Number(it.qty || 0);
                  const perPc = Number(it.metre_per_pc || 0);
                  const totalM = qtyN > 0 && perPc > 0 ? qtyN * perPc : 0;
                  return (
                    <tr key={idx} className="border-t border-line/40 align-middle">
                      <td className="px-2 py-1.5 text-ink-mute">{idx + 1}</td>
                      <td className="px-2 py-1.5">
                        <select
                          className="input h-8 text-xs w-full"
                          value={it.bobbin_id}
                          onChange={(e) => pickBobbinForItem(idx, e.target.value)}
                        >
                          <option value="">--- pick ---</option>
                          {bobbinMasters.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.code} ({b.ends_per_bobbin} ends{b.is_lurex ? ' Â· lurex' : ''})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min={1}
                          className="input num h-8 text-xs w-full text-right"
                          value={it.qty}
                          onChange={(e) => patchItem(idx, { qty: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          className="input num h-8 text-xs w-full text-right"
                          value={it.metre_per_pc}
                          placeholder={bm?.bobbin_metre != null ? String(bm.bobbin_metre) : ''}
                          onChange={(e) => patchItem(idx, { metre_per_pc: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right num text-xs font-semibold">
                        {totalM > 0 ? totalM.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : 'â€”'}
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => removeItemRow(idx)}
                          disabled={addForm.items.length === 1}
                          title="Remove line"
                          className="p-1 rounded text-rose-600 hover:bg-rose-50 disabled:opacity-30"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-cloud/30 border-t border-line/40">
                <tr>
                  <td colSpan={4} className="px-2 py-2">
                    <button
                      type="button"
                      onClick={addItemRow}
                      className="text-xs text-indigo-700 inline-flex items-center gap-1 hover:underline"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add line
                    </button>
                  </td>
                  <td className="px-2 py-2 text-right num text-xs font-semibold">
                    {(() => {
                      const grand = addForm.items.reduce((s, it) => {
                        const qtyN = Number(it.qty || 0);
                        const perPc = Number(it.metre_per_pc || 0);
                        return s + (qtyN > 0 && perPc > 0 ? qtyN * perPc : 0);
                      }, 0);
                      return grand > 0 ? grand.toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' m' : 'â€”';
                    })()}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-[10px] text-ink-mute">
            Bobbins are managed in Settings &rarr; Bobbin Master. M/pc prefills from the master when you pick a bobbin, but you can override it here for partial bobbins or short pieces â€” the master value is not changed.
          </p>

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => { setShowAdd(false); resetAddForm(); }} className="btn-secondary text-xs">
              Cancel
            </button>
            <button
              type="button"
              onClick={addBobbin}
              disabled={addBusy}
              className="btn-primary text-xs"
            >
              {addBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Save all
            </button>
          </div>
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              {/* Date is the leftmost column so each transaction's
                  given-date is immediately visible â€” matches the Warp
                  Beam / Weft Bag tabs. */}
              <th className="text-left px-3 py-3">Date</th>
              <th className="text-left px-3 py-3">Code</th>
              <th className="text-left px-3 py-3">Party</th>
              <th className="text-left px-3 py-3">Description</th>
              <th className="text-right px-3 py-3">Ends</th>
              <th className="text-right px-3 py-3" title="Metres per piece">M/pc</th>
              <th className="text-right px-3 py-3">Qty (pcs)</th>
              <th className="text-right px-3 py-3" title="Qty Ã— M/pc">Total m</th>
              <th className="text-right px-3 py-3" title="Empty bobbin pcs returned to supplier">Returned</th>
              <th className="text-right px-3 py-3" title="Qty issued - returned">Balance</th>
              <th className="text-right px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={11} className="px-3 py-8 text-center text-ink-soft">No jobwork bobbin entries yet.</td></tr>
            ) : rows.map((r) => {
              const isEditing = editingId === r.id;
              const ef = isEditing && editForm ? editForm : r;
              const partyOptions = Array.from(partyById.values());
              const qtyForRow = Number((r.original_quantity ?? r.quantity) ?? 0);
              const perPcForRow = Number(r.bobbin_metre ?? 0);
              const totalMRow = perPcForRow > 0 ? qtyForRow * perPcForRow : 0;
              const returnedRow = returnedByBobbinId.get(r.id) ?? 0;
              const balanceRow = qtyForRow - returnedRow;
              return (
                <React.Fragment key={r.id}>
                  <tr className="border-t border-line/40">
                    {isEditing ? (
                      <>
                        <td className="px-2 py-2">
                          <input
                            type="date"
                            className="input h-8 text-xs"
                            value={ef.purchase_date ?? ''}
                            onChange={(e) => setEditForm({ ...ef, purchase_date: e.target.value || null })}
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-ink-mute">{r.code}</td>
                        <td className="px-2 py-2">
                          <select
                            className="input h-8 text-xs"
                            value={ef.jobwork_party_id ?? ''}
                            onChange={(e) => setEditForm({ ...ef, jobwork_party_id: e.target.value === '' ? null : Number(e.target.value) })}
                          >
                            <option value="">---</option>
                            {partyOptions.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            className="input h-8 text-xs"
                            value={ef.description ?? ''}
                            onChange={(e) => setEditForm({ ...ef, description: e.target.value })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            className="input num h-8 text-xs w-16"
                            value={ef.ends_per_bobbin ?? ''}
                            onChange={(e) => setEditForm({ ...ef, ends_per_bobbin: e.target.value === '' ? 0 : Number(e.target.value) })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            step={0.01}
                            className="input num h-8 text-xs w-20"
                            value={ef.bobbin_metre ?? ''}
                            onChange={(e) => setEditForm({ ...ef, bobbin_metre: e.target.value === '' ? 0 : Number(e.target.value) })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="number"
                            className="input num h-8 text-xs w-20"
                            value={ef.original_quantity ?? ef.quantity ?? ''}
                            onChange={(e) => setEditForm({ ...ef, original_quantity: e.target.value === '' ? 0 : Number(e.target.value) })}
                          />
                        </td>
                        <td className="px-3 py-2 text-right num text-xs text-ink-mute">
                          {/* Total m is derived; not editable. Shows the
                              live computed value as the operator edits. */}
                          {(() => {
                            const q = Number(ef.original_quantity ?? ef.quantity ?? 0);
                            const p = Number(ef.bobbin_metre ?? 0);
                            const t = p > 0 ? q * p : 0;
                            return t > 0 ? t.toLocaleString('en-IN', { maximumFractionDigits: 0 }) + ' m' : '-';
                          })()}
                        </td>
                        {/* Returned + Balance are derived from
                            bobbin_return entries and aren't editable. */}
                        <td className="px-3 py-2 text-right num text-xs text-ink-mute">{returnedRow > 0 ? returnedRow : '-'}</td>
                        <td className="px-3 py-2 text-right num text-xs text-ink-mute">{balanceRow}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button onClick={saveEdit} className="text-emerald-700 mr-2" title="Save"><Check className="w-4 h-4 inline" /></button>
                          <button onClick={() => { setEditingId(null); setEditForm(null); }} className="text-ink-mute" title="Cancel"><X className="w-4 h-4 inline" /></button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-ink-soft whitespace-nowrap">{fmtDate(r.purchase_date)}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                        <td className="px-3 py-2">{r.jobwork_party_id ? (partyById.get(r.jobwork_party_id)?.name ?? '-') : '-'}</td>
                        <td className="px-3 py-2 text-ink-soft">{r.description}</td>
                        <td className="px-3 py-2 text-right num">{r.ends_per_bobbin}</td>
                        <td className="px-3 py-2 text-right num">{r.bobbin_metre}</td>
                        <td className="px-3 py-2 text-right num font-semibold">{qtyForRow}</td>
                        <td className="px-3 py-2 text-right num text-indigo-700 font-semibold">
                          {totalMRow > 0
                            ? totalMRow.toLocaleString('en-IN', { maximumFractionDigits: 0 }) + ' m'
                            : <span className="text-ink-mute">-</span>}
                        </td>
                        <td className="px-3 py-2 text-right num text-amber-700">{returnedRow > 0 ? returnedRow : '-'}</td>
                        <td className={`px-3 py-2 text-right num font-semibold ${balanceRow > 0 ? 'text-ink' : 'text-emerald-700'}`}>{balanceRow}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button onClick={() => { setEditingId(r.id); setEditForm(r); }} className="text-indigo-700 hover:text-indigo-900 mr-2" title="Edit"><Pencil className="w-4 h-4 inline" /></button>
                          <button onClick={() => setRestockId(restockId === r.id ? null : r.id)} className="text-indigo-700 hover:text-indigo-900 mr-2" title="Restock"><RefreshCw className="w-4 h-4 inline" /></button>
                          <button onClick={() => setReturnId(returnId === r.id ? null : r.id)} className="text-amber-700 hover:text-amber-900 mr-2" title="Return to supplier"><ArrowLeft className="w-4 h-4 inline" /></button>
                          <button onClick={() => del(r.id)} className="text-rose-700 hover:text-rose-900" title="Delete"><Trash2 className="w-4 h-4 inline" /></button>
                        </td>
                      </>
                    )}
                  </tr>
                  {restockId === r.id && !isEditing && (
                    <tr><td colSpan={11} className="p-0">
                      <RestockForm parties={bobbinSuppliers}
                        qtyFields={[{ key: 'qty', label: 'Qty', step: 1 }]}
                        onCancel={() => setRestockId(null)}
                        onSave={(data) => restock(r, data)} />
                    </td></tr>
                  )}
                  {returnId === r.id && !isEditing && (
                    <tr><td colSpan={11} className="p-0">
                      <RestockForm parties={bobbinSuppliers}
                        qtyFields={[{ key: 'qty', label: 'Returned pcs', step: 1 }]}
                        onCancel={() => setReturnId(null)}
                        onSave={(data) => logReturn(r, data)} />
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-cloud/40 font-semibold border-t-2 border-line">
              <tr>
                <td colSpan={5} className="px-3 py-3 text-right text-ink-soft uppercase text-[11px] tracking-wide">Total</td>
                <td className="px-3 py-3 text-right num font-bold">
                  {rows.reduce((s, r) => s + Number((r.original_quantity ?? r.quantity) ?? 0), 0).toLocaleString('en-IN')} pcs
                </td>
                <td className="px-3 py-3 text-right num font-bold text-indigo-700">
                  {rows.reduce((s, r) => s + Number((r.original_quantity ?? r.quantity) ?? 0) * Number(r.bobbin_metre ?? 0), 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} m
                </td>
                <td className="px-3 py-3 text-right num font-bold text-amber-700">
                  {rows.reduce((s, r) => s + (returnedByBobbinId.get(r.id) ?? 0), 0).toLocaleString('en-IN')}
                </td>
                <td className="px-3 py-3 text-right num font-bold">
                  {rows.reduce((s, r) => s + (Number((r.original_quantity ?? r.quantity) ?? 0) - (returnedByBobbinId.get(r.id) ?? 0)), 0).toLocaleString('en-IN')}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/* ===== Warp Beam tab ===== */
function WarpBeamTab({ rows, parties, qualities, counts, sizingParties, fabricDefaults, partyById, qualityById, countById, partyLabel, kind, onChanged }: {
  rows: WarpBeamRow[]; parties: PartyOpt[]; qualities: QualityOpt[]; counts: CountOpt[];
  sizingParties: PartyOpt[]; fabricDefaults: Map<number, FabricDefaults>;
  partyById: Map<number, PartyOpt>; qualityById: Map<number, QualityOpt>; countById: Map<number, CountOpt>;
  /** "Jobwork Party" or "Outsourcing party" depending on the route. */
  partyLabel: string;
  /** Tab is rendered inside /app/jobwork or /app/outsource. The
   *  outsource variant pulls in pavu rows assigned to outsource via
   *  Pavu Master and shows them as a read-only section above the
   *  jobwork_warp_beam entries. */
  kind: 'jobwork' | 'outsource';
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [form, setForm] = useState({
    given_date: todayISO(), jobwork_party_id: '', fabric_quality_id: '', warp_count_id: '',
    total_ends: '', beam_count: '1', total_metres: '', reference_no: '', notes: '', supplier_party_id: '',
    // New (outsource flow): the sizing job the operator is sourcing
    // beams from. When set we list its pavu rows below and the
    // operator ticks the ones to include.
    sizing_job_id: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<WarpBeamRow | null>(null);
  const [restockId, setRestockId] = useState<number | null>(null);
  // Toggle for the inline add form. Mirrors the BobbinTab pattern so
  // the page loads with the form hidden and the table front-and-centre.
  const [showAdd, setShowAdd] = useState<boolean>(false);
  // Table filters (empty string = "All ...").
  const [filterQualityId, setFilterQualityId] = useState<string>('');
  const [filterPartyId, setFilterPartyId] = useState<string>('');

  // Pavu-driven Add form state. Sizing jobs are loaded once when the
  // Add form opens; the selected job's pavu rows are loaded
  // independently so the checkbox list narrows the moment the
  // operator picks a job.
  interface SizingJobOpt {
    id: number;
    job_code: string;
    set_no: string | null;
    warp_count_id: number | null;
    sizing_ledger_id: number | null;
  }
  interface PavuOpt {
    id: number;
    pavu_code: string;
    beam_no: string;
    ends: number;
    meters: number;
    production_mode: 'in_house' | 'outsource' | null;
    outsource_ledger_id: number | null;
  }
  interface OutsourceRouting {
    outsource_ledger_id: number | null;
    sizing_job_id: number | null;
  }
  const [sizingJobs,       setSizingJobs]       = useState<SizingJobOpt[]>([]);
  // Jobwork-variant only: an unfiltered list of every active sizing
  // job for the manual sizing-job dropdown. Kept separate from
  // `sizingJobs` (which is narrowed to outsource-routed pavus only).
  const [allSizingJobs,    setAllSizingJobs]    = useState<SizingJobOpt[]>([]);
  const [pavusForJob,      setPavusForJob]      = useState<PavuOpt[]>([]);
  const [selectedPavuIds,  setSelectedPavuIds]  = useState<Set<number>>(new Set());
  // Routing relationships between outsource parties and sizing
  // parties / jobs. Loaded once when the form opens; the cascading
  // dropdowns (party â†’ sizing party â†’ sizing job) read from this.
  const [outsourceRoutings,    setOutsourceRoutings]    = useState<OutsourceRouting[]>([]);
  const [outsourcePartyLedger, setOutsourcePartyLedger] = useState<Map<number, number>>(new Map());
  // Sizing vendor ledger directory â€” keyed by ledger_id. We source
  // the sizing-party dropdown from this instead of the sizingParties
  // prop because sizing_job.sizing_ledger_id is a ledger id, not a
  // party id, and there's no reliable bridge to "Sizing Party" type
  // parties.
  const [sizingVendorLedgerName, setSizingVendorLedgerName] = useState<Map<number, string>>(new Map());
  // Reverse lookup ledger_id â†’ party_id so we can still populate the
  // supplier_party_id FK on save when a Sizing Party party exists
  // for the selected ledger.
  const [sizingPartyByLedger,    setSizingPartyByLedger]    = useState<Map<number, number>>(new Map());

  // Load every piece of routing context the cascading dropdowns
  // need: outsource-routed pavu rows (with their outsource_ledger_id
  // and sizing_job_id), the sizing jobs they belong to (with each
  // job's sizing_ledger_id), and the ledger_id of every outsource
  // party and sizing party in the dropdown lists. Cascading filter:
  //   1. Pick Outsourcing party â†’ narrows Sizing party dropdown to
  //      those whose ledger matches a sizing_job that has pavus
  //      routed to this outsource party.
  //   2. Pick Sizing party â†’ narrows Sizing job dropdown to jobs
  //      from that sizing party + going to this outsource party.
  useEffect(() => {
    if (!showAdd || kind !== 'outsource') return;
    let cancelled = false;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const [pavuRes, outsourcePartyLedgerRes] = await Promise.all([
        sb.from('pavu')
          .select('outsource_ledger_id, sizing_job_id')
          .eq('production_mode', 'outsource')
          .not('sizing_job_id', 'is', null),
        // `parties` is sourced from `jobwork_party` (kind='outsource')
        // by the parent â€” not the `party` master â€” so we resolve the
        // ledger map from the same table. Querying `party` with these
        // ids returns nothing (different id namespaces) and the
        // strict cascade collapses to an empty sizing-vendor list.
        parties.length > 0
          ? sb.from('jobwork_party').select('id, ledger_id').in('id', parties.map((p) => p.id))
          : Promise.resolve({ data: [] }),
      ]);
      if (cancelled) return;
      const routings = ((pavuRes.data ?? []) as OutsourceRouting[]);
      setOutsourceRoutings(routings);

      // Sizing job lookup â€” only the jobs referenced by an outsource
      // routing, with their sizing_ledger_id so the cascade can
      // group by sizing vendor.
      const jobIds = Array.from(new Set(routings.map((r) => r.sizing_job_id).filter((x): x is number => x != null)));
      let loadedJobs: SizingJobOpt[] = [];
      if (jobIds.length > 0) {
        const { data: jobs } = await sb
          .from('sizing_job')
          .select('id, job_code, set_no, warp_count_id, sizing_ledger_id')
          .in('id', jobIds)
          .order('created_at', { ascending: false })
          .limit(200);
        loadedJobs = ((jobs ?? []) as SizingJobOpt[]);
      }
      if (!cancelled) setSizingJobs(loadedJobs);

      // Resolve sizing vendor ledger names for the dropdown plus a
      // reverse map back to "Sizing Party" type parties (so we can
      // still write supplier_party_id when the operator has one
      // configured for that ledger).
      const sizingLedgerIds = Array.from(new Set(
        loadedJobs.map((j) => j.sizing_ledger_id).filter((x): x is number => x != null),
      ));
      const vendorMap     = new Map<number, string>();
      const partyByLedger = new Map<number, number>();
      if (sizingLedgerIds.length > 0) {
        const [ledgerRes, partyRes] = await Promise.all([
          sb.from('ledger').select('id, name').in('id', sizingLedgerIds),
          sb.from('party').select('id, name, ledger_id').in('ledger_id', sizingLedgerIds),
        ]);
        for (const l of (ledgerRes.data ?? []) as Array<{ id: number; name: string }>) {
          vendorMap.set(l.id, l.name);
        }
        for (const p of (partyRes.data ?? []) as Array<{ id: number; ledger_id: number | null }>) {
          if (p.ledger_id != null) partyByLedger.set(p.ledger_id, p.id);
        }
      }
      if (!cancelled) {
        setSizingVendorLedgerName(vendorMap);
        setSizingPartyByLedger(partyByLedger);
      }

      const outsourceMap = new Map<number, number>();
      for (const p of (outsourcePartyLedgerRes.data ?? []) as Array<{ id: number; ledger_id: number | null }>) {
        if (p.ledger_id != null) outsourceMap.set(p.id, p.ledger_id);
      }
      if (!cancelled) setOutsourcePartyLedger(outsourceMap);
    })();
    return () => { cancelled = true; };
  }, [showAdd, kind, supabase, parties]);

  // Jobwork variant: load every active sizing job for the manual
  // dropdown. No cascade â€” the operator picks freely, then types in
  // the totals (or auto-fills from a fabric quality).
  useEffect(() => {
    if (!showAdd || kind !== 'jobwork') return;
    let cancelled = false;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data } = await sb
        .from('sizing_job')
        .select('id, job_code, set_no, warp_count_id, sizing_ledger_id')
        .not('status', 'in', '(draft,cancelled)')
        .order('created_at', { ascending: false })
        .limit(500);
      if (cancelled) return;
      setAllSizingJobs((data ?? []) as SizingJobOpt[]);
    })();
    return () => { cancelled = true; };
  }, [showAdd, kind, supabase]);

  // â”€â”€ Cascade memos â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const selectedOutsourceLedgerId = form.jobwork_party_id === ''
    ? null
    : outsourcePartyLedger.get(Number(form.jobwork_party_id)) ?? null;

  // Sizing jobs that have a pavu routed to the selected outsource
  // party. Drives both the Sizing-party narrowing and the eventual
  // Sizing-job dropdown.
  const sizingJobIdsForOutsource = useMemo(() => {
    const out = new Set<number>();
    if (selectedOutsourceLedgerId == null) return out;
    for (const r of outsourceRoutings) {
      if (r.outsource_ledger_id === selectedOutsourceLedgerId && r.sizing_job_id != null) {
        out.add(r.sizing_job_id);
      }
    }
    return out;
  }, [outsourceRoutings, selectedOutsourceLedgerId]);

  // Sizing vendors eligible for the dropdown â€” strict cascade.
  //
  // With Pavu Master now sourcing outsource parties from
  // `jobwork_party` (kind='outsource') and migration 121 having
  // linked every jobwork_party row to a ledger, pavu.outsource_ledger_id
  // always equals jobwork_party.ledger_id for newly-routed pavus, so
  // the strict cascade can run without a fallback.
  const eligibleSizingVendors = useMemo<Array<{ ledger_id: number; name: string }>>(() => {
    if (form.jobwork_party_id === '' || selectedOutsourceLedgerId == null) return [];
    const seen = new Set<number>();
    const out: Array<{ ledger_id: number; name: string }> = [];
    for (const j of sizingJobs) {
      if (!sizingJobIdsForOutsource.has(j.id)) continue;
      const lid = j.sizing_ledger_id;
      if (lid == null || seen.has(lid)) continue;
      seen.add(lid);
      out.push({ ledger_id: lid, name: sizingVendorLedgerName.get(lid) ?? `Ledger #${lid}` });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [form.jobwork_party_id, sizingJobs, sizingJobIdsForOutsource, sizingVendorLedgerName, selectedOutsourceLedgerId]);

  // Sizing jobs eligible for the dropdown â€” strict cascade
  // by outsource party AND (when set) sizing vendor.
  const eligibleSizingJobs = useMemo(() => {
    if (form.jobwork_party_id === '' || selectedOutsourceLedgerId == null) return [];
    const supplierLedgerId = form.supplier_party_id === '' ? null : Number(form.supplier_party_id);
    return sizingJobs.filter((j) => {
      if (!sizingJobIdsForOutsource.has(j.id)) return false;
      if (supplierLedgerId !== null && j.sizing_ledger_id !== supplierLedgerId) return false;
      return true;
    });
  }, [form.jobwork_party_id, sizingJobs, sizingJobIdsForOutsource, form.supplier_party_id, selectedOutsourceLedgerId]);

  // When the outsource party changes, clear stale sizing-party and
  // sizing-job selections so the cascade doesn't get confused. Only
  // applies to the outsource variant â€” the jobwork variant uses
  // independent manual dropdowns.
  useEffect(() => {
    if (kind !== 'outsource') return;
    setForm((f) => ({ ...f, supplier_party_id: '', sizing_job_id: '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.jobwork_party_id, kind]);

  // When the sizing party changes, clear the sizing-job selection
  // (outsource cascade only).
  useEffect(() => {
    if (kind !== 'outsource') return;
    setForm((f) => ({ ...f, sizing_job_id: '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.supplier_party_id, kind]);

  // Load pavu rows when the sizing job picker changes. Outsource
  // warp-given is, by definition, only about outsource-routed beams,
  // so the checklist is filtered to production_mode='outsource' â€”
  // in-house beams of the same sizing set don't belong in this form.
  useEffect(() => {
    if (form.sizing_job_id === '') { setPavusForJob([]); setSelectedPavuIds(new Set()); return; }
    let cancelled = false;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data } = await sb
        .from('pavu')
        .select('id, pavu_code, beam_no, ends, meters, production_mode, outsource_ledger_id')
        .eq('sizing_job_id', Number(form.sizing_job_id))
        .eq('production_mode', 'outsource')
        .order('beam_no');
      if (cancelled) return;
      setPavusForJob((data ?? []) as PavuOpt[]);
      setSelectedPavuIds(new Set());
    })();
    return () => { cancelled = true; };
  }, [form.sizing_job_id, supabase]);

  function toggleSelectedPavu(id: number) {
    setSelectedPavuIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Auto-totals derived from the selected pavu rows. These drive the
  // read-only "auto" fields on the form; the operator can't override
  // them â€” to change the figure they pick / unpick a beam.
  const selectedPavus = pavusForJob.filter((p) => selectedPavuIds.has(p.id));
  const autoBeamCount = selectedPavus.length;
  const autoTotalMetres = selectedPavus.reduce((s, p) => s + Number(p.meters ?? 0), 0);
  // Total ends = the ends value of the selected beams. We show the
  // distinct values when the selection spans multiple ends specs.
  const autoEndsValues = Array.from(new Set(selectedPavus.map((p) => Number(p.ends ?? 0))));
  const autoEndsDisplay = autoEndsValues.length === 1 ? String(autoEndsValues[0]) : autoEndsValues.join(', ');
  const autoWarpCountId = (() => {
    const job = sizingJobs.find((j) => j.id === Number(form.sizing_job_id));
    return job?.warp_count_id ?? null;
  })();
  const autoWarpCountLabel = autoWarpCountId != null ? countById.get(autoWarpCountId)?.display_name ?? `#${autoWarpCountId}` : 'â€”';

  // Fabric quality dropdown is narrowed to qualities whose master ends
  // value matches the selected pavus' ends. When the operator ticks
  // beams that all share one ends spec we drop straight to the
  // matching qualities; mixed selections fall back to the full list
  // (the operator has to pick something compatible manually).
  const fabricQualitiesForEnds = useMemo(() => {
    if (autoEndsValues.length !== 1) return qualities;
    const wantedEnds = autoEndsValues[0];
    const matching = qualities.filter((q) => {
      const d = fabricDefaults.get(q.id);
      return d?.total_ends != null && Number(d.total_ends) === wantedEnds;
    });
    return matching.length > 0 ? matching : qualities;
  }, [qualities, fabricDefaults, autoEndsValues]);

  // Auto-pick the fabric quality when exactly one matches the selected
  // ends. Saves the operator a click on the common 1-quality case.
  useEffect(() => {
    if (fabricQualitiesForEnds.length === 1 && form.fabric_quality_id === '') {
      const id = String(fabricQualitiesForEnds[0]!.id);
      setForm((f) => ({ ...f, fabric_quality_id: id }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fabricQualitiesForEnds]);

  // Rows after applying the on-screen filters. We keep `rows` (the full
  // list) for the table body filter check and the footer's totals so the
  // totals always reflect what's currently visible.
  const filteredRows = rows.filter((r) => {
    if (filterQualityId !== '' && String(r.fabric_quality_id ?? '') !== filterQualityId) return false;
    if (filterPartyId   !== '' && String(r.jobwork_party_id)         !== filterPartyId)   return false;
    return true;
  });

  // When the user picks a Fabric Quality, auto-fill warp count + total ends
  // from the fabric_quality_warp_count / fabric_quality_ends child tables
  // (we keep only the primary sno=1 entry per fabric in fabricDefaults).
  // The operator can still override either value before saving.
  function onFabricChange(idStr: string): void {
    if (idStr === '') {
      setForm((f) => ({ ...f, fabric_quality_id: '' }));
      return;
    }
    const fid = Number(idStr);
    const defaults = fabricDefaults.get(fid);
    setForm((f) => ({
      ...f,
      fabric_quality_id: idStr,
      warp_count_id: defaults && defaults.warp_count_id !== null
        ? String(defaults.warp_count_id)
        : f.warp_count_id,
      total_ends: defaults && defaults.total_ends !== null
        ? String(defaults.total_ends)
        : f.total_ends,
    }));
  }

  async function add() {
    setErr(null);
    if (form.jobwork_party_id === '') { setErr(`Pick a ${partyLabel.toLowerCase()}.`); return; }
    if (kind === 'outsource') {
      // Pavu-driven flow on the outsource page. Cascading dropdowns
      // and the pavu checklist are all required; the totals are
      // auto-derived from the picked beams, never typed.
      if (form.supplier_party_id === '') { setErr('Pick a sizing party.'); return; }
      if (form.sizing_job_id === '')     { setErr('Pick a sizing job.'); return; }
      if (form.fabric_quality_id === '') { setErr('Pick a fabric quality to assign the metres to.'); return; }
      if (selectedPavuIds.size === 0)    { setErr('Select at least one pavu beam.'); return; }
    }
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    if (kind === 'outsource') {
      // Resolve the selected outsource party's ledger_id so we can
      // update the pavu rows with the correct foreign key. The party
      // dropdown is sourced from `jobwork_party` (kind='outsource'),
      // NOT the `party` master â€” querying `party` with this id was
      // the source of the "Selected party has no linked ledger" error
      // even after migration 121 had linked the jobwork_party row.
      const { data: party } = await sb
        .from('jobwork_party')
        .select('ledger_id')
        .eq('id', Number(form.jobwork_party_id))
        .maybeSingle();
      if (!party?.ledger_id) {
        setBusy(false);
        setErr('Selected party has no linked ledger. Set it up on the party form first.');
        return;
      }
      const newLedgerId = Number(party.ledger_id);

      // Auto totals are derived from the picked beams. We send the
      // numeric values into the table â€” the operator never touches
      // these fields, so there's no validation to do beyond > 0.
      const beamIds = Array.from(selectedPavuIds);
      // form.supplier_party_id now stores the picked sizing-vendor
      // ledger_id (the dropdown is ledger-backed). Translate back to
      // a party_id when a matching "Sizing Party" party exists for
      // that ledger; otherwise leave the FK null. The warp-given row
      // still records the sizing vendor through its linked sizing
      // job, so no info is lost on the receipt side.
      const supplierLedgerId = form.supplier_party_id === '' ? null : Number(form.supplier_party_id);
      const supplierPartyId  = supplierLedgerId != null
        ? sizingPartyByLedger.get(supplierLedgerId) ?? null
        : null;
      const payload = {
        jobwork_party_id:  Number(form.jobwork_party_id),
        fabric_quality_id: form.fabric_quality_id === '' ? null : Number(form.fabric_quality_id),
        warp_count_id:     autoWarpCountId,
        given_date:        form.given_date,
        total_ends:        autoEndsValues.length === 1 ? autoEndsValues[0] : null,
        beam_count:        autoBeamCount,
        total_metres:      autoTotalMetres > 0 ? autoTotalMetres : null,
        original_metres:   autoTotalMetres > 0 ? autoTotalMetres : null,
        reference_no:      form.reference_no.trim() || null,
        notes:             form.notes.trim() || null,
        supplier_party_id: supplierPartyId,
        // Aggregate row â€” no single pavu link. pavu_ids records the
        // exact set of pavus this row represents so the Release
        // action can revert just those beams.
        pavu_id:           null,
        pavu_ids:          beamIds,
      };
      const { error: insErr } = await sb.from('jobwork_warp_beam').insert(payload);
      if (insErr) { setBusy(false); setErr(insErr.message); return; }

      // Update each selected pavu â€” flip routing AND mark assigned
      // so the Pavu Master editor locks them out.
      const { error: pavuErr } = await sb
        .from('pavu')
        .update({ production_mode: 'outsource', outsource_ledger_id: newLedgerId, status: 'assigned' })
        .in('id', beamIds);
      if (pavuErr) { setBusy(false); setErr(`Warp-given saved but pavu update failed: ${pavuErr.message}`); return; }

      // Drop any 1-to-1 mirror rows for the selected pavus â€” they're
      // represented by the aggregate row now.
      await sb.from('jobwork_warp_beam').delete().in('pavu_id', beamIds);

      setBusy(false);
      setForm({
        given_date: todayISO(), jobwork_party_id: '', fabric_quality_id: '', warp_count_id: '',
        total_ends: '', beam_count: '1', total_metres: '', reference_no: '', notes: '', supplier_party_id: '',
        sizing_job_id: '',
      });
      setSelectedPavuIds(new Set());
      setPavusForJob([]);
      setShowAdd(false);
      onChanged();
      return;
    }

    // Legacy flat-form path (jobwork variant â€” simpler manual form
    // re-introduced on /app/jobwork). Sizing party + sizing job are
    // both optional FK references that just tag the warp-given row.
    const payload = {
      jobwork_party_id: Number(form.jobwork_party_id),
      fabric_quality_id: form.fabric_quality_id === '' ? null : Number(form.fabric_quality_id),
      warp_count_id: form.warp_count_id === '' ? null : Number(form.warp_count_id),
      given_date: form.given_date,
      total_ends: form.total_ends === '' ? null : Number(form.total_ends),
      beam_count: form.beam_count === '' ? 1 : Number(form.beam_count),
      total_metres: form.total_metres === '' ? null : Number(form.total_metres),
      reference_no: form.reference_no.trim() || null,
      notes: form.notes.trim() || null,
      supplier_party_id: form.supplier_party_id === '' ? null : Number(form.supplier_party_id),
      sizing_job_id: form.sizing_job_id === '' ? null : Number(form.sizing_job_id),
    };
    const { error } = await sb.from('jobwork_warp_beam').insert(payload);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setForm({
      given_date: todayISO(), jobwork_party_id: '', fabric_quality_id: '', warp_count_id: '',
      total_ends: '', beam_count: '1', total_metres: '', reference_no: '', notes: '', supplier_party_id: '',
      sizing_job_id: '',
    });
    setShowAdd(false);
    onChanged();
  }

  async function del(id: number) {
    if (!window.confirm('Delete this warp beam entry?')) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error } = await sb.from('jobwork_warp_beam').delete().eq('id', id);
    if (error) { setErr(error.message); return; }
    onChanged();
  }

  // Release reverts every pavu represented by this warp-given row so
  // Pavu Master can edit them again. Works for both aggregate rows
  // (pavu_ids array) and 1-to-1 mirror rows (pavu_id singular).
  // Aggregate rows store pavu_ids as a JSONB array (migration 120).
  //
  // Behaviour: we only flip status back to 'in_stock'. The pavu's
  // production_mode and outsource_ledger_id are preserved so the beam
  // stays on the same outsource weaver's side of Pavu Master â€” the
  // user is undoing the DC, not the routing decision. To fully unroute
  // (back to in-house stock), edit the pavu in Pavu Master afterwards.
  async function release(r: WarpBeamRow) {
    const ids: number[] = Array.isArray(r.pavu_ids) && r.pavu_ids.length > 0
      ? r.pavu_ids.map((x) => Number(x)).filter((n) => Number.isFinite(n))
      : (r.pavu_id != null ? [r.pavu_id] : []);
    if (ids.length === 0) {
      window.alert('No pavu link on this warp beam entry to release.');
      return;
    }
    if (!window.confirm(`Release ${ids.length} pavu beam${ids.length === 1 ? '' : 's'} back to in-stock? They stay on the same outsource weaver and become editable again in Pavu Master.`)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    // Revert the pavu rows â€” only the status flips. The
    // production_mode + outsource_ledger_id stay so the beam remains
    // on the same outsource weaver in Pavu Master.
    const { error: pavuErr } = await sb
      .from('pavu')
      .update({ status: 'in_stock' })
      .in('id', ids);
    if (pavuErr) { setErr(`Release failed: ${pavuErr.message}`); return; }
    // Drop the warp-given row itself.
    const { error: delErr } = await sb.from('jobwork_warp_beam').delete().eq('id', r.id);
    if (delErr) { setErr(`Pavu released but row delete failed: ${delErr.message}`); return; }
    onChanged();
  }

  async function saveEdit() {
    if (!editForm) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    // Sync original_metres = total_metres so the history display (which
    // reads original_metres ?? total_metres) reflects the edit. Without
    // this the user types a new value but the row keeps showing the
    // old original until they re-load.
    const editedMetres = editForm.total_metres;
    const { error } = await sb.from('jobwork_warp_beam').update({
      jobwork_party_id: editForm.jobwork_party_id,
      fabric_quality_id: editForm.fabric_quality_id,
      warp_count_id: editForm.warp_count_id,
      given_date: editForm.given_date,
      total_ends: editForm.total_ends,
      beam_count: editForm.beam_count,
      total_metres: editedMetres,
      original_metres: editedMetres,
      reference_no: editForm.reference_no,
      notes: editForm.notes,
      supplier_party_id: editForm.supplier_party_id,
    }).eq('id', editForm.id);
    if (error) { setErr(error.message); return; }
    setEditingId(null); setEditForm(null);
    onChanged();
  }

  async function restock(parent: WarpBeamRow, data: { given_date: string; supplier_party_id: string; qty: Record<string, string> }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const payload = {
      jobwork_party_id: parent.jobwork_party_id,
      fabric_quality_id: parent.fabric_quality_id,
      warp_count_id: parent.warp_count_id,
      given_date: data.given_date,
      total_ends: parent.total_ends,
      beam_count: Number(data.qty.beam_count ?? parent.beam_count) || 1,
      total_metres: data.qty.total_metres === '' ? null : Number(data.qty.total_metres),
      reference_no: `RESTOCK-${parent.id}`,
      notes: null,
      supplier_party_id: data.supplier_party_id === '' ? null : Number(data.supplier_party_id),
    };
    const { error } = await sb.from('jobwork_warp_beam').insert(payload);
    if (error) { window.alert('Restock failed: ' + error.message); return; }
    setRestockId(null);
    onChanged();
  }

  // Blurb adapts to the variant â€” the jobwork form is a simple
  // manual entry, the outsource form runs through the pavu cascade.
  const tabBlurb = kind === 'jobwork'
    ? 'Warp beams sent to jobwork parties. Pick sizing party + sizing job, then assign the metres to a fabric quality.'
    : 'Warp beams sent to outsource weavers. Add captures each issue; the table reflects only what\u2019s been logged here.';

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-ink-mute">{tabBlurb}</p>
        <button type="button" onClick={() => setShowAdd((v) => !v)} className="btn-primary">
          {showAdd ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showAdd ? 'Cancel' : 'Add warp beam given'}
        </button>
      </div>

{/* The "From Pavu Master" preview block was removed â€” the operator
          asked for the warp-given table to reflect only what's been
          logged via the Add warp beam given form. Pavu Master's
          routing assignments live on the pavu rows themselves and
          surface in the Pavu list, not here. */}

      {showAdd && (
      <div className="card p-4 mb-4 space-y-4">
        <h3 className="font-display font-bold text-sm">Add warp beam given</h3>

        {kind === 'jobwork' ? (
        <>
          {/* Step 1 â€” Date, Jobwork Party, Sizing party. All manual;
              no cascade. Sizing job removed per operator request â€”
              jobwork warp beams are tracked at the party level only. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div><label className="label text-xs">ID</label>
              <div className="input bg-cloud/40 text-ink-mute select-none">Auto (WBG-NNNN)</div>
            </div>
            <div><label className="label text-xs">Date *</label>
              <input type="date" className="input" value={form.given_date}
                onChange={(e) => setForm({ ...form, given_date: e.target.value })} />
            </div>
            <div><label className="label text-xs">{partyLabel} *</label>
              <select className="input" value={form.jobwork_party_id}
                onChange={(e) => setForm({ ...form, jobwork_party_id: e.target.value })}>
                <option value="">--- pick ---</option>
                {parties.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
              </select>
            </div>
            <div><label className="label text-xs">Sizing party</label>
              <select className="input" value={form.supplier_party_id}
                onChange={(e) => setForm({ ...form, supplier_party_id: e.target.value })}>
                <option value="">--- pick ---</option>
                {sizingParties.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-2 gap-3">
            <div><label className="label text-xs">Fabric quality *</label>
              <select className="input" value={form.fabric_quality_id}
                onChange={(e) => onFabricChange(e.target.value)}>
                <option value="">--- pick ---</option>
                {/* Job Work variant: show ONLY qualities tagged
                    production_mode='job_work' on the fabric_quality
                    master. The other modes (inhouse / outsourcing) are
                    reserved for the parent flow and shouldn't appear
                    here. */}
                {qualities.filter((q) => q.production_mode === 'job_work')
                  .map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
              </select>
              <p className="text-[10px] text-ink-mute mt-0.5">Picking a quality fills warp count + total ends; you can still edit them. List filtered to Job Work qualities only.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div><label className="label text-xs">Warp count</label>
              <select className="input" value={form.warp_count_id}
                onChange={(e) => setForm({ ...form, warp_count_id: e.target.value })}>
                <option value="">---</option>
                {counts.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.display_name}</option>)}
              </select>
            </div>
            <div><label className="label text-xs">Total ends</label>
              <input type="number" className="input num" value={form.total_ends}
                onChange={(e) => setForm({ ...form, total_ends: e.target.value })} />
            </div>
            <div><label className="label text-xs">No. of beams</label>
              <input type="number" className="input num" value={form.beam_count}
                onChange={(e) => setForm({ ...form, beam_count: e.target.value })} />
            </div>
            <div><label className="label text-xs">Total metres</label>
              <input type="number" step={0.01} className="input num" value={form.total_metres}
                onChange={(e) => setForm({ ...form, total_metres: e.target.value })} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><label className="label text-xs">Reference / DC no</label>
              <input className="input" value={form.reference_no}
                onChange={(e) => setForm({ ...form, reference_no: e.target.value })} />
            </div>
            <div><label className="label text-xs">Notes</label>
              <input className="input" value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>

          {err && <div className="text-sm text-err">{err}</div>}
          <div className="flex justify-end">
            <button type="button" onClick={add} disabled={busy} className="btn-primary">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add warp beam
            </button>
          </div>
        </>
        ) : (
        <>
        {/* Step 1 â€” pick date, party, sizing party, sizing job. The
            cascade is: Outsourcing party â†’ narrows Sizing party â†’
            narrows Sizing job â†’ drives the pavu list below. The
            totals downstream are auto-derived from whichever pavu
            beams the operator ticks. */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div><label className="label text-xs">ID</label>
            <div className="input bg-cloud/40 text-ink-mute select-none">Auto (WBG-NNNN)</div>
          </div>
          <div><label className="label text-xs">Date *</label>
            <input type="date" className="input" value={form.given_date} onChange={(e) => setForm({ ...form, given_date: e.target.value })} /></div>
          <div><label className="label text-xs">{partyLabel} *</label>
            <select className="input" value={form.jobwork_party_id} onChange={(e) => setForm({ ...form, jobwork_party_id: e.target.value })}>
              <option value="">--- pick ---</option>
              {parties.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
            </select></div>
          <div><label className="label text-xs">Sizing party *</label>
            <select
              className="input"
              value={form.supplier_party_id}
              onChange={(e) => setForm({ ...form, supplier_party_id: e.target.value })}
              disabled={form.jobwork_party_id === ''}
            >
              <option value="">
                {form.jobwork_party_id === ''
                  ? 'Pick outsource party firstâ€¦'
                  : eligibleSizingVendors.length === 0
                    ? 'No sizing vendors used for this party'
                    : '--- pick ---'}
              </option>
              {eligibleSizingVendors.map((v) => (
                <option key={v.ledger_id} value={v.ledger_id}>{v.name}</option>
              ))}
            </select></div>
          <div><label className="label text-xs">Sizing job *</label>
            <select
              className="input"
              value={form.sizing_job_id}
              onChange={(e) => setForm({ ...form, sizing_job_id: e.target.value })}
              disabled={form.jobwork_party_id === '' || form.supplier_party_id === ''}
            >
              <option value="">
                {form.jobwork_party_id === ''
                  ? 'Pick outsource party firstâ€¦'
                  : form.supplier_party_id === ''
                    ? 'Pick sizing party firstâ€¦'
                    : eligibleSizingJobs.length === 0
                      ? 'No sizing sets for this pair'
                      : '--- pick ---'}
              </option>
              {eligibleSizingJobs.map((j) => (
                <option key={j.id} value={j.id}>{j.job_code}{j.set_no ? ' Â· Set ' + j.set_no : ''}</option>
              ))}
            </select></div>
        </div>

        {/* Step 2 â€” pavu beam checklist. Visible once a sizing job is
            picked. Each row tells the operator the beam no, ends and
            metres so they can confirm before ticking; the per-beam
            current routing pill is shown on the right. */}
        {form.sizing_job_id !== '' && (
          <div className="rounded-lg border border-line/60 bg-cloud/30 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Pavu beams in this set
              </span>
              <div className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  className="text-indigo underline"
                  onClick={() => setSelectedPavuIds(new Set(pavusForJob.map((p) => p.id)))}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="text-ink-mute underline"
                  onClick={() => setSelectedPavuIds(new Set())}
                >
                  Clear
                </button>
              </div>
            </div>
            {pavusForJob.length === 0 ? (
              <div className="text-xs text-ink-mute py-2">No pavu beams in this sizing job.</div>
            ) : (
              <ul className="space-y-1">
                {pavusForJob.map((p) => {
                  const checked = selectedPavuIds.has(p.id);
                  const isOutsource = p.production_mode === 'outsource';
                  return (
                    <li key={p.id} className="flex items-center gap-3 text-xs">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelectedPavu(p.id)}
                        className="cursor-pointer"
                      />
                      <span className="font-mono w-24 inline-block">{p.pavu_code}</span>
                      <span className="font-mono w-16 inline-block">#{p.beam_no}</span>
                      <span className="text-ink-mute w-24 inline-block">{p.ends} ends</span>
                      <span className="text-ink-mute w-24 inline-block">{Number(p.meters).toFixed(0)} m</span>
                      <span className={
                        'ml-auto pill text-[10px] ' +
                        (isOutsource ? 'bg-amber-50 text-amber-700' : 'bg-indigo-50 text-indigo-700')
                      }>
                        {isOutsource ? 'Outsource' : 'In-house'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Step 3 â€” auto fields. Read-only; values change only when
            the operator picks / unpicks beams above. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><label className="label text-xs">Warp count <span className="text-ink-mute">(auto)</span></label>
            <div className="input bg-cloud/40 text-ink-mute select-none">{autoWarpCountLabel}</div>
          </div>
          <div><label className="label text-xs">No. of beams <span className="text-ink-mute">(auto)</span></label>
            <div className="input num bg-cloud/40 text-ink-mute select-none">{autoBeamCount}</div>
          </div>
          <div><label className="label text-xs">Total ends <span className="text-ink-mute">(auto)</span></label>
            <div className="input num bg-cloud/40 text-ink-mute select-none">{autoEndsDisplay || 'â€”'}</div>
          </div>
          <div><label className="label text-xs">Total metres <span className="text-ink-mute">(auto)</span></label>
            <div className="input num bg-cloud/40 text-ink-mute select-none">
              {autoTotalMetres > 0 ? autoTotalMetres.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : 'â€”'}
            </div>
          </div>
        </div>

        {/* Optional extras. Fabric quality replaces the old "Reference
            / DC no" field â€” the operator assigns the warp metres to a
            specific fabric quality, which is then stored on the
            warp-given row. */}
        <div className="grid grid-cols-2 md:grid-cols-2 gap-3">
          <div><label className="label text-xs">Fabric quality *</label>
            <select
              className="input"
              value={form.fabric_quality_id}
              onChange={(e) => setForm({ ...form, fabric_quality_id: e.target.value })}
            >
              <option value="">--- pick ---</option>
              {fabricQualitiesForEnds.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
            </select>
            <p className="text-[10px] text-ink-mute mt-0.5">
              {autoEndsValues.length === 1
                ? `Filtered to qualities with ${autoEndsValues[0]} ends.`
                : 'Assigns the selected warp metres to this quality.'}
            </p>
          </div>
          <div><label className="label text-xs">Notes</label>
            <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>

        {err && <div className="text-sm text-err">{err}</div>}
        <div className="flex justify-end">
          <button type="button" onClick={add} disabled={busy} className="btn-primary">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add warp beam
          </button>
        </div>
        </>
        )}
      </div>
      )}

      {/* Filter bar â€” narrows the table + footer totals down to a single
          fabric quality and / or jobwork party. Empty selection = All. */}
      <div className="card p-3 mb-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="label text-[10px]">Filter by quality</label>
          <select
            className="input h-9 w-56"
            value={filterQualityId}
            onChange={(e) => setFilterQualityId(e.target.value)}
          >
            <option value="">All qualities</option>
            {qualities.map((q) => (
              <option key={q.id} value={String(q.id)}>{q.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label text-[10px]">Filter by party</label>
          <select
            className="input h-9 w-56"
            value={filterPartyId}
            onChange={(e) => setFilterPartyId(e.target.value)}
          >
            <option value="">All parties</option>
            {parties.map((p) => (
              <option key={p.id} value={String(p.id)}>{p.code} - {p.name}</option>
            ))}
          </select>
        </div>
        {(filterQualityId !== '' || filterPartyId !== '') && (
          <button
            type="button"
            onClick={() => { setFilterQualityId(''); setFilterPartyId(''); }}
            className="text-xs text-ink-mute underline hover:text-ink h-9"
          >
            Clear filters
          </button>
        )}
        <div className="ml-auto text-xs text-ink-soft">
          Showing <span className="font-semibold text-ink">{filteredRows.length}</span> of {rows.length} rows
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left  px-3 py-3">ID</th>
              <th className="text-left  px-3 py-3">Date</th>
              <th className="text-left  px-3 py-3">Party</th>
              <th className="text-left  px-3 py-3">Quality</th>
              <th className="text-left  px-3 py-3">Warp count</th>
              <th className="text-right px-3 py-3">Ends</th>
              <th className="text-right px-3 py-3" title="Total number of beams issued">Beams</th>
              <th className="text-right px-3 py-3">Metres</th>
              <th className="text-left  px-3 py-3">Sizing party</th>
              <th className="text-right px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-ink-soft">
                {rows.length === 0 ? 'No warp beams issued yet.' : 'No warp beams match the current filters.'}
              </td></tr>
            ) : filteredRows.map((r) => {
              const isEditing = editingId === r.id;
              const ef = editForm ?? r;
              return (
                <React.Fragment key={r.id}>
                  <tr className="border-t border-line/40">
                    {isEditing ? (
                      <>
                        {/* ID â€” auto-issued, never editable. */}
                        <td className="px-3 py-2 font-mono text-xs text-ink-mute">{`WBG-${String(r.id).padStart(4, '0')}`}</td>
                        <td className="px-2 py-2"><input type="date" className="input h-8 text-xs" value={ef.given_date} onChange={(e) => setEditForm({ ...ef, given_date: e.target.value })} /></td>
                        <td className="px-2 py-2"><select className="input h-8 text-xs" value={ef.jobwork_party_id} onChange={(e) => setEditForm({ ...ef, jobwork_party_id: Number(e.target.value) })}>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td>
                        <td className="px-2 py-2"><select className="input h-8 text-xs" value={ef.fabric_quality_id ?? ''} onChange={(e) => setEditForm({ ...ef, fabric_quality_id: e.target.value === '' ? null : Number(e.target.value) })}><option value="">---</option>{qualities.filter((q) => kind !== 'jobwork' || q.production_mode === 'job_work').map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}</select></td>
                        {/* Auto-populated from fabric quality â€” read-only in edit. */}
                        <td className="px-3 py-2 text-ink-mute italic">{ef.warp_count_id ? countById.get(ef.warp_count_id)?.display_name ?? '-' : '-'}</td>
                        <td className="px-3 py-2 text-right num text-ink-mute italic">{ef.total_ends ?? '-'}</td>
                        <td className="px-2 py-2"><input type="number" min={1} className="input num h-8 text-xs w-16" value={ef.beam_count} onChange={(e) => setEditForm({ ...ef, beam_count: Number(e.target.value) })} /></td>
                        <td className="px-2 py-2"><input type="number" step={0.01} className="input num h-8 text-xs w-20" value={ef.total_metres ?? ''} onChange={(e) => setEditForm({ ...ef, total_metres: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                        <td className="px-2 py-2">
                          <select className="input h-8 text-xs" value={ef.supplier_party_id ?? ''} onChange={(e) => setEditForm({ ...ef, supplier_party_id: e.target.value === '' ? null : Number(e.target.value) })}>
                            <option value="">---</option>
                            {sizingParties.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          <button onClick={saveEdit} className="text-emerald-700 mr-2" title="Save"><Check className="w-4 h-4 inline" /></button>
                          <button onClick={() => { setEditingId(null); setEditForm(null); }} className="text-ink-mute" title="Cancel"><X className="w-4 h-4 inline" /></button>
                        </td>
                      </>
                    ) : (
                      <>
                        {/* Auto-issued ID derived from the row's
                            numeric primary key â€” short, sortable, and
                            unique without a schema change. */}
                        <td className="px-3 py-2 font-mono text-xs font-semibold">{`WBG-${String(r.id).padStart(4, '0')}`}</td>
                        <td className="px-3 py-2 text-ink-soft">{fmtDate(r.given_date)}</td>
                        <td className="px-3 py-2">{partyById.get(r.jobwork_party_id)?.name ?? '-'}</td>
                        <td className="px-3 py-2">{r.fabric_quality_id ? qualityById.get(r.fabric_quality_id)?.name ?? '-' : '-'}</td>
                        <td className="px-3 py-2">{r.warp_count_id ? countById.get(r.warp_count_id)?.display_name ?? '-' : '-'}</td>
                        <td className="px-3 py-2 text-right num">{r.total_ends ?? '-'}</td>
                        <td className="px-3 py-2 text-right num font-semibold">{r.beam_count}</td>
                        <td className="px-3 py-2 text-right num">{(r.original_metres ?? r.total_metres) ?? '-'}</td>
                        <td className="px-3 py-2 text-ink-soft">{r.supplier_party_id ? sizingParties.find((p) => p.id === r.supplier_party_id)?.name ?? '#' + r.supplier_party_id : '-'}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button onClick={() => { setEditingId(r.id); setEditForm(r); }} className="text-indigo-700 hover:text-indigo-900 mr-2" title="Edit"><Pencil className="w-4 h-4 inline" /></button>
                          <button onClick={() => setRestockId(restockId === r.id ? null : r.id)} className="text-indigo-700 hover:text-indigo-900 mr-2" title="Restock"><RefreshCw className="w-4 h-4 inline" /></button>
                          {/* Release â€” only meaningful when this row
                              has a pavu link; reverts the linked
                              pavus to in-stock so Pavu Master can
                              edit them again, then deletes the row. */}
                          {(r.pavu_id != null || (Array.isArray(r.pavu_ids) && r.pavu_ids.length > 0)) && (
                            <button
                              onClick={() => void release(r)}
                              className="text-amber-700 hover:text-amber-900 mr-2"
                              title="Release pavus back to in-stock"
                            >
                              <Unlock className="w-4 h-4 inline" />
                            </button>
                          )}
                          <button onClick={() => del(r.id)} className="text-rose-700 hover:text-rose-900" title="Delete"><Trash2 className="w-4 h-4 inline" /></button>
                        </td>
                      </>
                    )}
                  </tr>
                  {restockId === r.id && !isEditing && (
                    <tr><td colSpan={10} className="p-0">
                      <RestockForm parties={sizingParties}
                        qtyFields={[{ key: 'beam_count', label: 'No. of beams', step: 1 }, { key: 'total_metres', label: 'Total metres', step: 0.01 }]}
                        onCancel={() => setRestockId(null)}
                        onSave={(data) => restock(r, data)} />
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          {filteredRows.length > 0 && (
            <tfoot className="bg-cloud/40 font-semibold border-t-2 border-line">
              <tr>
                {/* Totals reflect the CURRENT filter, not the full table. */}
                <td colSpan={5} className="px-3 py-3 text-right text-ink-soft uppercase text-[11px] tracking-wide">Total</td>
                <td className="px-3 py-3 text-right num font-bold">
                  {filteredRows.reduce((s, r) => s + Number(r.beam_count ?? 0), 0).toLocaleString('en-IN')} beams
                </td>
                <td className="px-3 py-3 text-right num font-bold text-indigo-700">
                  {filteredRows.reduce((s, r) => s + Number((r.original_metres ?? r.total_metres) ?? 0), 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} m
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/* ===== Weft Bag tab ===== */
function WeftBagTab({ rows, parties, counts, allParties, partyById, countById, allPartyById, partyLabel, onChanged }: {
  rows: WeftBagRow[]; parties: PartyOpt[]; counts: CountOpt[]; allParties: PartyOpt[];
  partyById: Map<number, PartyOpt>; countById: Map<number, CountOpt>; allPartyById: Map<number, PartyOpt>;
  /** "Jobwork Party" or "Outsourcing party" depending on the route. */
  partyLabel: string;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [form, setForm] = useState({
    given_date: todayISO(), jobwork_party_id: '', yarn_count_id: '',
    bag_count: '', total_kg: '', reference_no: '', notes: '', supplier_party_id: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<WeftBagRow | null>(null);
  const [restockId, setRestockId] = useState<number | null>(null);
  // Toggle for the inline add form so the page loads with the form
  // hidden and the table front-and-centre (matches BobbinTab pattern).
  const [showAdd, setShowAdd] = useState<boolean>(false);
  void allPartyById;

  async function add() {
    setErr(null);
    if (form.jobwork_party_id === '') { setErr('Pick a jobwork party.'); return; }
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const payload = {
      jobwork_party_id: Number(form.jobwork_party_id),
      yarn_count_id: form.yarn_count_id === '' ? null : Number(form.yarn_count_id),
      given_date: form.given_date,
      bag_count: form.bag_count === '' ? null : Number(form.bag_count),
      total_kg: form.total_kg === '' ? null : Number(form.total_kg),
      reference_no: form.reference_no.trim() || null,
      notes: form.notes.trim() || null,
      supplier_party_id: form.supplier_party_id === '' ? null : Number(form.supplier_party_id),
    };
    const { error } = await sb.from('jobwork_weft_bag').insert(payload);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setForm({ given_date: todayISO(), jobwork_party_id: '', yarn_count_id: '', bag_count: '', total_kg: '', reference_no: '', notes: '', supplier_party_id: '' });
    setShowAdd(false);
    onChanged();
  }
  async function del(id: number) {
    if (!window.confirm('Delete this weft bag entry?')) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error } = await sb.from('jobwork_weft_bag').delete().eq('id', id);
    if (error) { setErr(error.message); return; }
    onChanged();
  }
  async function saveEdit() {
    if (!editForm) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    // Sync original_kg = total_kg so the history display (which reads
    // original_kg ?? total_kg) reflects the edit.
    const editedKg = editForm.total_kg;
    const { error } = await sb.from('jobwork_weft_bag').update({
      jobwork_party_id: editForm.jobwork_party_id,
      yarn_count_id: editForm.yarn_count_id,
      given_date: editForm.given_date,
      bag_count: editForm.bag_count,
      total_kg: editedKg,
      original_kg: editedKg,
      reference_no: editForm.reference_no,
      notes: editForm.notes,
    }).eq('id', editForm.id);
    if (error) { setErr(error.message); return; }
    setEditingId(null); setEditForm(null);
    onChanged();
  }
  async function restock(parent: WeftBagRow, data: { given_date: string; supplier_party_id: string; qty: Record<string, string> }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const payload = {
      jobwork_party_id: parent.jobwork_party_id,
      yarn_count_id: parent.yarn_count_id,
      given_date: data.given_date,
      bag_count: data.qty.bag_count === '' ? null : Number(data.qty.bag_count),
      total_kg: data.qty.total_kg === '' ? null : Number(data.qty.total_kg),
      reference_no: `RESTOCK-${parent.id}`,
      notes: null,
      supplier_party_id: data.supplier_party_id === '' ? null : Number(data.supplier_party_id),
    };
    const { error } = await sb.from('jobwork_weft_bag').insert(payload);
    if (error) { window.alert('Restock failed: ' + error.message); return; }
    setRestockId(null);
    onChanged();
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-ink-mute">Weft bags issued to jobwork parties. Use Add to log a new bag; Restock to log a fresh batch.</p>
        <button type="button" onClick={() => setShowAdd((v) => !v)} className="btn-primary">
          {showAdd ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showAdd ? 'Cancel' : 'Add weft bag given'}
        </button>
      </div>

      {showAdd && (
      <div className="card p-4 mb-4">
        <h3 className="font-display font-bold text-sm mb-3">Add weft bag</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><label className="label text-xs">Date *</label><input type="date" className="input" value={form.given_date} onChange={(e) => setForm({ ...form, given_date: e.target.value })} /></div>
          <div><label className="label text-xs">{partyLabel} *</label><select className="input" value={form.jobwork_party_id} onChange={(e) => setForm({ ...form, jobwork_party_id: e.target.value })}><option value="">--- pick ---</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}</select></div>
          <div><label className="label text-xs">Yarn count</label><select className="input" value={form.yarn_count_id} onChange={(e) => setForm({ ...form, yarn_count_id: e.target.value })}><option value="">---</option>{counts.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.display_name}</option>)}</select></div>
          <div><label className="label text-xs">Bag count</label><input type="number" className="input num" value={form.bag_count} onChange={(e) => setForm({ ...form, bag_count: e.target.value })} /></div>
          <div><label className="label text-xs">Total kg</label><input type="number" step={0.001} className="input num" value={form.total_kg} onChange={(e) => setForm({ ...form, total_kg: e.target.value })} /></div>
          <div><label className="label text-xs">Supplier party</label><select className="input" value={form.supplier_party_id} onChange={(e) => setForm({ ...form, supplier_party_id: e.target.value })}><option value="">---</option>{allParties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div><label className="label text-xs">Reference / DC no</label><input className="input" value={form.reference_no} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} /></div>
          <div><label className="label text-xs">Notes</label><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        {err && <div className="mt-3 text-sm text-err">{err}</div>}
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={add} disabled={busy} className="btn-primary">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add weft bag</button>
        </div>
      </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-3 py-3">Date</th>
              <th className="text-left px-3 py-3">Party</th>
              <th className="text-left px-3 py-3">Yarn count</th>
              <th className="text-right px-3 py-3">Bags</th>
              <th className="text-right px-3 py-3">Total kg</th>
              <th className="text-left px-3 py-3">DC #</th>
              <th className="text-right px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-ink-soft">No weft bags issued yet.</td></tr>
            ) : rows.map((r) => {
              const isEditing = editingId === r.id;
              const ef = editForm ?? r;
              return (
                <React.Fragment key={r.id}>
                  <tr className="border-t border-line/40">
                    {isEditing ? (
                      <>
                        <td className="px-2 py-2"><input type="date" className="input h-8 text-xs" value={ef.given_date} onChange={(e) => setEditForm({ ...ef, given_date: e.target.value })} /></td>
                        <td className="px-2 py-2"><select className="input h-8 text-xs" value={ef.jobwork_party_id} onChange={(e) => setEditForm({ ...ef, jobwork_party_id: Number(e.target.value) })}>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td>
                        <td className="px-2 py-2"><select className="input h-8 text-xs" value={ef.yarn_count_id ?? ''} onChange={(e) => setEditForm({ ...ef, yarn_count_id: e.target.value === '' ? null : Number(e.target.value) })}><option value="">---</option>{counts.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}</select></td>
                        <td className="px-2 py-2"><input type="number" className="input num h-8 text-xs w-20" value={ef.bag_count ?? ''} onChange={(e) => setEditForm({ ...ef, bag_count: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                        <td className="px-2 py-2"><input type="number" step={0.001} className="input num h-8 text-xs w-24" value={ef.total_kg ?? ''} onChange={(e) => setEditForm({ ...ef, total_kg: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                        <td className="px-2 py-2"><input className="input h-8 text-xs w-24" value={ef.reference_no ?? ''} onChange={(e) => setEditForm({ ...ef, reference_no: e.target.value || null })} /></td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          <button onClick={saveEdit} className="text-emerald-700 mr-2" title="Save"><Check className="w-4 h-4 inline" /></button>
                          <button onClick={() => { setEditingId(null); setEditForm(null); }} className="text-ink-mute" title="Cancel"><X className="w-4 h-4 inline" /></button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-ink-soft">{fmtDate(r.given_date)}</td>
                        <td className="px-3 py-2">{partyById.get(r.jobwork_party_id)?.name ?? '-'}</td>
                        <td className="px-3 py-2">{r.yarn_count_id ? countById.get(r.yarn_count_id)?.display_name ?? '-' : '-'}</td>
                        <td className="px-3 py-2 text-right num">{r.bag_count ?? '-'}</td>
                        <td className="px-3 py-2 text-right num font-semibold">{(r.original_kg ?? r.total_kg) ?? '-'}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.reference_no ?? '-'}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button onClick={() => { setEditingId(r.id); setEditForm(r); }} className="text-indigo-700 hover:text-indigo-900 mr-2" title="Edit"><Pencil className="w-4 h-4 inline" /></button>
                          <button onClick={() => setRestockId(restockId === r.id ? null : r.id)} className="text-indigo-700 hover:text-indigo-900 mr-2" title="Restock"><RefreshCw className="w-4 h-4 inline" /></button>
                          <button onClick={() => del(r.id)} className="text-rose-700 hover:text-rose-900" title="Delete"><Trash2 className="w-4 h-4 inline" /></button>
                        </td>
                      </>
                    )}
                  </tr>
                  {restockId === r.id && !isEditing && (
                    <tr><td colSpan={7} className="p-0">
                      <RestockForm parties={allParties}
                        qtyFields={[{ key: 'bag_count', label: 'Bag count', step: 1 }, { key: 'total_kg', label: 'Total kg', step: 0.001 }]}
                        onCancel={() => setRestockId(null)}
                        onSave={(data) => restock(r, data)} />
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-cloud/40 font-semibold border-t-2 border-line">
              <tr>
                <td colSpan={3} className="px-3 py-3 text-right text-ink-soft uppercase text-[11px] tracking-wide">Total</td>
                <td className="px-3 py-3 text-right num font-bold">
                  {rows.reduce((s, r) => s + Number(r.bag_count ?? 0), 0).toLocaleString('en-IN')} bags
                </td>
                <td className="px-3 py-3 text-right num font-bold text-indigo-700">
                  {rows.reduce((s, r) => s + Number((r.original_kg ?? r.total_kg) ?? 0), 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })} kg
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/* ===== Warp Yarn (sizing) tab =====
 * Mirrors the WeftBagTab / WarpBeamTab pattern: receives rows + lookup
 * maps from the parent, owns its own add / edit / delete / restock state.
 * Writes against the jobwork_warp_yarn table (migration 074-075).
 */
function WarpYarnTab({
  rows, parties, qualities, counts, endsOptions, allParties,
  partyById, qualityById, countById, endsById, allPartyById,
  partyLabel, onChanged,
}: {
  rows: WarpYarnRow[];
  parties: PartyOpt[]; qualities: QualityOpt[]; counts: CountOpt[];
  endsOptions: EndsOpt[]; allParties: PartyOpt[];
  partyById: Map<number, PartyOpt>; qualityById: Map<number, QualityOpt>;
  countById: Map<number, CountOpt>; endsById: Map<number, EndsOpt>;
  allPartyById: Map<number, PartyOpt>;
  /** "Jobwork Party" or "Outsourcing party" depending on the route. */
  partyLabel: string;
  onChanged: () => void;
}): React.ReactElement {
  const supabase = createClient();
  const [form, setForm] = useState({
    given_date: todayISO(), jobwork_party_id: '', fabric_quality_id: '', ends_id: '', warp_count_id: '',
    total_kg: '', sizing_rate_per_kg: '', total_cost: '', reference_no: '', notes: '', supplier_party_id: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<WarpYarnRow | null>(null);
  const [restockId, setRestockId] = useState<number | null>(null);
  // Toggle for the inline add form (matches Bobbin/Weft Bag pattern).
  const [showAdd, setShowAdd] = useState<boolean>(false);
  void allPartyById;

  async function add(): Promise<void> {
    setErr(null);
    if (form.jobwork_party_id === '') { setErr(`Pick a ${partyLabel.toLowerCase()}.`); return; }
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const payload = {
      jobwork_party_id: Number(form.jobwork_party_id),
      fabric_quality_id: form.fabric_quality_id === '' ? null : Number(form.fabric_quality_id),
      ends_id: form.ends_id === '' ? null : Number(form.ends_id),
      warp_count_id: form.warp_count_id === '' ? null : Number(form.warp_count_id),
      given_date: form.given_date,
      total_kg: form.total_kg === '' ? null : Number(form.total_kg),
      sizing_rate_per_kg: form.sizing_rate_per_kg === '' ? null : Number(form.sizing_rate_per_kg),
      total_cost: form.total_cost === '' ? null : Number(form.total_cost),
      reference_no: form.reference_no.trim() || null,
      notes: form.notes.trim() || null,
      supplier_party_id: form.supplier_party_id === '' ? null : Number(form.supplier_party_id),
    };
    const { error } = await sb.from('jobwork_warp_yarn').insert(payload);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setForm({ given_date: todayISO(), jobwork_party_id: '', fabric_quality_id: '', ends_id: '', warp_count_id: '', total_kg: '', sizing_rate_per_kg: '', total_cost: '', reference_no: '', notes: '', supplier_party_id: '' });
    setShowAdd(false);
    onChanged();
  }
  async function del(id: number): Promise<void> {
    if (!window.confirm('Delete this warp yarn entry?')) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error } = await sb.from('jobwork_warp_yarn').delete().eq('id', id);
    if (error) { setErr(error.message); return; }
    onChanged();
  }
  async function saveEdit(): Promise<void> {
    if (!editForm) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error } = await sb.from('jobwork_warp_yarn').update({
      jobwork_party_id: editForm.jobwork_party_id,
      fabric_quality_id: editForm.fabric_quality_id,
      ends_id: editForm.ends_id,
      warp_count_id: editForm.warp_count_id,
      given_date: editForm.given_date,
      total_kg: editForm.total_kg,
      sizing_rate_per_kg: editForm.sizing_rate_per_kg,
      total_cost: editForm.total_cost,
      reference_no: editForm.reference_no,
      notes: editForm.notes,
    }).eq('id', editForm.id);
    if (error) { setErr(error.message); return; }
    setEditingId(null); setEditForm(null);
    onChanged();
  }
  async function restock(parent: WarpYarnRow, data: { given_date: string; supplier_party_id: string; qty: Record<string, string> }): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const kg = data.qty.total_kg === '' ? null : Number(data.qty.total_kg);
    const payload = {
      jobwork_party_id: parent.jobwork_party_id,
      fabric_quality_id: parent.fabric_quality_id,
      ends_id: parent.ends_id,
      warp_count_id: parent.warp_count_id,
      given_date: data.given_date,
      total_kg: kg,
      sizing_rate_per_kg: parent.sizing_rate_per_kg,
      total_cost: kg !== null && parent.sizing_rate_per_kg !== null ? kg * Number(parent.sizing_rate_per_kg) : null,
      reference_no: `RESTOCK-${parent.id}`,
      notes: null,
      supplier_party_id: data.supplier_party_id === '' ? null : Number(data.supplier_party_id),
    };
    const { error } = await sb.from('jobwork_warp_yarn').insert(payload);
    if (error) { window.alert('Restock failed: ' + error.message); return; }
    setRestockId(null);
    onChanged();
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-ink-mute">Warp yarn (sizing) issued. Use Add to log a new batch; Restock to clone a previous batch with fresh date/qty.</p>
        <button type="button" onClick={() => setShowAdd((v) => !v)} className="btn-primary">
          {showAdd ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showAdd ? 'Cancel' : 'Add warp yarn given'}
        </button>
      </div>

      {showAdd && (
      <div className="card p-4 mb-4">
        <h3 className="font-display font-bold text-sm mb-3">Add warp yarn</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div><label className="label text-xs">Date *</label><input type="date" className="input" value={form.given_date} onChange={(e) => setForm({ ...form, given_date: e.target.value })} /></div>
          <div><label className="label text-xs">{partyLabel} *</label><select className="input" value={form.jobwork_party_id} onChange={(e) => setForm({ ...form, jobwork_party_id: e.target.value })}><option value="">--- pick ---</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}</select></div>
          <div><label className="label text-xs">Fabric quality</label><select className="input" value={form.fabric_quality_id} onChange={(e) => setForm({ ...form, fabric_quality_id: e.target.value })}><option value="">---</option>{qualities.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}</select></div>
          <div><label className="label text-xs">Ends spec</label><select className="input" value={form.ends_id} onChange={(e) => setForm({ ...form, ends_id: e.target.value })}><option value="">---</option>{endsOptions.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
          <div><label className="label text-xs">Warp count</label><select className="input" value={form.warp_count_id} onChange={(e) => setForm({ ...form, warp_count_id: e.target.value })}><option value="">---</option>{counts.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.display_name}</option>)}</select></div>
          <div><label className="label text-xs">Total kg</label><input type="number" step={0.001} className="input num" value={form.total_kg} onChange={(e) => setForm({ ...form, total_kg: e.target.value })} /></div>
          <div><label className="label text-xs">Sizing rate Rs/kg</label><input type="number" step={0.5} className="input num" value={form.sizing_rate_per_kg} onChange={(e) => setForm({ ...form, sizing_rate_per_kg: e.target.value })} /></div>
          <div><label className="label text-xs">Total cost</label><input type="number" step={0.01} className="input num" value={form.total_cost} onChange={(e) => setForm({ ...form, total_cost: e.target.value })} /></div>
          <div><label className="label text-xs">Supplier party</label><select className="input" value={form.supplier_party_id} onChange={(e) => setForm({ ...form, supplier_party_id: e.target.value })}><option value="">---</option>{allParties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div><label className="label text-xs">Reference / DC no</label><input className="input" value={form.reference_no} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} /></div>
          <div className="md:col-span-2"><label className="label text-xs">Notes</label><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        {err && <div className="mt-3 text-sm text-err">{err}</div>}
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={add} disabled={busy} className="btn-primary">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add warp yarn</button>
        </div>
      </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-3 py-3">Date</th>
              <th className="text-left px-3 py-3">Party</th>
              <th className="text-left px-3 py-3">Quality</th>
              <th className="text-left px-3 py-3">Ends</th>
              <th className="text-left px-3 py-3">Count</th>
              <th className="text-right px-3 py-3">Kg</th>
              <th className="text-right px-3 py-3">Rate</th>
              <th className="text-right px-3 py-3">Cost</th>
              <th className="text-right px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-ink-soft">No warp yarn issued yet.</td></tr>
            ) : rows.map((r) => {
              const isEditing = editingId === r.id;
              const ef = editForm ?? r;
              return (
                <React.Fragment key={r.id}>
                  <tr className="border-t border-line/40">
                    {isEditing ? (
                      <>
                        <td className="px-2 py-2"><input type="date" className="input h-8 text-xs" value={ef.given_date} onChange={(e) => setEditForm({ ...ef, given_date: e.target.value })} /></td>
                        <td className="px-2 py-2"><select className="input h-8 text-xs" value={ef.jobwork_party_id} onChange={(e) => setEditForm({ ...ef, jobwork_party_id: Number(e.target.value) })}>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td>
                        <td className="px-2 py-2"><select className="input h-8 text-xs" value={ef.fabric_quality_id ?? ''} onChange={(e) => setEditForm({ ...ef, fabric_quality_id: e.target.value === '' ? null : Number(e.target.value) })}><option value="">---</option>{qualities.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}</select></td>
                        <td className="px-2 py-2"><select className="input h-8 text-xs" value={ef.ends_id ?? ''} onChange={(e) => setEditForm({ ...ef, ends_id: e.target.value === '' ? null : Number(e.target.value) })}><option value="">---</option>{endsOptions.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></td>
                        <td className="px-2 py-2"><select className="input h-8 text-xs" value={ef.warp_count_id ?? ''} onChange={(e) => setEditForm({ ...ef, warp_count_id: e.target.value === '' ? null : Number(e.target.value) })}><option value="">---</option>{counts.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}</select></td>
                        <td className="px-2 py-2"><input type="number" step={0.001} className="input num h-8 text-xs w-20" value={ef.total_kg ?? ''} onChange={(e) => setEditForm({ ...ef, total_kg: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                        <td className="px-2 py-2"><input type="number" step={0.5} className="input num h-8 text-xs w-16" value={ef.sizing_rate_per_kg ?? ''} onChange={(e) => setEditForm({ ...ef, sizing_rate_per_kg: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                        <td className="px-2 py-2"><input type="number" step={0.01} className="input num h-8 text-xs w-20" value={ef.total_cost ?? ''} onChange={(e) => setEditForm({ ...ef, total_cost: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          <button onClick={saveEdit} className="text-emerald-700 mr-2" title="Save"><Check className="w-4 h-4 inline" /></button>
                          <button onClick={() => { setEditingId(null); setEditForm(null); }} className="text-ink-mute" title="Cancel"><X className="w-4 h-4 inline" /></button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-ink-soft">{fmtDate(r.given_date)}</td>
                        <td className="px-3 py-2">{partyById.get(r.jobwork_party_id)?.name ?? '-'}</td>
                        <td className="px-3 py-2">{r.fabric_quality_id ? qualityById.get(r.fabric_quality_id)?.name ?? '-' : '-'}</td>
                        <td className="px-3 py-2">{r.ends_id ? endsById.get(r.ends_id)?.name ?? '-' : '-'}</td>
                        <td className="px-3 py-2">{r.warp_count_id ? countById.get(r.warp_count_id)?.display_name ?? '-' : '-'}</td>
                        <td className="px-3 py-2 text-right num font-semibold">{r.total_kg ?? '-'}</td>
                        <td className="px-3 py-2 text-right num">{r.sizing_rate_per_kg ?? '-'}</td>
                        <td className="px-3 py-2 text-right num">{r.total_cost ?? '-'}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button onClick={() => { setEditingId(r.id); setEditForm(r); }} className="text-indigo-700 hover:text-indigo-900 mr-2" title="Edit"><Pencil className="w-4 h-4 inline" /></button>
                          <button onClick={() => setRestockId(restockId === r.id ? null : r.id)} className="text-indigo-700 hover:text-indigo-900 mr-2" title="Restock"><RefreshCw className="w-4 h-4 inline" /></button>
                          <button onClick={() => del(r.id)} className="text-rose-700 hover:text-rose-900" title="Delete"><Trash2 className="w-4 h-4 inline" /></button>
                        </td>
                      </>
                    )}
                  </tr>
                  {restockId === r.id && !isEditing && (
                    <tr><td colSpan={9} className="p-0">
                      <RestockForm parties={allParties}
                        qtyFields={[{ key: 'total_kg', label: 'Total kg', step: 0.001 }]}
                        onCancel={() => setRestockId(null)}
                        onSave={(data) => restock(r, data)} />
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-cloud/40 font-semibold border-t-2 border-line">
              <tr>
                <td colSpan={5} className="px-3 py-3 text-right text-ink-soft uppercase text-[11px] tracking-wide">Total</td>
                <td className="px-3 py-3 text-right num font-bold text-indigo-700">
                  {rows.reduce((s, r) => s + Number(r.total_kg ?? 0), 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })} kg
                </td>
                <td />
                <td className="px-3 py-3 text-right num font-bold text-indigo-700">
                  {rows.reduce((s, r) => s + Number(r.total_cost ?? 0), 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

