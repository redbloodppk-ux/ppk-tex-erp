'use client';
/**
 * ContraTab — record an agreed offset between two of a party's accounts.
 *
 * A party can trade with us in several capacities at once. BMPT TEXTILES
 * owes us on job work while we owe them for yarn. Usually those are
 * settled separately, but by agreement the two can be netted instead.
 *
 * NO CASH MOVES. A contra is stored as TWO linked payment rows:
 *
 *   row A   direction 'out'  stream = the payable account   (we owe less)
 *   row B   direction 'in'   stream = the receivable account (they owe less)
 *
 * Both carry the same contra_group_id, mode='contra', and NO
 * mode_ledger_id — so the bank book is untouched, while every existing
 * balance trigger keeps working exactly as it does for a normal payment.
 * Constraints in migration 255 enforce all of that at the database level.
 *
 * Each half IS allocated against that account's open bills, oldest
 * first. That matters: the statement and the account balances here are
 * built from BILL balances, so an unallocated contra would leave every
 * figure unchanged and the feature would look broken. Allocation is what
 * makes the offset real.
 *
 * general_purchase bills are excluded — they have no payment allocation
 * table, so they cannot be settled this way.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Save, ArrowLeftRight, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SearchSelect, type SearchSelectOption } from '@/app/components/search-select';
import {
  STREAM_META, streamForBillKind, streamsForDirection, type PartyStream,
} from '@/lib/party-streams';

interface PartyOpt { id: number; code: string | null; name: string }

/** An open bill that a contra half can be allocated against. */
interface OpenBill {
  /** Which allocation table this settles through. */
  kind: 'invoice' | 'yarn' | 'sizing' | 'bobbin' | 'fabric' | 'warp_beam';
  id: number;
  date: string;
  balance: number;
  stream: PartyStream;
}

/** One of a party's accounts with its current open balance. */
interface AccountBalance {
  stream: PartyStream;
  label: string;
  /** Always positive: how much is outstanding on this account. */
  balance: number;
  bills: number;
}

/** Allocation table + foreign-key column for each bill kind. */
const ALLOC_TABLE: Record<OpenBill['kind'], { table: string; col: string }> = {
  invoice:   { table: 'payment_allocation',            col: 'invoice_id' },
  yarn:      { table: 'payment_yarn_allocation',       col: 'yarn_lot_id' },
  sizing:    { table: 'payment_sizing_allocation',     col: 'sizing_job_id' },
  bobbin:    { table: 'payment_bobbin_allocation',     col: 'bobbin_purchase_id' },
  fabric:    { table: 'payment_fabric_allocation',     col: 'fabric_purchase_id' },
  warp_beam: { table: 'payment_warp_beam_allocation',  col: 'warp_beam_purchase_id' },
};

