'use client';
/**
 * AdvanceAllocationBox — shown on bill-creation screens. If the selected
 * party has leftover advance money (paid in before, not yet matched to
 * any bill), this renders an alert and lets the operator pick how much
 * of it to apply to the bill they're creating right now — so nobody has
 * to remember an old advance exists; the app surfaces it automatically.
 *
 * This component only reads data and reports the operator's choice via
 * onAllocationsChange. It never writes to the database — the parent
 * form creates the bill first (so it has a bill id), then calls
 * applyAdvanceAllocations (from '@/lib/party-advance') with whatever
 * this component last reported, using the allocation table + FK column
 * name that matches that form's bill type.
 *
 * Renders nothing (`null`) if the party has no unallocated advance, so
 * it adds zero visual noise for the common case.
 */
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getPartyAdvance, type PartyAdvancePayment } from '@/lib/party-advance';
import { formatRupee } from '@/lib/utils';

export interface AdvanceAllocationBoxProps {
  /** Party the new bill is being raised for. Null/'' clears the box. */
  partyId: number | string | null;
  /** The new bill's total amount — used to default-fill how much advance to apply. */
  billAmount: number;
  /** Fires whenever the chosen allocation changes, with the final list to insert. */
  onAllocationsChange: (allocations: Array<{ paymentId: number; amount: number }>) => void;
  /**
   * 'in' (default) = look for money the party paid US in advance —
   * use on receivable-side bills (Jobwork Bill, Sales Invoice).
   * 'out' = look for money WE paid the party in advance — use on
   * payable-side bills (Sizing, Bobbin/Yarn/Fabric/Warp Beam Purchase).
   */
  direction?: 'in' | 'out';
}

export function AdvanceAllocationBox({ partyId, billAmount, onAllocationsChange, direction = 'in' }: AdvanceAllocationBoxProps) {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(false);
  const [payments, setPayments] = useState<PartyAdvancePayment[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [amounts, setAmounts] = useState<Record<number, number>>({});

  const numericPartyId = partyId === '' || partyId === null || partyId === undefined
    ? null
    : Number(partyId);

  // Load the party's advance whenever the selected party changes.
  useEffect(() => {
    if (numericPartyId == null || Number.isNaN(numericPartyId)) {
      setPayments([]);
      setAmounts({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    getPartyAdvance(supabase, numericPartyId, direction).then((res) => {
      if (cancelled) return;
      setPayments(res.payments);
      setEnabled(true);
      setLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericPartyId, direction]);

  // Default-fill amounts: spread the bill amount across advances,
  // oldest first, capped by each payment's own unallocated balance and
  // by the bill's total. The operator can override any of these.
  useEffect(() => {
    if (payments.length === 0) { setAmounts({}); return; }
    let remaining = Math.max(0, Number(billAmount) || 0);
    const next: Record<number, number> = {};
    for (const p of payments) {
      const take = Math.min(p.unallocated, remaining);
      next[p.id] = Math.round(take * 100) / 100;
      remaining -= take;
    }
    setAmounts(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments, billAmount]);

  // Report the current selection up to the parent form whenever it changes.
  useEffect(() => {
    if (!enabled) { onAllocationsChange([]); return; }
    const list = payments
      .map((p) => ({ paymentId: p.id, amount: Number(amounts[p.id] ?? 0) }))
      .filter((a) => a.amount > 0.005);
    onAllocationsChange(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, amounts, payments]);

  if (loading || payments.length === 0) return null;

  const totalAdvance = payments.reduce((s, p) => s + p.unallocated, 0);
  const totalApplied = enabled
    ? payments.reduce((s, p) => s + Number(amounts[p.id] ?? 0), 0)
    : 0;

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span>
          <span className="font-medium text-amber-900">
            {direction === 'out'
              ? `You have ${formatRupee(totalAdvance)} in unused advance paid to this party.`
              : `This party has ${formatRupee(totalAdvance)} in unused advance.`}
          </span>{' '}
          <span className="text-amber-800">Apply it to this bill?</span>
        </span>
      </label>

      {enabled && (
        <div className="mt-2 space-y-1.5 pl-6">
          {payments.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2">
              <span className="text-amber-800">
                {p.paymentDate} — advance {formatRupee(p.unallocated)} available
              </span>
              <input
                type="number"
                min={0}
                max={p.unallocated}
                step="0.01"
                value={amounts[p.id] ?? 0}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(p.unallocated, Number(e.target.value) || 0));
                  setAmounts((prev) => ({ ...prev, [p.id]: v }));
                }}
                className="w-28 rounded border border-amber-300 px-2 py-1 text-right"
              />
            </div>
          ))}
          <div className="pt-1 text-xs text-amber-700">
            Applying {formatRupee(totalApplied)} of {formatRupee(totalAdvance)} available.
          </div>
        </div>
      )}
    </div>
  );
}
