'use client';
/**
 * Delivery Challan form (shared by /new and /[id]).
 *
 * Hierarchical item model:
 *   Item (fabric quality + HSN)
 *     Bundle #1
 *       Piece 1: 5.20 m
 *       Piece 2: 6.10 m
 *     Bundle #2
 *       Piece 1: 5.50 m
 *       ...
 *
 * The operator first says "how many bundles" - we render that many bundle
 * cards. In each card they add piece-metre entries (one entry per piece).
 *
 * Item-level snapshots:
 *   metres  = sum of every piece across every bundle
 *   pieces  = total piece count across every bundle
 *   bundles = number of bundles
 *
 * Header-level snapshots are sums across all items.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Plus, Trash2, Save, X } from 'lucide-react';

export type ProductionMode = 'inhouse' | 'jobwork' | 'outsource';

export interface PartyOpt {
  id: number;
  code: string;
  name: string;
  gstin: string | null;
  billing_address: string | null;
  city: string | null;
  state: string | null;
  state_code: string | null;
  pincode: string | null;
  party_type_ids: number[] | null;
}

export interface QualityOpt {
  id: number;
  code: string | null;
  name: string;
  hsn: string | null;
  production_mode: string | null;
  is_merged: boolean | null;
  merged_name: string | null;
}

/** Each piece is just a metres value (as a string for controlled input). */
export type Piece = string;

/** A bundle is an ordered list of pieces. */
export interface Bundle {
  sno: number;
  pieces: Piece[];
}

export interface DcItem {
  id?: number;
  sno: number;
  fabric_quality_id: string;
  description: string;
  hsn: string;
  bundles: Bundle[];
  // Summary-mode totals: operator types these directly when the DC entry
  // mode is 'summary'. They are ignored in 'detailed' mode where the totals
  // get rolled up from bundles[].pieces[].
  summary_metres: string;
  summary_pieces: string;
  summary_bundles: string;
}

export type DcEntryMode = 'detailed' | 'summary';

export interface DcFormValues {
  id?: number;
  code?: string;
  dc_date: string;
  status: 'draft' | 'confirmed' | 'invoiced' | 'cancelled';
  production_mode: ProductionMode;
  /**
   * detailed - hierarchical bundle/piece grid (default)
   * summary  - flat totals only per fabric quality
   */
  entry_mode: DcEntryMode;
  party_id: string;
  ship_to_same: boolean;
  ship_to_party_id: string;
  bill_to_name: string;
  bill_to_address: string;
  bill_to_gstin: string;
  bill_to_state: string;
  bill_to_state_code: string;
  ship_to_name: string;
  ship_to_address: string;
  ship_to_gstin: string;
  ship_to_state: string;
  ship_to_state_code: string;
  vehicle_no: string;
  notes: string;
  items: DcItem[];
}

