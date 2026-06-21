'use client';
/**
 * EditInvoiceLines — full editor for the invoice_line rows of one
 * invoice. Replaces the old read-only table on /app/invoices/[id].
 *
 * Every line field is editable (description, HSN, UOM, qty, rate,
 * GST %). Taxable / CGST / SGST / IGST / total auto-recompute on
 * every keystroke from qty × rate × gst_rate_pct using the invoice's
 * is_interstate flag (CGST+SGST split, or IGST single). Auto-values
 * are overridable so the operator can plug in a custom round-off on
 * a specific line if needed.
 *
 * Save flow:
 *   - INSERT new lines, UPDATE changed lines, DELETE removed lines
 *   - Re-sum every remaining line into the invoice header columns
 *     (taxable_value, cgst_amount, sgst_amount, igst_amount,
 *      subtotal, gst_amount, round_off, total)
 *
 * Indian GST note: line-level edits on a finalised invoice are still
 * traceable because every change goes through the audit-log triggers
 * already on invoice / invoice_line. The header comment in the old
 * read-only screen warned about credit-note discipline — that
 * remains the operator's call, but the UI no longer blocks it.
 */
import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Plus, Trash2, Save, AlertTriangle } from 'lucide-react';

export interface InvoiceLineRow {
  /** id from DB; null means this is a new line not yet persisted. */
  id: number | null;
  description: string;
  hsn_sac: string;
  uom: string;
  quantity: string;       // strings to keep inputs controlled
  rate: string;
  gst_rate_pct: string;
  // Computed but overridable.
  taxable_amount: string;
  cgst_amount: string;
  sgst_amount: string;
  igst_amount: string;
  total_amount: string;
}

interface EditInvoiceLinesProps {
  invoiceId: number;
  invoiceNo: string;
  isInterstate: boolean;
  initialLines: InvoiceLineRow[];
  /** Flat "Other Charges" on the header, added to the grand total after
   *  tax. Preserved here so re-rolling the header from line totals
   *  doesn't drop it. */
  extraCharge?: number;
}

const UOM_OPTIONS: ReadonlyArray<string> = ['mtr', 'pcs', 'kg', 'set', 'bundle', 'roll', 'box'];

