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
import { STREAM_META, streamsForDirection, type PartyStream } from '@/lib/party-streams';
import { loadPartyBills, allocationPayloads, type OpenBill } from '@/lib/party-bills';

interface PartyOpt { id: number; code: string | null; name: string }

/** One of a party's accounts with its current open balance. */
interface AccountBalance {
  stream: PartyStream;
  label: string;
  /** Always positive: how much is outstanding on this account. */
  balance: number;
  bills: number;
}

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
  // Uses the shared loader so this tab sees exactly what the Payments
  // page and the bill picker see. Before that existed, this tab was
  // missing party_opening_ledger and agent_commission entirely, which
  // understated any account holding an opening balance (Rs 21,177 across
  // 6 parties at the time of the 2026-08-20 audit).
  const loadAccounts = useCallback(async (): Promise<void> => {
    if (partyId === '') { setAccounts([]); setOpenBills([]); return; }
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const partyName = parties.find((p) => p.id === partyId)?.name ?? '';
    const { bills, error: loadErr } = await loadPartyBills(sb, Number(partyId), partyName);
    if (loadErr) { setError(loadErr); setLoading(false); return; }

    setOpenBills(bills);

    const acc = new Map<PartyStream, { balance: number; bills: number }>();
    for (const b of bills) {
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
      // FIFO across that account's own bills, oldest first.
      let remaining = amt;
      const allocs: Array<{ kind: OpenBill['kind']; id: number; amount: number }> = [];
      for (const b of openBills.filter((x) => x.stream === row.stream)) {
        if (remaining <= 0.005) break;
        const take = Math.round(Math.min(b.balance, remaining) * 100) / 100;
        if (take <= 0.005) continue;
        allocs.push({ kind: b.kind, id: b.id, amount: take });
        remaining = Math.round((remaining - take) * 100) / 100;
      }
      for (const { table, rows: payload } of allocationPayloads(row.id, allocs)) {
        const { error: aErr } = await sb.from(table).insert(payload);
        if (aErr) {
          setBusy(false);
          setError(`Contra saved as ${row.payment_no}, but allocating the ${STREAM_META[row.stream].label} side failed: ${aErr.message}`);
          await loadAccounts();
          return;
        }
      }
      if (remaining > 0.005) {
        setError(`\u20b9${fmtINR(remaining)} of the ${STREAM_META[row.stream].label} side could not be matched to a bill and is sitting on account.`);
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