function fmtINR(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ContraTab(): React.ReactElement {
  const supabase = useMemo(() => createClient(), []);

  const [parties, setParties] = useState<PartyOpt[]>([]);
  const [partyId, setPartyId] = useState<number | ''>('');
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [openBills, setOpenBills] = useState<OpenBill[]>([]);
  const [loading, setLoading] = useState(false);

  const [fromStream, setFromStream] = useState<PartyStream | ''>('');
  const [toStream, setToStream] = useState<PartyStream | ''>('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // ── Party list ───────────────────────────────────────────────────
  useEffect(() => {
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data } = await sb.from('party')
        .select('id, code, name').eq('status', 'active').order('name');
      setParties((data ?? []) as PartyOpt[]);
    })();
  }, [supabase]);

  // ── Open bills per account for the picked party ──────────────────
  // Bill-level, not just totals: each contra half is allocated against
  // real bills oldest-first, which is what actually moves the balances.
  const loadAccounts = useCallback(async (): Promise<void> => {
    if (partyId === '') { setAccounts([]); setOpenBills([]); return; }
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const partyName = parties.find((p) => p.id === partyId)?.name ?? '';

    const [invRes, yarnRes, sizRes, bobRes, fabRes, wbRes] = await Promise.all([
      sb.from('invoice')
        .select('id, invoice_date, doc_type, balance')
        .ilike('party_name', partyName)
        .in('status', ['issued', 'partial_paid', 'overdue'])
        .not('doc_type', 'in', '(credit_note,debit_note)')
        .gt('balance', 0),
      sb.from('yarn_lot').select('id, received_date, total_amount, amount_paid')
        .eq('supplier_party_id', partyId),
      sb.from('sizing_job').select('id, bill_date, total_amount, amount_paid')
        .eq('party_id', partyId).not('bill_no', 'is', null),
      sb.from('bobbin_purchase').select('id, purchase_date, total_amount, amount_paid')
        .eq('vendor_id', partyId),
      sb.from('fabric_purchase').select('id, received_date, total_amount, amount_paid')
        .eq('supplier_party_id', partyId).eq('source', 'supplier').eq('status', 'active'),
      sb.from('inhouse_warp_beam_purchase').select('id, purchase_date, total_amount, amount_paid')
        .eq('supplier_party_id', partyId).eq('status', 'active'),
    ]);

    const found: OpenBill[] = [];
    for (const r of ((invRes?.data ?? []) as Array<{ id: number; invoice_date: string; doc_type: string; balance: number | string }>)) {
      const bal = Number(r.balance ?? 0);
      if (bal > 0.005) {
        found.push({ kind: 'invoice', id: r.id, date: r.invoice_date, balance: bal, stream: streamForBillKind(r.doc_type) });
      }
    }
    const purchaseSets: Array<[OpenBill['kind'], unknown[], string]> = [
      ['yarn',      (yarnRes?.data ?? []) as unknown[], 'received_date'],
      ['sizing',    (sizRes?.data  ?? []) as unknown[], 'bill_date'],
      ['bobbin',    (bobRes?.data  ?? []) as unknown[], 'purchase_date'],
      ['fabric',    (fabRes?.data  ?? []) as unknown[], 'received_date'],
      ['warp_beam', (wbRes?.data   ?? []) as unknown[], 'purchase_date'],
    ];
    for (const [kind, rows, dateCol] of purchaseSets) {
      for (const raw of rows) {
        const r = raw as Record<string, unknown>;
        const bal = Number(r.total_amount ?? 0) - Number(r.amount_paid ?? 0);
        if (bal > 0.005) {
          found.push({
            kind, id: Number(r.id), date: String(r[dateCol] ?? ''),
            balance: Math.round(bal * 100) / 100, stream: 'supplier',
          });
        }
      }
    }
    found.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.id - b.id);
    setOpenBills(found);

    const acc = new Map<PartyStream, { balance: number; bills: number }>();
    for (const b of found) {
      const cur = acc.get(b.stream) ?? { balance: 0, bills: 0 };
      cur.balance += b.balance; cur.bills += 1;
      acc.set(b.stream, cur);
    }
    setAccounts(Array.from(acc.entries()).map(([st, v]) => ({
      stream: st,
      label: STREAM_META[st].label,
      balance: Math.round(v.balance * 100) / 100,
      bills: v.bills,
    })));
    setLoading(false);
  }, [partyId, parties, supabase]);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);

  // Reset the account choices whenever the party changes.
  useEffect(() => { setFromStream(''); setToStream(''); setAmount(''); }, [partyId]);

  const payableAccounts    = accounts.filter((a) => streamsForDirection('out').includes(a.stream));
  const receivableAccounts = accounts.filter((a) => streamsForDirection('in').includes(a.stream));

  /** Most you can offset — neither side can be pushed past zero. */
  const maxOffset = useMemo(() => {
    const f = accounts.find((a) => a.stream === fromStream)?.balance ?? 0;
    const t = accounts.find((a) => a.stream === toStream)?.balance ?? 0;
    return Math.round(Math.min(f, t) * 100) / 100;
  }, [accounts, fromStream, toStream]);

  const amt = Number(amount);
  const amtValid = Number.isFinite(amt) && amt > 0;
  const overMax = amtValid && maxOffset > 0 && amt > maxOffset + 0.005;
  const canSave = partyId !== '' && fromStream !== '' && toStream !== '' && amtValid && !overMax && !busy;

  async function save(): Promise<void> {
    setError(null); setSavedMsg(null);
    if (!canSave) return;
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const groupId = (globalThis.crypto?.randomUUID?.() ?? '');
    if (!groupId) { setBusy(false); setError('Could not generate a contra reference in this browser.'); return; }

    const base = {
      party_id: Number(partyId),
      payment_date: date,
      amount: amt,
      mode: 'contra',
      mode_ledger_id: null,   // a contra never touches the bank book
      contra_group_id: groupId,
      notes: notes.trim() || `Contra: ${STREAM_META[fromStream as PartyStream].label} against ${STREAM_META[toStream as PartyStream].label}`,
    };

    const { data, error: err } = await sb.from('payment').insert([
      { ...base, direction: 'out', stream: fromStream },  // we owe them less
      { ...base, direction: 'in',  stream: toStream   },  // they owe us less
    ]).select('id, payment_no, stream');

    if (err) { setBusy(false); setError(err.message); return; }

    // Allocate each half against its own account's bills, oldest first.
    // Without this the bill balances never move and the offset would be
    // invisible on the statement.
    const rows = (data ?? []) as Array<{ id: number; payment_no: string; stream: PartyStream }>;
    for (const row of rows) {
      let remaining = amt;
      const queue = openBills.filter((b) => b.stream === row.stream);
      const byTable = new Map<string, Array<Record<string, number>>>();
      for (const b of queue) {
        if (remaining <= 0.005) break;
        const take = Math.round(Math.min(b.balance, remaining) * 100) / 100;
        if (take <= 0.005) continue;
        const { table, col } = ALLOC_TABLE[b.kind];
        const list = byTable.get(table) ?? [];
        list.push({ payment_id: row.id, [col]: b.id, amount: take });
        byTable.set(table, list);
        remaining = Math.round((remaining - take) * 100) / 100;
      }
      for (const [table, payload] of byTable.entries()) {
        const { error: aErr } = await sb.from(table).insert(payload);
        if (aErr) {
          setBusy(false);
          setError(`Contra saved as ${row.payment_no}, but allocating the ${STREAM_META[row.stream].label} side failed: ${aErr.message}`);
          await loadAccounts();
          return;
        }
      }
      if (remaining > 0.005) {
        // Shouldn't happen — the amount is capped at the smaller balance —
        // but say so rather than leaving a silent part-allocated contra.
        setError(`₹${fmtINR(remaining)} of the ${STREAM_META[row.stream].label} side could not be matched to a bill and is sitting on account.`);
      }
    }

    const nos = rows.map((r) => r.payment_no).join(' + ');
    setSavedMsg(`Contra recorded (${nos}). ₹${fmtINR(amt)} offset — no money moved.`);
    setAmount(''); setNotes('');
    setBusy(false);
    await loadAccounts();
  }

  const partyOptions: SearchSelectOption[] = parties.map((p) => ({
    value: String(p.id),
    label: p.code ? `${p.name} (${p.code})` : p.name,
  }));

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="rounded-md border border-line/60 bg-cloud/20 p-3 text-xs text-ink-soft flex gap-2">
        <ArrowLeftRight className="w-4 h-4 shrink-0 mt-0.5 text-indigo-600" />
        <div>
          Offsets what a party owes you against what you owe them, by agreement.
          <strong className="text-ink"> No money moves</strong> — nothing is posted to any bank or
          cash ledger. Both accounts are reduced by the same amount and the
          two halves stay linked, so the offset is visible on the statement.
        </div>
      </div>

      <div>
        <label className="label">Party *</label>
        <SearchSelect
          options={partyOptions}
          value={partyId === '' ? '' : String(partyId)}
          onChange={(v) => setPartyId(v === '' ? '' : Number(v))}
          placeholder="Search party…"
        />
      </div>

      {partyId !== '' && (
        loading ? (
          <div className="flex items-center gap-2 text-sm text-ink-mute">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading accounts…
          </div>
        ) : accounts.length < 2 ? (
          <div className="rounded-md border border-line/60 p-4 text-sm text-ink-soft">
            This party has open balances on {accounts.length === 1 ? 'only one account' : 'no accounts'},
            so there is nothing to offset. A contra needs one account where they owe you and one where you owe them.
          </div>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Reduce what WE owe (payable) *</label>
                {payableAccounts.length === 0 ? (
                  <div className="text-xs text-ink-mute py-2">No payable account with an open balance.</div>
                ) : payableAccounts.map((a) => (
                  <button
                    key={a.stream}
                    type="button"
                    onClick={() => setFromStream(a.stream)}
                    className={cn(
                      'w-full text-left px-3 py-2 rounded border mb-1.5 transition',
                      a.stream === fromStream
                        ? 'bg-rose-50 border-rose-400'
                        : 'bg-white border-line hover:border-rose-300',
                    )}
                  >
                    <div className="text-sm font-semibold">{a.label}</div>
                    <div className="text-xs num text-rose-700">₹ {fmtINR(a.balance)} owed by us</div>
                  </button>
                ))}
              </div>

              <div>
                <label className="label">Reduce what THEY owe (receivable) *</label>
                {receivableAccounts.length === 0 ? (
                  <div className="text-xs text-ink-mute py-2">No receivable account with an open balance.</div>
                ) : receivableAccounts.map((a) => (
                  <button
                    key={a.stream}
                    type="button"
                    onClick={() => setToStream(a.stream)}
                    className={cn(
                      'w-full text-left px-3 py-2 rounded border mb-1.5 transition',
                      a.stream === toStream
                        ? 'bg-emerald-50 border-emerald-400'
                        : 'bg-white border-line hover:border-emerald-300',
                    )}
                  >
                    <div className="text-sm font-semibold">{a.label}</div>
                    <div className="text-xs num text-emerald-700">₹ {fmtINR(a.balance)} owed to us</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label className="label">Offset amount *</label>
                <input
                  className="input num"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
                {fromStream !== '' && toStream !== '' && (
                  <button
                    type="button"
                    className="text-[11px] text-indigo font-semibold mt-1"
                    onClick={() => setAmount(String(maxOffset))}
                  >
                    Use maximum ₹{fmtINR(maxOffset)}
                  </button>
                )}
                {overMax && (
                  <div className="text-[11px] text-rose-700 mt-1">
                    More than the smaller of the two balances (₹{fmtINR(maxOffset)}) — that would push one account past zero.
                  </div>
                )}
              </div>
              <div>
                <label className="label">Date *</label>
                <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <label className="label">Notes</label>
                <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Agreed with…" />
              </div>
            </div>

            {fromStream !== '' && toStream !== '' && amtValid && !overMax && (
              <div className="rounded-md border border-indigo-300 bg-indigo-50/50 p-3 text-sm">
                <div className="font-semibold text-indigo-900 mb-1">What this will record</div>
                <div className="text-xs text-ink-soft">
                  {STREAM_META[fromStream].label} — we owe ₹{fmtINR(amt)} less ·{' '}
                  {STREAM_META[toStream].label} — they owe ₹{fmtINR(amt)} less · bank and cash untouched
                </div>
              </div>
            )}

            {error && <div className="text-sm text-rose-700">{error}</div>}
            {savedMsg && (
              <div className="text-sm text-emerald-700 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> {savedMsg}
              </div>
            )}

            <div className="flex justify-end">
              <button type="button" className="btn-primary" disabled={!canSave} onClick={() => void save()}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Record Contra
              </button>
            </div>
          </>
        )
      )}
    </div>
  );
}