function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmt2(s: string): string {
  return num(s).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Compute taxable + cgst/sgst/igst + total from qty, rate, GST%, interstate. */
function computeLineTotals(
  quantity: string,
  rate: string,
  gstRatePct: string,
  interstate: boolean,
): { taxable: number; cgst: number; sgst: number; igst: number; total: number } {
  const qty   = num(quantity);
  const rt    = num(rate);
  const gPct  = num(gstRatePct);
  const taxable = round2(qty * rt);
  const gstAmt  = round2(taxable * gPct / 100);
  if (interstate) {
    return { taxable, cgst: 0, sgst: 0, igst: gstAmt, total: round2(taxable + gstAmt) };
  }
  const half = round2(gstAmt / 2);
  // Other half adjusts for paise drift so cgst+sgst == gstAmt exactly.
  const other = round2(gstAmt - half);
  return { taxable, cgst: half, sgst: other, igst: 0, total: round2(taxable + half + other) };
}

/** Make a fresh blank line — operator-visible defaults. */
function blankLine(): InvoiceLineRow {
  return {
    id: null,
    description: '',
    hsn_sac: '',
    uom: 'mtr',
    quantity: '',
    rate: '',
    gst_rate_pct: '5',
    taxable_amount: '0',
    cgst_amount: '0',
    sgst_amount: '0',
    igst_amount: '0',
    total_amount: '0',
  };
}

export function EditInvoiceLines({
  invoiceId,
  invoiceNo,
  isInterstate,
  initialLines,
  extraCharge = 0,
}: EditInvoiceLinesProps): React.ReactElement {
  const router   = useRouter();
  const supabase = createClient();

  // Capture the initial snapshot so we can diff for INSERT/UPDATE/DELETE.
  const [original] = useState<InvoiceLineRow[]>(initialLines);
  const [lines,    setLines]    = useState<InvoiceLineRow[]>(initialLines);
  const [busy,     setBusy]     = useState<boolean>(false);
  const [error,    setError]    = useState<string | null>(null);
  const [savedAt,  setSavedAt]  = useState<number | null>(null);

  /** Update one field on one line, recomputing money columns when the
   *  inputs that drive them change. */
  function patchLine(idx: number, patch: Partial<InvoiceLineRow>): void {
    setLines((arr) => {
      const next = arr.slice();
      const row  = { ...next[idx], ...patch } as InvoiceLineRow;
      // Recompute if any driver field changed AND the operator hasn't
      // explicitly overridden the totals in the same edit batch.
      const driverChanged =
        'quantity'     in patch ||
        'rate'         in patch ||
        'gst_rate_pct' in patch;
      const totalsOverridden =
        'taxable_amount' in patch ||
        'cgst_amount'    in patch ||
        'sgst_amount'    in patch ||
        'igst_amount'    in patch ||
        'total_amount'   in patch;
      if (driverChanged && !totalsOverridden) {
        const c = computeLineTotals(row.quantity, row.rate, row.gst_rate_pct, isInterstate);
        row.taxable_amount = String(c.taxable);
        row.cgst_amount    = String(c.cgst);
        row.sgst_amount    = String(c.sgst);
        row.igst_amount    = String(c.igst);
        row.total_amount   = String(c.total);
      }
      next[idx] = row;
      return next;
    });
  }

  function addRow(): void {
    setLines((arr) => [...arr, blankLine()]);
  }

  function removeRow(idx: number): void {
    setLines((arr) => arr.filter((_, i) => i !== idx));
  }

  // ── Totals across all current lines ──────────────────────────────
  const headerTotals = useMemo(() => {
    let taxable = 0, cgst = 0, sgst = 0, igst = 0, total = 0;
    for (const l of lines) {
      taxable += num(l.taxable_amount);
      cgst    += num(l.cgst_amount);
      sgst    += num(l.sgst_amount);
      igst    += num(l.igst_amount);
      total   += num(l.total_amount);
    }
    // Other Charges are flat and added AFTER tax — fold them into the
    // grand total so re-rolling the header from lines keeps them.
    const rawTotal = round2(taxable + cgst + sgst + igst + round2(extraCharge));
    const rounded  = Math.round(rawTotal);
    const roundOff = round2(rounded - rawTotal);
    return {
      taxable: round2(taxable),
      cgst:    round2(cgst),
      sgst:    round2(sgst),
      igst:    round2(igst),
      gstSum:  round2(cgst + sgst + igst),
      lineTotal: round2(total),
      rawTotal,
      rounded,
      roundOff,
    };
  }, [lines, extraCharge]);

  // ── Dirty diff: anything to INSERT / UPDATE / DELETE? ────────────
  const dirty = useMemo(() => {
    if (lines.length !== original.length) return true;
    const origById = new Map<number, InvoiceLineRow>();
    for (const o of original) if (o.id != null) origById.set(o.id, o);
    for (const l of lines) {
      if (l.id == null) return true;
      const o = origById.get(l.id);
      if (!o) return true;
      if (
        l.description    !== o.description ||
        l.hsn_sac        !== o.hsn_sac ||
        l.uom            !== o.uom ||
        num(l.quantity)       !== num(o.quantity) ||
        num(l.rate)           !== num(o.rate) ||
        num(l.gst_rate_pct)   !== num(o.gst_rate_pct) ||
        num(l.taxable_amount) !== num(o.taxable_amount) ||
        num(l.cgst_amount)    !== num(o.cgst_amount) ||
        num(l.sgst_amount)    !== num(o.sgst_amount) ||
        num(l.igst_amount)    !== num(o.igst_amount) ||
        num(l.total_amount)   !== num(o.total_amount)
      ) return true;
    }
    return false;
  }, [lines, original]);

  async function handleSave(): Promise<void> {
    setError(null);

    // Validation: every line needs a description and qty > 0
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l) continue;
      if (l.description.trim() === '') {
        setError(`Row ${i + 1}: description cannot be empty.`);
        return;
      }
      if (num(l.quantity) <= 0) {
        setError(`Row ${i + 1}: quantity must be greater than zero.`);
        return;
      }
      if (num(l.rate) < 0) {
        setError(`Row ${i + 1}: rate cannot be negative.`);
        return;
      }
    }
    if (lines.length === 0) {
      setError('At least one line item is required on an invoice.');
      return;
    }

    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // 1) DELETE removed lines (those in original but not in current).
    const currentIds = new Set(lines.map((l) => l.id).filter((id): id is number => id != null));
    const toDelete   = original
      .map((o) => o.id)
      .filter((id): id is number => id != null && !currentIds.has(id));
    if (toDelete.length > 0) {
      const { error: delErr } = await sb.from('invoice_line').delete().in('id', toDelete);
      if (delErr) { setBusy(false); setError(`Delete failed: ${delErr.message}`); return; }
    }

    // 2) UPDATE existing changed lines
    const origById = new Map<number, InvoiceLineRow>();
    for (const o of original) if (o.id != null) origById.set(o.id, o);

    for (const l of lines) {
      if (l.id == null) continue;
      const o = origById.get(l.id);
      if (!o) continue;
      const changed =
        l.description    !== o.description ||
        l.hsn_sac        !== o.hsn_sac ||
        l.uom            !== o.uom ||
        num(l.quantity)       !== num(o.quantity) ||
        num(l.rate)           !== num(o.rate) ||
        num(l.gst_rate_pct)   !== num(o.gst_rate_pct) ||
        num(l.taxable_amount) !== num(o.taxable_amount) ||
        num(l.cgst_amount)    !== num(o.cgst_amount) ||
        num(l.sgst_amount)    !== num(o.sgst_amount) ||
        num(l.igst_amount)    !== num(o.igst_amount) ||
        num(l.total_amount)   !== num(o.total_amount);
      if (!changed) continue;

      const payload = {
        description:    l.description.trim(),
        hsn_sac:        l.hsn_sac.trim() || null,
        uom:            l.uom || 'mtr',
        quantity:       round2(num(l.quantity)),
        rate:           round2(num(l.rate)),
        gst_rate_pct:   round2(num(l.gst_rate_pct)),
        taxable_amount: round2(num(l.taxable_amount)),
        cgst_amount:    round2(num(l.cgst_amount)),
        sgst_amount:    round2(num(l.sgst_amount)),
        igst_amount:    round2(num(l.igst_amount)),
        total_amount:   round2(num(l.total_amount)),
      };
      const { error: updErr } = await sb.from('invoice_line').update(payload).eq('id', l.id);
      if (updErr) { setBusy(false); setError(`Update row failed: ${updErr.message}`); return; }
    }

    // 3) INSERT new lines (id null)
    const toInsert = lines.filter((l) => l.id == null).map((l) => ({
      invoice_id:     invoiceId,
      description:    l.description.trim(),
      hsn_sac:        l.hsn_sac.trim() || null,
      uom:            l.uom || 'mtr',
      quantity:       round2(num(l.quantity)),
      rate:           round2(num(l.rate)),
      gst_rate_pct:   round2(num(l.gst_rate_pct)),
      taxable_amount: round2(num(l.taxable_amount)),
      cgst_amount:    round2(num(l.cgst_amount)),
      sgst_amount:    round2(num(l.sgst_amount)),
      igst_amount:    round2(num(l.igst_amount)),
      total_amount:   round2(num(l.total_amount)),
    }));
    if (toInsert.length > 0) {
      const { error: insErr } = await sb.from('invoice_line').insert(toInsert);
      if (insErr) { setBusy(false); setError(`Insert row failed: ${insErr.message}`); return; }
    }

    // 4) Roll up header from the current line totals so the invoice
    //    grand total matches what the operator sees here.
    const headerPayload = {
      taxable_value: headerTotals.taxable,
      cgst_amount:   headerTotals.cgst,
      sgst_amount:   headerTotals.sgst,
      igst_amount:   headerTotals.igst,
      round_off:     headerTotals.roundOff,
      total:         headerTotals.rounded,
      // Legacy columns kept aligned with the new GST block.
      subtotal:      headerTotals.taxable,
      gst_amount:    headerTotals.gstSum,
    };
    const { error: hdrErr } = await sb.from('invoice').update(headerPayload).eq('id', invoiceId);
    if (hdrErr) { setBusy(false); setError(`Header rollup failed: ${hdrErr.message}`); return; }

    setBusy(false);
    setSavedAt(Date.now());
    router.refresh();
  }

  return (
    <div className="card overflow-x-auto mb-4">
      <div className="px-4 py-3 border-b border-line/60 bg-cloud/40 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-display font-bold text-sm">Line items</h2>
          <p className="text-[11px] text-ink-mute">
            Editable. Qty × Rate × GST% drive taxable, CGST, SGST, IGST and total — overridable per line if you need to round a single row.
            {isInterstate ? ' Interstate (IGST).' : ' Intrastate (CGST + SGST).'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {savedAt !== null && !dirty && (
            <span className="text-xs text-emerald-700">Lines saved.</span>
          )}
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-xs text-ink-soft hover:bg-haze/60"
          >
            <Plus className="w-3 h-3" /> Add line
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy || !dirty}
            className="btn-primary text-xs disabled:opacity-50"
            title={dirty ? 'Save line changes + roll up header total' : 'No unsaved line changes'}
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save lines
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 text-xs text-err border-b border-line/40 flex items-center gap-1.5 bg-rose-50/40">
          <AlertTriangle className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      {lines.length === 0 ? (
        <div className="p-6 text-center text-ink-mute text-sm">
          No line items. Add one to start.
        </div>
      ) : (
        <table className="w-full text-xs min-w-[1100px]">
          <thead className="bg-cloud/30 text-[10px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left  px-2 py-2 w-[28%]">Description</th>
              <th className="text-left  px-2 py-2 w-[8%]">HSN</th>
              <th className="text-right px-2 py-2 w-[8%]">Qty</th>
              <th className="text-left  px-2 py-2 w-[7%]">UOM</th>
              <th className="text-right px-2 py-2 w-[8%]">Rate</th>
              <th className="text-right px-2 py-2 w-[6%]">GST %</th>
              <th className="text-right px-2 py-2 w-[9%]">Taxable</th>
              {isInterstate ? (
                <th className="text-right px-2 py-2 w-[9%]">IGST</th>
              ) : (
                <>
                  <th className="text-right px-2 py-2 w-[7%]">CGST</th>
                  <th className="text-right px-2 py-2 w-[7%]">SGST</th>
                </>
              )}
              <th className="text-right px-2 py-2 w-[10%]">Total</th>
              <th className="px-2 py-2 w-[40px]" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => (
              <tr key={l.id ?? `new-${idx}`} className="border-t border-line/40">
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    className="input h-8 text-xs w-full"
                    value={l.description}
                    onChange={(e) => patchLine(idx, { description: e.target.value })}
                    placeholder="Description"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    className="input h-8 text-xs w-full font-mono"
                    value={l.hsn_sac}
                    onChange={(e) => patchLine(idx, { hsn_sac: e.target.value })}
                    placeholder="HSN"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="input num h-8 text-xs w-full text-right"
                    value={l.quantity}
                    onChange={(e) => patchLine(idx, { quantity: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    className="input h-8 text-xs w-full"
                    value={l.uom}
                    onChange={(e) => patchLine(idx, { uom: e.target.value })}
                    list={`uom-options-${idx}`}
                  />
                  <datalist id={`uom-options-${idx}`}>
                    {UOM_OPTIONS.map((u) => <option key={u} value={u} />)}
                  </datalist>
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="input num h-8 text-xs w-full text-right"
                    value={l.rate}
                    onChange={(e) => patchLine(idx, { rate: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="input num h-8 text-xs w-full text-right"
                    value={l.gst_rate_pct}
                    onChange={(e) => patchLine(idx, { gst_rate_pct: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    step="0.01"
                    className="input num h-8 text-xs w-full text-right"
                    value={l.taxable_amount}
                    onChange={(e) => patchLine(idx, { taxable_amount: e.target.value })}
                  />
                </td>
                {isInterstate ? (
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      step="0.01"
                      className="input num h-8 text-xs w-full text-right"
                      value={l.igst_amount}
                      onChange={(e) => patchLine(idx, { igst_amount: e.target.value })}
                    />
                  </td>
                ) : (
                  <>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="0.01"
                        className="input num h-8 text-xs w-full text-right"
                        value={l.cgst_amount}
                        onChange={(e) => patchLine(idx, { cgst_amount: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="0.01"
                        className="input num h-8 text-xs w-full text-right"
                        value={l.sgst_amount}
                        onChange={(e) => patchLine(idx, { sgst_amount: e.target.value })}
                      />
                    </td>
                  </>
                )}
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    step="0.01"
                    className="input num h-8 text-xs w-full text-right font-semibold"
                    value={l.total_amount}
                    onChange={(e) => patchLine(idx, { total_amount: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    className="p-1 rounded text-rose-600 hover:bg-rose-50"
                    title="Remove this line"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-line bg-cloud/30 font-semibold">
            <tr>
              <td className="px-2 py-2" colSpan={6}>Totals (live)</td>
              <td className="px-2 py-2 text-right num">{headerTotals.taxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              {isInterstate ? (
                <td className="px-2 py-2 text-right num">{headerTotals.igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              ) : (
                <>
                  <td className="px-2 py-2 text-right num">{headerTotals.cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td className="px-2 py-2 text-right num">{headerTotals.sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                </>
              )}
              <td className="px-2 py-2 text-right num">{headerTotals.lineTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              <td className="px-2 py-2" />
            </tr>
            <tr className="text-[11px] text-ink-mute font-normal">
              <td className="px-2 py-1.5" colSpan={isInterstate ? 8 : 9}>
                Header on save: Total ₹{headerTotals.rounded.toLocaleString('en-IN')} (round-off ₹{fmt2(String(headerTotals.roundOff))})
                · Invoice {invoiceNo}
              </td>
              <td className="px-2 py-1.5" />
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