interface DcFormProps {
  initial?: DcFormValues;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function emptyItem(sno: number): DcItem {
  return {
    sno,
    fabric_quality_id: '',
    description: '',
    hsn: '',
    bundles: [{ sno: 1, pieces: [''] }],
    summary_metres: '',
    summary_pieces: '',
    summary_bundles: '',
  };
}

export const EMPTY_DC: DcFormValues = {
  dc_date: todayISO(),
  status: 'draft',
  production_mode: 'inhouse',
  entry_mode: 'detailed',
  party_id: '',
  ship_to_same: true,
  ship_to_party_id: '',
  bill_to_name: '', bill_to_address: '', bill_to_gstin: '', bill_to_state: '', bill_to_state_code: '',
  ship_to_name: '', ship_to_address: '', ship_to_gstin: '', ship_to_state: '', ship_to_state_code: '',
  vehicle_no: '',
  notes: '',
  items: [emptyItem(1)],
};

function num(s: string): number {
  const t = (s ?? '').toString().trim();
  if (t === '') return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

/** Sum of piece metres across one bundle. */
function bundleMetres(b: Bundle): number {
  return b.pieces.reduce((s, p) => s + num(p), 0);
}

/** Item-level snapshots: metres = sum across bundles, pieces = total
 *  pieces, bundles = bundle count. Empty piece strings are ignored. */
function itemTotals(it: DcItem, mode: DcEntryMode = 'detailed'): { metres: number; pieces: number; bundles: number } {
  if (mode === 'summary') {
    return {
      metres:  num(it.summary_metres),
      pieces:  Math.round(num(it.summary_pieces)),
      bundles: Math.round(num(it.summary_bundles)),
    };
  }
  let metres = 0;
  let pieces = 0;
  for (const b of it.bundles) {
    for (const p of b.pieces) {
      const v = num(p);
      if (v > 0) {
        metres += v;
        pieces += 1;
      }
    }
  }
  return { metres, pieces, bundles: it.bundles.length };
}

export function DeliveryChallanForm({ initial }: DcFormProps): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = initial?.id != null;

  const [form, setForm] = useState<DcFormValues>({ ...EMPTY_DC, ...(initial ?? {}) });
  const [allParties, setAllParties]         = useState<PartyOpt[]>([]);
  const [qualities,  setQualities]          = useState<QualityOpt[]>([]);
  const [customerTypeId,  setCustomerTypeId]  = useState<number | null>(null);
  const [jobworkTypeId,   setJobworkTypeId]   = useState<number | null>(null);
  const [outsourceTypeId, setOutsourceTypeId] = useState<number | null>(null);
  // Recent vehicle numbers used on past DCs — fed into a native
  // <datalist> so the operator can pick one without retyping. Sourced
  // straight from delivery_challan.vehicle_no, deduped, and capped at
  // 50 so the suggestion list stays short.
  const [vehicleSuggestions, setVehicleSuggestions] = useState<string[]>([]);
  const [busy,  setBusy]  = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // Preview of the next DC code the BEFORE INSERT trigger will mint
  // — peeked from doc_sequence so the operator knows the number ahead
  // of saving. Re-read whenever production_mode changes; each mode
  // pulls from its own series (DC / JDC / ODC).
  const [nextDcCode, setNextDcCode] = useState<string>('');

  // ---- Load reference data ----
  useEffect(() => {
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const [ptRes, partyRes, fqRes] = await Promise.all([
        sb.from('party_type_master').select('id, name').in('name', ['Customer', 'Jobwork Party', 'Outsource Weaver']),
        sb.from('party').select('id, code, name, gstin, billing_address, city, state, state_code, pincode, party_type_ids').eq('status', 'active').order('name'),
        sb.from('fabric_quality').select('id, code, name, hsn, production_mode, is_merged, merged_name').eq('active', true).order('name'),
      ]);
      const types = (ptRes.data ?? []) as Array<{ id: number; name: string }>;
      setCustomerTypeId(types.find((t) => t.name === 'Customer')?.id ?? null);
      setJobworkTypeId(types.find((t) => t.name === 'Jobwork Party')?.id ?? null);
      setOutsourceTypeId(types.find((t) => t.name === 'Outsource Weaver')?.id ?? null);
      setAllParties((partyRes.data ?? []) as PartyOpt[]);
      setQualities((fqRes.data ?? []) as QualityOpt[]);

      // Pull recent vehicle numbers for the autocomplete datalist.
      // We grab the last 200 DC vehicle entries (newest first), dedupe
      // case-insensitively, and keep the first 50 unique values. The
      // user usually rotates between a handful of trucks so this is
      // plenty without bloating the suggestion list.
      const vehRes = await sb
        .from('delivery_challan')
        .select('vehicle_no')
        .not('vehicle_no', 'is', null)
        .order('dc_date', { ascending: false })
        .order('id', { ascending: false })
        .limit(200);
      const seen = new Set<string>();
      const uniques: string[] = [];
      for (const row of (vehRes.data ?? []) as Array<{ vehicle_no: string | null }>) {
        const v = (row.vehicle_no ?? '').trim().toUpperCase();
        if (v === '' || seen.has(v)) continue;
        seen.add(v);
        uniques.push(v);
        if (uniques.length >= 50) break;
      }
      setVehicleSuggestions(uniques);
    })();
  }, [supabase]);

  // ---- Party dropdown filtered by mode ----
  // Each production mode targets a specific party type:
  //   inhouse   → Customer
  //   jobwork   → Jobwork Party
  //   outsource → Outsource Weaver
  const filteredParties = useMemo<PartyOpt[]>(() => {
    if (form.production_mode === 'jobwork') {
      return jobworkTypeId === null
        ? allParties
        : allParties.filter((p) => (p.party_type_ids ?? []).includes(jobworkTypeId));
    }
    if (form.production_mode === 'outsource') {
      return outsourceTypeId === null
        ? allParties
        : allParties.filter((p) => (p.party_type_ids ?? []).includes(outsourceTypeId));
    }
    return customerTypeId === null
      ? allParties
      : allParties.filter((p) => (p.party_type_ids ?? []).includes(customerTypeId));
  }, [allParties, form.production_mode, customerTypeId, jobworkTypeId, outsourceTypeId]);

  const partyById = useMemo(() => new Map(allParties.map((p) => [p.id, p])), [allParties]);

  // Peek the next DC code from doc_sequence whenever the production
  // mode changes (or on first paint, when the form is new). Each mode
  // reads from its own row:
  //   inhouse   → 'dc'           (DC/26-27/NNNN)
  //   jobwork   → 'jobwork_dc'   (JDC/26-27/NNNN)
  //   outsource → 'outsource_dc' (ODC/26-27/NNNN)
  // The BEFORE INSERT trigger generates the real code on save; this
  // is purely a UI peek.
  useEffect(() => {
    if (isEdit) return;
    let cancelled = false;
    void (async () => {
      const docType = form.production_mode === 'jobwork'
        ? 'jobwork_dc'
        : form.production_mode === 'outsource'
          ? 'outsource_dc'
          : 'dc';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data } = await sb
        .from('doc_sequence')
        .select('prefix, format, fy_code, next_value')
        .eq('doc_type', docType)
        .maybeSingle();
      if (cancelled) return;
      if (!data) { setNextDcCode(''); return; }
      const { prefix, format, fy_code, next_value } = data as {
        prefix: string; format: string; fy_code: string; next_value: number;
      };
      const seqMatch = /\{seq:(0+)\}/.exec(format);
      const width = seqMatch?.[1]?.length ?? 4;
      const seqStr = String(next_value).padStart(width, '0');
      const code = format
        .replace('{prefix}', prefix)
        .replace('{fy}', fy_code)
        .replace(/\{seq:0+\}/, seqStr);
      setNextDcCode(code);
    })();
    return () => { cancelled = true; };
  }, [form.production_mode, isEdit, supabase]);

  // ---- Fabric quality dropdown filtered by DC production mode ----
  // String mismatch alert: delivery_challan.production_mode stores
  // 'jobwork' (no underscore) but fabric_quality.production_mode stores
  // 'job_work' (with underscore — see migration 065 + fabric quality
  // form). We normalize: the DC's 'jobwork' mode matches fabric
  // qualities whose production_mode is either 'job_work' or 'jobwork'.
  // In inhouse DCs we show everything that ISN'T a jobwork quality
  // (covers inhouse + outsourcing + null). Qualities already saved on
  // an item stay visible so the operator can see what was picked
  // before, even if the mode now disqualifies them.
  const filteredQualities = useMemo<QualityOpt[]>(() => {
    const keepIds = new Set<number>(
      form.items
        .map((it) => Number(it.fabric_quality_id))
        .filter((n) => Number.isInteger(n) && n > 0),
    );
    const isJobworkQuality = (q: QualityOpt): boolean =>
      q.production_mode === 'job_work' || q.production_mode === 'jobwork';

    // Step 1: apply the production-mode filter (with keepIds escape
    // hatch so any quality already on an item stays visible).
    const modeFiltered = form.production_mode === 'jobwork'
      ? qualities.filter((q) => isJobworkQuality(q) || keepIds.has(q.id))
      : qualities.filter((q) => !isJobworkQuality(q) || keepIds.has(q.id));

    // Step 2: collapse merged-delivery siblings. For each merged group
    // (rows with is_merged=true sharing a merged_name), show ONE option
    // with the merged_name as the label. The option's value is the id
    // of a representative sibling - we prefer a sibling already saved
    // on an item so existing DCs reload correctly; otherwise the
    // smallest id wins.
    const mergedGroups = new Map<string, QualityOpt[]>();
    const standalone: QualityOpt[] = [];
    for (const q of modeFiltered) {
      if (q.is_merged && q.merged_name && q.merged_name.trim() !== '') {
        const mn = q.merged_name.trim();
        const list = mergedGroups.get(mn);
        if (list) list.push(q);
        else mergedGroups.set(mn, [q]);
      } else {
        standalone.push(q);
      }
    }
    const result: QualityOpt[] = [...standalone];
    for (const [mn, group] of mergedGroups) {
      const keepSibling = group.find((q) => keepIds.has(q.id));
      const rep = keepSibling ?? group.slice().sort((a, b) => a.id - b.id)[0]!;
      // Overlay the merged_name as the displayed `name` so the dropdown
      // option label reads "Bath Towel 30x60" instead of "FQ-0001".
      result.push({ ...rep, name: mn });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [qualities, form.production_mode, form.items]);

  function pickParty(partyIdStr: string): void {
    setForm((f) => {
      const next = { ...f, party_id: partyIdStr };
      const p = partyById.get(Number(partyIdStr));
      if (p) {
        next.bill_to_name       = p.name;
        next.bill_to_address    = [p.billing_address, p.city, p.pincode].filter(Boolean).join(', ');
        next.bill_to_gstin      = p.gstin ?? '';
        next.bill_to_state      = p.state ?? '';
        next.bill_to_state_code = p.state_code ?? '';
      }
      return next;
    });
  }

  function pickShipToParty(partyIdStr: string): void {
    setForm((f) => {
      const next = { ...f, ship_to_party_id: partyIdStr };
      const p = partyById.get(Number(partyIdStr));
      if (p) {
        next.ship_to_name       = p.name;
        next.ship_to_address    = [p.billing_address, p.city, p.pincode].filter(Boolean).join(', ');
        next.ship_to_gstin      = p.gstin ?? '';
        next.ship_to_state      = p.state ?? '';
        next.ship_to_state_code = p.state_code ?? '';
      }
      return next;
    });
  }

  // ---- Item helpers ----
  function setItem(idx: number, patch: Partial<DcItem>): void {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    }));
  }
  function addItem(): void {
    setForm((f) => ({ ...f, items: [...f.items, emptyItem(f.items.length + 1)] }));
  }
  function removeItem(idx: number): void {
    setForm((f) => ({
      ...f,
      items: f.items.filter((_, i) => i !== idx).map((it, i) => ({ ...it, sno: i + 1 })),
    }));
  }
  function pickFabric(idx: number, fqIdStr: string): void {
    const fq = qualities.find((q) => String(q.id) === fqIdStr);
    setItem(idx, {
      fabric_quality_id: fqIdStr,
      description: fq?.name ?? '',
      hsn: fq?.hsn ?? '',
    });
  }

  // ---- Bundle helpers ----
  // When the operator types "Bundles = N" we either grow or shrink the
  // bundle list to length N. New bundles start with one empty piece input.
  function setBundleCount(itemIdx: number, count: number): void {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => {
        if (i !== itemIdx) return it;
        const target = Math.max(0, Math.min(count, 200));
        const cur = it.bundles;
        let next: Bundle[];
        if (target > cur.length) {
          const grow: Bundle[] = [];
          for (let k = cur.length; k < target; k++) {
            grow.push({ sno: k + 1, pieces: [''] });
          }
          next = [...cur, ...grow];
        } else if (target < cur.length) {
          next = cur.slice(0, target);
        } else {
          next = cur;
        }
        return { ...it, bundles: next.map((b, k) => ({ ...b, sno: k + 1 })) };
      }),
    }));
  }
  function setPiece(itemIdx: number, bundleIdx: number, pieceIdx: number, value: string): void {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => {
        if (i !== itemIdx) return it;
        return {
          ...it,
          bundles: it.bundles.map((b, j) => {
            if (j !== bundleIdx) return b;
            return { ...b, pieces: b.pieces.map((p, k) => (k === pieceIdx ? value : p)) };
          }),
        };
      }),
    }));
  }
  // Enter-as-Tab navigation. Attached at the items-container level so
  // a single handler covers every field inside the items section:
  // No. of bundles, No. of pieces, each piece input, summary inputs,
  // HSN, description, etc.
  //
  // Skipped on purpose:
  //   - <textarea>          (Enter keeps its native newline behaviour)
  //   - <button>            (Enter on a button should click it)
  //   - <input type="file"> (would steal focus before the picker opens)
  //
  // The walk is DOM-ordered so the focus chain naturally follows the
  // visible layout: bundle-count → No. of pieces → piece 1 → piece 2
  // → ... → next bundle's No. of pieces → ... → next item.
  function handleItemsEnter(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== 'Enter') return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const tag = target.tagName;
    if (tag === 'TEXTAREA' || tag === 'BUTTON') return;
    if (tag === 'INPUT' && (target as HTMLInputElement).type === 'file') return;
    // IME composition (e.g. typing in a non-Latin script) — let the
    // user finish composing before we hijack Enter.
    if (e.nativeEvent.isComposing) return;
    e.preventDefault();

    // Pull every focusable input/select inside the items container
    // (this DIV is what we attached the handler to via currentTarget).
    const container = e.currentTarget;
    const focusable = Array.from(container.querySelectorAll<HTMLElement>(
      'input:not([disabled]):not([type="hidden"]):not([type="file"]), select:not([disabled])',
    ));
    const idx = focusable.indexOf(target);
    if (idx === -1) return;
    const next = focusable[idx + 1];
    if (next) {
      next.focus();
      // Select the contents of number/text inputs so a fresh Enter →
      // type → Enter cycle replaces the value instead of appending.
      if (next instanceof HTMLInputElement &&
          (next.type === 'number' || next.type === 'text')) {
        next.select();
      }
    } else {
      target.blur();
    }
  }

  // Grow or shrink a bundle's piece list to length `count`. Mirrors
  // setBundleCount but one level deeper. Keeps any metres the operator
  // already typed; new piece slots start blank. Lower bound is 1 so
  // an existing bundle never collapses to zero rows (the operator can
  // still delete the bundle itself by lowering "No. of bundles").
  function setPieceCount(itemIdx: number, bundleIdx: number, count: number): void {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => {
        if (i !== itemIdx) return it;
        return {
          ...it,
          bundles: it.bundles.map((b, j) => {
            if (j !== bundleIdx) return b;
            const target = Math.max(1, Math.min(count, 200));
            const cur = b.pieces;
            let next: Piece[];
            if (target > cur.length) {
              const grow: Piece[] = [];
              for (let k = cur.length; k < target; k++) grow.push('');
              next = [...cur, ...grow];
            } else if (target < cur.length) {
              next = cur.slice(0, target);
            } else {
              next = cur;
            }
            return { ...b, pieces: next };
          }),
        };
      }),
    }));
  }
  function addPiece(itemIdx: number, bundleIdx: number): void {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => {
        if (i !== itemIdx) return it;
        return {
          ...it,
          bundles: it.bundles.map((b, j) => (j === bundleIdx ? { ...b, pieces: [...b.pieces, ''] } : b)),
        };
      }),
    }));
  }
  function removePiece(itemIdx: number, bundleIdx: number, pieceIdx: number): void {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => {
        if (i !== itemIdx) return it;
        return {
          ...it,
          bundles: it.bundles.map((b, j) => {
            if (j !== bundleIdx) return b;
            const next = b.pieces.filter((_, k) => k !== pieceIdx);
            return { ...b, pieces: next.length === 0 ? [''] : next };
          }),
        };
      }),
    }));
  }

  // ---- DC-level totals snapshot ----
  const headerTotals = useMemo(() => {
    let metres = 0, pieces = 0, bundles = 0;
    for (const it of form.items) {
      const t = itemTotals(it, form.entry_mode);
      metres  += t.metres;
      pieces  += t.pieces;
      bundles += t.bundles;
    }
    return { metres, pieces, bundles };
  }, [form.items, form.entry_mode]);

  // ---- Save ----
  async function handleSave(): Promise<void> {
    setError(null);
    if (form.party_id === '') { setError('Pick a party.'); return; }
    if (!form.ship_to_same && form.ship_to_party_id === '') {
      setError('Pick a Ship-To party (or tick "Same as Bill-To").'); return;
    }
    if (form.vehicle_no.trim() === '') { setError('Vehicle number is required.'); return; }
    if (form.items.length === 0)       { setError('Add at least one item.'); return; }

    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const headerPayload = {
      dc_date: form.dc_date,
      status: form.status,
      production_mode: form.production_mode,
      entry_mode: form.entry_mode,
      party_id: Number(form.party_id),
      ship_to_same: form.ship_to_same,
      ship_to_party_id: form.ship_to_same ? null
        : (form.ship_to_party_id === '' ? null : Number(form.ship_to_party_id)),
      bill_to_name: form.bill_to_name || null,
      bill_to_address: form.bill_to_address || null,
      bill_to_gstin: form.bill_to_gstin || null,
      bill_to_state: form.bill_to_state || null,
      bill_to_state_code: form.bill_to_state_code || null,
      ship_to_name: form.ship_to_same ? form.bill_to_name : (form.ship_to_name || null),
      ship_to_address: form.ship_to_same ? form.bill_to_address : (form.ship_to_address || null),
      ship_to_gstin: form.ship_to_same ? form.bill_to_gstin : (form.ship_to_gstin || null),
      ship_to_state: form.ship_to_same ? form.bill_to_state : (form.ship_to_state || null),
      ship_to_state_code: form.ship_to_same ? form.bill_to_state_code : (form.ship_to_state_code || null),
      vehicle_no: form.vehicle_no.trim(),
      total_metres: headerTotals.metres,
      total_pieces: headerTotals.pieces,
      total_bundles: headerTotals.bundles,
      notes: form.notes || null,
    };

    let dcId: number;
    if (isEdit && form.id != null) {
      // On edit only, allow overriding the auto-generated DC code so the
      // user can correct a typo or re-align to a different series. On
      // create we always let fn_autogen_code assign it.
      const editPayload = {
        ...headerPayload,
        code: (form.code ?? '').trim() || null,
      };
      const { error: err } = await sb.from('delivery_challan').update(editPayload).eq('id', form.id);
      if (err) { setBusy(false); setError(err.message); return; }
      dcId = form.id;
      await sb.from('delivery_challan_item').delete().eq('dc_id', dcId);
    } else {
      // On create, jobwork + outsource DCs may set a custom code
      // (e.g. to match a paper book number). In-house DCs always use
      // the auto-generated DC/26-27/NNNN. Blank code falls through to
      // the autogen trigger (which picks DC / JDC / ODC by
      // production_mode — see migration 114b).
      const customCodeAllowed = form.production_mode === 'jobwork' || form.production_mode === 'outsource';
      const createPayload = customCodeAllowed && (form.code ?? '').trim() !== ''
        ? { ...headerPayload, code: (form.code ?? '').trim() }
        : headerPayload;
      const { data, error: err } = await sb.from('delivery_challan').insert(createPayload).select('id').single();
      if (err || !data?.id) { setBusy(false); setError(err?.message ?? 'Insert failed'); return; }
      dcId = data.id as number;
    }

    const itemsPayload = form.items.map((it) => {
      const t = itemTotals(it, form.entry_mode);
      // Summary mode stores an empty bundles_detail array - the print
      // template uses that as the signal to skip the bundle grid and
      // just show the totals row.
      const bundles_detail = form.entry_mode === 'summary'
        ? []
        : it.bundles.map((b) => ({
            sno: b.sno,
            pieces: b.pieces.map((p) => num(p)).filter((n) => n > 0),
          }));
      return {
        dc_id: dcId,
        sno: it.sno,
        fabric_quality_id: it.fabric_quality_id === '' ? null : Number(it.fabric_quality_id),
        description: it.description || null,
        hsn: it.hsn || null,
        metres: t.metres || null,
        pieces: t.pieces || null,
        bundles: t.bundles || null,
        bundles_detail,
      };
    });
    if (itemsPayload.length > 0) {
      const { error: itemErr } = await sb.from('delivery_challan_item').insert(itemsPayload);
      if (itemErr) { setBusy(false); setError(itemErr.message); return; }
    }
    setBusy(false);
    router.push('/app/delivery-challan');
    router.refresh();
  }

  return (
    <form className="card p-5 space-y-5 max-w-5xl" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
      {/* Header */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          {/*
            DC No is editable on:
              - any edit screen (fix typos / re-align series)
              - jobwork CREATE (so the operator can type a custom code
                that matches their paper book number)
            In-house CREATE stays locked - that's where strict sequential
            numbering matters most.
          */}
          {(() => {
            const canCustomise = form.production_mode === 'jobwork' || form.production_mode === 'outsource';
            const editable = isEdit || canCustomise;
            const hint = isEdit
              ? '(editable)'
              : (canCustomise ? '(optional - leave blank for auto)' : '');
            // Preview reads from doc_sequence (DC / JDC / ODC) so the
            // operator sees the actual next number, not a static
            // example. Falls back to the legacy stub if the load
            // hasn't completed.
            const fallbackStub = form.production_mode === 'jobwork'
              ? 'JDC/26-27/0001'
              : form.production_mode === 'outsource'
                ? 'ODC/26-27/0001'
                : 'DC/26-27/0001';
            const placeholder = nextDcCode || fallbackStub;
            return (
              <>
                <label className="label">
                  DC No {hint !== '' && <span className="text-[10px] text-ink-mute font-normal">{hint}</span>}
                </label>
                {editable ? (
                  <input
                    type="text"
                    className="input font-mono text-xs"
                    value={form.code ?? ''}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    placeholder={placeholder}
                    required={isEdit}
                  />
                ) : (
                  <div className="input bg-cloud/40 text-ink-mute font-mono text-xs">
                    {nextDcCode ? `Auto (${nextDcCode})` : 'Auto (assigned on save)'}
                  </div>
                )}
              </>
            );
          })()}
        </div>
        <div>
          <label className="label">DC Date *</label>
          <input type="date" className="input" required value={form.dc_date}
            onChange={(e) => setForm({ ...form, dc_date: e.target.value })} />
        </div>
        <div>
          <label className="label">
            Status
            <span className="text-[10px] text-ink-mute font-normal ml-2">(automatic)</span>
          </label>
          {/* Status is no longer hand-edited - it follows the workflow:
              new DC = draft → fabric receipt saved = confirmed → invoice
              raised = invoiced. The pill below mirrors what's stored. */}
          {(() => {
            const cls =
              form.status === 'invoiced'  ? 'bg-emerald-50 text-emerald-700'
              : form.status === 'confirmed' ? 'bg-amber-50 text-amber-700'
              : form.status === 'cancelled' ? 'bg-rose-50 text-rose-700'
              : 'bg-slate-100 text-slate-600';
            const label =
              form.status === 'invoiced'  ? 'Invoiced'
              : form.status === 'confirmed' ? 'Confirmed'
              : form.status === 'cancelled' ? 'Cancelled'
              : 'Draft';
            return (
              <div className="input bg-cloud/40 flex items-center">
                <span className={`pill ${cls} text-xs uppercase tracking-wide`}>{label}</span>
              </div>
            );
          })()}
        </div>
        <div className="col-span-2 md:col-span-1">
          <label className="label">Production Mode *</label>
          {/* Grid so the three buttons share the row width evenly on
              mobile instead of one overflowing off-screen. The parent
              cell spans both columns on mobile (col-span-2 in the
              grid-cols-2 viewport) so all three options fit on one line
              without truncating. */}
          <div className="grid grid-cols-3 gap-1.5">
            <button type="button"
              onClick={() => setForm({ ...form, production_mode: 'inhouse', party_id: '' })}
              className={'w-full px-2 py-2 rounded-lg text-xs font-semibold border whitespace-nowrap ' +
                (form.production_mode === 'inhouse'
                  ? 'border-transparent bg-indigo-600 text-white'
                  : 'border-line bg-white text-ink-soft hover:bg-haze/60')}>In-house</button>
            <button type="button"
              onClick={() => setForm({ ...form, production_mode: 'jobwork', party_id: '' })}
              className={'w-full px-2 py-2 rounded-lg text-xs font-semibold border whitespace-nowrap ' +
                (form.production_mode === 'jobwork'
                  ? 'border-transparent bg-indigo-600 text-white'
                  : 'border-line bg-white text-ink-soft hover:bg-haze/60')}>Job-work</button>
            <button type="button"
              onClick={() => setForm({ ...form, production_mode: 'outsource', party_id: '' })}
              className={'w-full px-2 py-2 rounded-lg text-xs font-semibold border whitespace-nowrap ' +
                (form.production_mode === 'outsource'
                  ? 'border-transparent bg-indigo-600 text-white'
                  : 'border-line bg-white text-ink-soft hover:bg-haze/60')}>Outsource</button>
          </div>
        </div>
      </div>

      {/* Entry mode toggle — controls whether items are captured as a
          full bundle/piece grid or as flat totals per quality. */}
      <div>
        <label className="label">
          Item Entry Mode
          <span className="text-[10px] text-ink-mute font-normal ml-2">
            {form.entry_mode === 'detailed'
              ? 'Capture every bundle and piece (default).'
              : 'Type total metres / pieces / bundles per fabric quality only.'}
          </span>
        </label>
        <div className="flex gap-1.5 max-w-md">
          <button type="button"
            onClick={() => setForm({ ...form, entry_mode: 'detailed' })}
            className={'flex-1 px-3 py-2 rounded-lg text-xs font-semibold border ' +
              (form.entry_mode === 'detailed'
                ? 'border-transparent bg-indigo-600 text-white'
                : 'border-line bg-white text-ink-soft hover:bg-haze/60')}>
            Detailed (bundle / piece)
          </button>
          <button type="button"
            onClick={() => setForm({ ...form, entry_mode: 'summary' })}
            className={'flex-1 px-3 py-2 rounded-lg text-xs font-semibold border ' +
              (form.entry_mode === 'summary'
                ? 'border-transparent bg-indigo-600 text-white'
                : 'border-line bg-white text-ink-soft hover:bg-haze/60')}>
            Summary (totals only)
          </button>
        </div>
      </div>

      {/* Vehicle number — mandatory. Backed by a native datalist of
          recently-used vehicle numbers from past DCs so the operator
          can pick a familiar truck instead of retyping it. Typing a
          new value still works (it'll auto-add itself to the list the
          next time the form is opened, since the suggestions are
          re-pulled from delivery_challan.vehicle_no on mount). */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="label">Vehicle Number *</label>
          <input className="input num uppercase" required placeholder="TN 38 AB 1234"
            list="dc-vehicle-history"
            autoComplete="off"
            value={form.vehicle_no}
            onChange={(e) => setForm({ ...form, vehicle_no: e.target.value.toUpperCase() })} />
          <datalist id="dc-vehicle-history">
            {vehicleSuggestions.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          {vehicleSuggestions.length > 0 && (
            <p className="text-[11px] text-ink-mute mt-1">
              Tip: start typing to pick from {vehicleSuggestions.length} recent vehicle number{vehicleSuggestions.length === 1 ? '' : 's'}.
            </p>
          )}
        </div>
      </div>

      {/* Party */}
      <div className="rounded-lg border border-line bg-cloud/20 p-4 space-y-3">
        <div>
          <label className="label">
            {form.production_mode === 'jobwork'   ? 'Jobwork Party *'
             : form.production_mode === 'outsource' ? 'Outsource party *'
             : 'Customer *'}
          </label>
          <select className="input w-full" required value={form.party_id}
            onChange={(e) => pickParty(e.target.value)}>
            <option value="">--- pick a {form.production_mode === 'jobwork' ? 'jobwork party' : form.production_mode === 'outsource' ? 'outsource party' : 'customer'} ---</option>
            {filteredParties.map((p) => (
              <option key={p.id} value={p.id}>{p.code} - {p.name}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="label text-xs">Bill-To Name</label>
            <input className="input" value={form.bill_to_name}
              onChange={(e) => setForm({ ...form, bill_to_name: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">Bill-To GSTIN</label>
            <input className="input num uppercase" value={form.bill_to_gstin}
              onChange={(e) => setForm({ ...form, bill_to_gstin: e.target.value.toUpperCase() })} />
          </div>
          <div className="md:col-span-2">
            <label className="label text-xs">Bill-To Address</label>
            <textarea className="input min-h-[60px]" value={form.bill_to_address}
              onChange={(e) => setForm({ ...form, bill_to_address: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">State</label>
            <input className="input" value={form.bill_to_state}
              onChange={(e) => setForm({ ...form, bill_to_state: e.target.value })} />
          </div>
          <div>
            <label className="label text-xs">State Code</label>
            <input className="input num" maxLength={2} value={form.bill_to_state_code}
              onChange={(e) => setForm({ ...form, bill_to_state_code: e.target.value })} />
          </div>
        </div>
      </div>

      {/* Ship-To */}
      <div className="rounded-lg border border-line bg-cloud/20 p-4 space-y-3">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={form.ship_to_same}
            onChange={(e) => setForm({ ...form, ship_to_same: e.target.checked })} />
          <span className="text-sm font-semibold">Ship-To same as Bill-To</span>
        </label>
        {!form.ship_to_same && (
          <>
            <div>
              <label className="label">Ship-To Party</label>
              <select className="input w-full" value={form.ship_to_party_id}
                onChange={(e) => pickShipToParty(e.target.value)}>
                <option value="">--- pick a shipping party ---</option>
                {allParties.map((p) => (
                  <option key={p.id} value={p.id}>{p.code} - {p.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="label text-xs">Ship-To Name</label>
                <input className="input" value={form.ship_to_name}
                  onChange={(e) => setForm({ ...form, ship_to_name: e.target.value })} />
              </div>
              <div>
                <label className="label text-xs">Ship-To GSTIN</label>
                <input className="input num uppercase" value={form.ship_to_gstin}
                  onChange={(e) => setForm({ ...form, ship_to_gstin: e.target.value.toUpperCase() })} />
              </div>
              <div className="md:col-span-2">
                <label className="label text-xs">Ship-To Address</label>
                <textarea className="input min-h-[60px]" value={form.ship_to_address}
                  onChange={(e) => setForm({ ...form, ship_to_address: e.target.value })} />
              </div>
              <div>
                <label className="label text-xs">State</label>
                <input className="input" value={form.ship_to_state}
                  onChange={(e) => setForm({ ...form, ship_to_state: e.target.value })} />
              </div>
              <div>
                <label className="label text-xs">State Code</label>
                <input className="input num" maxLength={2} value={form.ship_to_state_code}
                  onChange={(e) => setForm({ ...form, ship_to_state_code: e.target.value })} />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Items + bundles */}
      <div className="rounded-lg border border-line bg-paper">
        <div className="flex items-center justify-between p-3 border-b border-line/60">
          <h3 className="font-display font-bold text-sm">Items</h3>
          <button type="button" className="btn-ghost text-xs" onClick={addItem}>
            <Plus className="w-3.5 h-3.5" /> Add item
          </button>
        </div>
        {/* onKeyDown on the items container drives Enter-as-Tab navigation
            across every input/select inside (CORR-ext2). Textareas and
            buttons are skipped inside the handler. */}
        <div className="p-3 space-y-4" onKeyDown={handleItemsEnter}>
          {form.items.map((it, itemIdx) => {
            const tot = itemTotals(it, form.entry_mode);
            return (
              <div key={itemIdx} className="rounded-lg border border-line bg-cloud/10 p-3 space-y-3">
                {/* Item header row */}
                <div className="grid grid-cols-12 gap-2 items-start">
                  <div className="col-span-12 md:col-span-1 text-xs text-ink-mute pt-2">Item #{it.sno}</div>
                  <div className="col-span-12 md:col-span-4">
                    <label className="label text-[10px]">Fabric Quality</label>
                    <select className="input h-9 text-sm w-full"
                      value={it.fabric_quality_id}
                      onChange={(e) => pickFabric(itemIdx, e.target.value)}>
                      <option value="">--- pick ---</option>
                      {filteredQualities.map((q) => (
                        <option key={q.id} value={q.id}>{q.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-8 md:col-span-4">
                    <label className="label text-[10px]">Description</label>
                    <input className="input h-9 text-sm" value={it.description}
                      onChange={(e) => setItem(itemIdx, { description: e.target.value })} />
                  </div>
                  <div className="col-span-4 md:col-span-2">
                    <label className="label text-[10px]">HSN</label>
                    <input className="input h-9 text-sm num" value={it.hsn}
                      onChange={(e) => setItem(itemIdx, { hsn: e.target.value })} />
                  </div>
                  <div className="col-span-12 md:col-span-1 flex justify-end md:justify-center pt-5">
                    <button type="button"
                      onClick={() => removeItem(itemIdx)}
                      disabled={form.items.length === 1}
                      className="p-1.5 rounded hover:bg-rose-50 text-rose-600 disabled:opacity-40"
                      title={form.items.length === 1 ? 'At least one item is required' : 'Remove item'}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Summary mode: just three flat input fields per item.
                    Detailed mode (default) shows the bundle grid below. */}
                {form.entry_mode === 'summary' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-line/40 pt-3">
                    <div>
                      <label className="label text-[10px]">Total metres / towels</label>
                      <input type="number" step={0.01} min={0}
                        className="input h-9 text-sm num text-right"
                        placeholder="0.00"
                        value={it.summary_metres}
                        onChange={(e) => setForm({
                          ...form,
                          items: form.items.map((x, i) => i === itemIdx ? { ...x, summary_metres: e.target.value } : x),
                        })} />
                    </div>
                    <div>
                      <label className="label text-[10px]">Total pieces</label>
                      <input type="number" step={1} min={0}
                        className="input h-9 text-sm num text-right"
                        placeholder="0"
                        value={it.summary_pieces}
                        onChange={(e) => setForm({
                          ...form,
                          items: form.items.map((x, i) => i === itemIdx ? { ...x, summary_pieces: e.target.value } : x),
                        })} />
                    </div>
                    <div>
                      <label className="label text-[10px]">Total bundles</label>
                      <input type="number" step={1} min={0}
                        className="input h-9 text-sm num text-right"
                        placeholder="0"
                        value={it.summary_bundles}
                        onChange={(e) => setForm({
                          ...form,
                          items: form.items.map((x, i) => i === itemIdx ? { ...x, summary_bundles: e.target.value } : x),
                        })} />
                    </div>
                  </div>
                ) : (
                <>
                {/* Bundles count picker */}
                <div className="flex flex-wrap items-end gap-3 border-t border-line/40 pt-3">
                  <div>
                    <label className="label text-[10px]">No. of bundles</label>
                    <input type="number" min={0} max={200} step={1}
                      className="input h-9 text-sm num w-28 text-right"
                      value={it.bundles.length}
                      onChange={(e) => setBundleCount(itemIdx, Number(e.target.value) || 0)} />
                  </div>
                  <p className="text-[11px] text-ink-mute pb-2">
                    Type the bundle count, then inside each bundle type its piece count and fill the metres for each piece.
                  </p>
                </div>

                {/* Per-bundle piece-entry cards */}
                {it.bundles.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {it.bundles.map((b, bundleIdx) => {
                      const bMetres = bundleMetres(b);
                      const bPieces = b.pieces.filter((p) => num(p) > 0).length;
                      return (
                        <div key={bundleIdx} className="rounded-lg border border-line bg-white p-2.5">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-semibold text-ink-soft">Bundle #{b.sno}</span>
                            <span className="text-[10px] text-ink-mute">
                              {bPieces} pcs / {bMetres.toFixed(2)} m
                            </span>
                          </div>
                          {/* Pieces-count picker — same UX as the bundle count
                              picker above. Type N to spawn N empty piece rows. */}
                          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-line/60">
                            <label className="text-[10px] uppercase tracking-wide text-ink-mute">No. of pieces</label>
                            <input
                              type="number" min={1} max={200} step={1}
                              className="input h-7 text-xs num w-16 text-right"
                              value={b.pieces.length}
                              onChange={(e) => setPieceCount(itemIdx, bundleIdx, Number(e.target.value) || 1)}
                            />
                          </div>
                          <div className="space-y-1">
                            {b.pieces.map((p, pieceIdx) => (
                              <div key={pieceIdx} className="flex items-center gap-1">
                                <span className="text-[10px] text-ink-mute w-5 text-right">{pieceIdx + 1}.</span>
                                <input
                                  id={`dc-piece-${itemIdx}-${bundleIdx}-${pieceIdx}`}
                                  type="number" step={0.01} min={0}
                                  placeholder="metres"
                                  className="input h-8 text-xs num flex-1 text-right"
                                  value={p}
                                  onChange={(e) => setPiece(itemIdx, bundleIdx, pieceIdx, e.target.value)}
                                />
                                <button type="button"
                                  onClick={() => removePiece(itemIdx, bundleIdx, pieceIdx)}
                                  disabled={b.pieces.length === 1}
                                  className="text-rose-500 hover:text-rose-700 p-1 disabled:opacity-30"
                                  title="Remove piece">
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                          <button type="button"
                            onClick={() => addPiece(itemIdx, bundleIdx)}
                            className="mt-1.5 w-full text-[11px] text-indigo-700 hover:bg-indigo-50 py-1 rounded border border-dashed border-line">
                            + Add piece
                          </button>
                          <div className="mt-1.5 pt-1.5 border-t border-line/60 text-right text-[11px] font-semibold text-indigo-700">
                            Total: {bMetres.toFixed(2)} m
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                </>
                )}

                {/* Item totals (auto-snapshot) */}
                <div className="flex flex-wrap justify-end gap-4 border-t border-line/40 pt-2 text-xs">
                  <div>Total Metres: <span className="num font-bold text-indigo-700">{tot.metres.toFixed(2)} m</span></div>
                  <div>No. of Pcs: <span className="num font-bold">{tot.pieces}</span></div>
                  <div>No. of Bundles: <span className="num font-bold">{tot.bundles}</span></div>
                </div>
              </div>
            );
          })}
        </div>

        {/* DC-level totals */}
        <div className="border-t-2 border-line bg-cloud/40 px-3 py-3 flex flex-wrap justify-end gap-6 text-sm font-semibold">
          <div>DC Total Metres: <span className="num text-indigo-700">{headerTotals.metres.toFixed(2)} m</span></div>
          <div>DC Total Pcs: <span className="num">{headerTotals.pieces}</span></div>
          <div>DC Total Bundles: <span className="num">{headerTotals.bundles}</span></div>
        </div>
      </div>

      <div>
        <label className="label">Notes</label>
        <textarea className="input min-h-[60px]" value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm p-2">{error}</div>
      )}

      <div className="flex items-center gap-2 justify-end">
        <button type="button" className="btn-ghost" onClick={() => router.back()} disabled={busy}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {isEdit ? 'Save Changes' : 'Create DC'}
        </button>
      </div>
    </form>
  );
}
