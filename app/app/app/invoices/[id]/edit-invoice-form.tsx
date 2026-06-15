'use client';
/**
 * Inline editor for an invoice's header-level fields.
 *
 * Editable here:
 *   - Invoice no / date / due date / status / notes
 *   - GST tax block: taxable value, CGST / SGST / IGST, round-off, total
 *   - Interstate toggle (controls CGST+SGST vs IGST display + visibility)
 *   - Recompute total = taxable + cgst + sgst + igst + round_off  (helper)
 *
 * Line items are edited in the separate EditInvoiceLines component
 * lower on the page. Saving lines there will rewrite this header's
 * GST block from the line totals, so manual edits here are for cases
 * where the operator wants to override the rollup (e.g. apply a
 * one-off discount or hard-code a round-off).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ShipToPicker, shipToPayload, EMPTY_SHIP_TO, type ShipToValue } from '@/app/components/ship-to-picker';
import { useColumnHistory } from '@/app/components/use-column-history';
import { Loader2, Save, Calculator } from 'lucide-react';

type Status = 'draft' | 'issued' | 'partial_paid' | 'paid' | 'overdue' | 'cancelled';

const STATUS_OPTIONS: ReadonlyArray<{ value: Status; label: string }> = [
  { value: 'draft',        label: 'Draft' },
  { value: 'issued',       label: 'Issued' },
  { value: 'partial_paid', label: 'Partial paid' },
  { value: 'paid',         label: 'Paid' },
  { value: 'overdue',      label: 'Overdue' },
  { value: 'cancelled',    label: 'Cancelled' },
];

export interface EditInvoiceInitial {
  invoice_no: string;
  invoice_date: string;
  due_date: string | null;
  status: Status;
  notes: string;
  vehicle_no: string;
  taxable_value: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  round_off: number;
  total: number;
  is_interstate: boolean;
  ship_to_party_id: number | null;
  ship_to_name: string | null;
  ship_to_address: string | null;
  ship_to_gstin: string | null;
  ship_to_state: string | null;
}

/** Back-compute the payment-term length in days from the stored due date. */
function daysBetweenISO(fromISO: string, toISO: string | null): string {
  if (!toISO) return '';
  const a = new Date(fromISO + 'T00:00:00').getTime();
  const b = new Date(toISO   + 'T00:00:00').getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return '';
  return String(Math.round((b - a) / 86400000));
}

/** Add N days to an ISO date and return the new ISO date (local time). */
function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + String(d.getFullYear()).slice(-2);
}

interface EditInvoiceFormProps {
  invoiceId: number;
  invoiceNo: string;
  /** Drives "should this field be visible?" decisions — credit notes
   *  hide Due-days + Vehicle number because they don't apply. */
  docType?: string;
  initial: EditInvoiceInitial;
}

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function EditInvoiceForm({
  invoiceId,
  invoiceNo: _initialNo,
  docType,
  initial,
}: EditInvoiceFormProps): React.ReactElement {
  // Credit notes don't carry Due-days or Vehicle number — they
  // adjust an existing balance rather than book a movement.
  const isCreditNote = docType === 'credit_note';
  const router = useRouter();
  const supabase = createClient();

  const [invoiceNo, setInvoiceNo]     = useState<string>(initial.invoice_no);
  const [invoiceDate, setInvoiceDate] = useState<string>(initial.invoice_date);
  const [dueDays, setDueDays]         = useState<string>(daysBetweenISO(initial.invoice_date, initial.due_date));
  const [status, setStatus]           = useState<Status>(initial.status);
  const [notes, setNotes]             = useState<string>(initial.notes);
  const [vehicleNo, setVehicleNo]     = useState<string>(initial.vehicle_no ?? '');
  // Historical picks for the type-ahead datalists on Vehicle / Notes.
  const vehicleHistory = useColumnHistory('invoice', 'vehicle_no', 100);
  const notesHistory   = useColumnHistory('invoice', 'notes',      50);
  const [shipTo, setShipTo]           = useState<ShipToValue>(
    initial.ship_to_name != null && initial.ship_to_name !== ''
      ? {
          enabled: true,
          party_id: initial.ship_to_party_id,
          name: initial.ship_to_name,
          address: initial.ship_to_address ?? '',
          gstin: initial.ship_to_gstin ?? '',
          state: initial.ship_to_state ?? '',
        }
      : EMPTY_SHIP_TO,
  );

  // Resolved due date = invoice_date + due_days, recomputed live so the
  // operator can see what gets saved.
  const dueDate: string = dueDays.trim() === ''
    ? ''
    : addDaysISO(invoiceDate, Number(dueDays) || 0);

  // GST block (all values stored as strings to keep the inputs controlled)
  const [taxable, setTaxable]         = useState<string>(String(initial.taxable_value ?? 0));
  const [cgst, setCgst]               = useState<string>(String(initial.cgst_amount ?? 0));
  const [sgst, setSgst]               = useState<string>(String(initial.sgst_amount ?? 0));
  const [igst, setIgst]               = useState<string>(String(initial.igst_amount ?? 0));
  const [roundOff, setRoundOff]       = useState<string>(String(initial.round_off ?? 0));
  const [total, setTotal]             = useState<string>(String(initial.total ?? 0));
  const [isInterstate, setIsInterstate] = useState<boolean>(initial.is_interstate);

  const [busy, setBusy]               = useState<boolean>(false);
  const [savedAt, setSavedAt]         = useState<number | null>(null);
  const [error, setError]             = useState<string | null>(null);

  const dirty =
    invoiceNo !== initial.invoice_no
    || invoiceDate !== initial.invoice_date
    || dueDate !== (initial.due_date ?? '')
    || status !== initial.status
    || notes !== initial.notes
    || vehicleNo !== (initial.vehicle_no ?? '')
    || num(taxable) !== initial.taxable_value
    || num(cgst)    !== initial.cgst_amount
    || num(sgst)    !== initial.sgst_amount
    || num(igst)    !== initial.igst_amount
    || num(roundOff) !== initial.round_off
    || num(total)   !== initial.total
    || isInterstate !== initial.is_interstate
    || (shipTo.enabled ? shipTo.name : '') !== (initial.ship_to_name ?? '');

  function recomputeTotal(): void {
    // Round the bill grand total to the nearest whole rupee and let
    // round_off absorb the paise swing. The operator can still
    // overwrite either field manually after this if a specific bill
    // really needs a non-rounded figure.
    const raw      = round2(num(taxable) + num(cgst) + num(sgst) + num(igst));
    const rounded  = Math.round(raw);
    const newRound = round2(rounded - raw);
    setRoundOff(String(newRound));
    setTotal(String(rounded));
  }

  async function handleSave(): Promise<void> {
    setError(null);
    const trimmedNo = invoiceNo.trim();
    if (trimmedNo === '') { setError('Invoice number cannot be empty.'); return; }

    if (trimmedNo !== initial.invoice_no) {
      const ok = window.confirm(
        `Change invoice number from "${initial.invoice_no}" to "${trimmedNo}"?\n\n` +
          `This is the customer-facing reference and may already be on ` +
          `printed copies / GST filings. Continue?`,
      );
      if (!ok) return;
    }

    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const taxableN = round2(num(taxable));
    const cgstN    = round2(num(cgst));
    const sgstN    = round2(num(sgst));
    const igstN    = round2(num(igst));
    const roundN   = round2(num(roundOff));
    const totalN   = round2(num(total));
    const gstSum   = round2(cgstN + sgstN + igstN);

    const payload = {
      invoice_no: trimmedNo,
      invoice_date: invoiceDate,
      // Credit notes never carry a due date / vehicle no — force
      // them to NULL on save regardless of any stale state value.
      due_date:    isCreditNote ? null : (dueDate || null),
      status,
      notes: notes || null,
      vehicle_no:  isCreditNote ? null : (vehicleNo.trim().toUpperCase() || null),
      // GST block
      taxable_value: taxableN,
      cgst_amount: cgstN,
      sgst_amount: sgstN,
      igst_amount: igstN,
      round_off: roundN,
      total: totalN,
      // Legacy columns we keep aligned so old views / xlsx exports still match
      subtotal: taxableN,
      gst_amount: gstSum,
      is_interstate: isInterstate,
      ...shipToPayload(shipTo),
    };
    const { error: err } = await sb.from('invoice').update(payload).eq('id', invoiceId);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setSavedAt(Date.now());
    // Saved — close the edit form and return to the page the operator
    // came from (invoice view / invoices list), refreshed so the edits
    // show immediately.
    router.back();
    router.refresh();
  }

  // Helper: when toggling interstate, also clear the side that no longer
  // applies so the user doesn't end up with both CGST+SGST AND IGST set.
  function toggleInterstate(next: boolean): void {
    setIsInterstate(next);
    if (next) {
      setCgst('0');
      setSgst('0');
    } else {
      setIgst('0');
    }
  }

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display font-bold text-sm">Edit invoice</h2>
        {savedAt !== null && !dirty && (
          <span className="text-xs text-emerald-700">Saved.</span>
        )}
      </div>

      <form
        className="space-y-4"
        onSubmit={(e) => { e.preventDefault(); void handleSave(); }}
      >
        {/* ───── Header fields ───── */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="label">Invoice no <span className="text-rose-600">*</span></label>
            <input
              type="text"
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
              className="input font-mono text-xs"
              required
            />
          </div>
          <div>
            <label className="label">Invoice date</label>
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className="input"
              required
            />
          </div>
          {/* Credit notes don't carry a due date. */}
          <div className={isCreditNote ? 'hidden' : ''}>
            <label className="label">
              Due days
              {dueDate !== '' && (
                <span className="text-[10px] text-ink-mute font-normal ml-2">
                  Due: {fmtDate(dueDate)}
                </span>
              )}
            </label>
            <input
              type="number"
              min={0}
              step={1}
              value={dueDays}
              onChange={(e) => setDueDays(e.target.value)}
              className="input num text-right"
              placeholder="15"
            />
          </div>
          <div>
            <label className="label">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as Status)}
              className="input"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ───── GST tax block ───── */}
        <div className="rounded-md border border-line/60 bg-cloud/30 p-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-xs uppercase tracking-wide text-ink-soft">GST tax</h3>
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-1.5 text-xs text-ink-soft cursor-pointer">
                <input
                  type="checkbox"
                  checked={isInterstate}
                  onChange={(e) => toggleInterstate(e.target.checked)}
                />
                Interstate (IGST)
              </label>
              <button
                type="button"
                onClick={recomputeTotal}
                className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-xs text-ink-soft hover:bg-haze/60"
                title="Round total to the nearest rupee. Sets round-off automatically."
              >
                <Calculator className="w-3 h-3" /> Recompute total
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <div>
              <label className="label">Taxable</label>
              <input type="number" step="0.01" value={taxable} onChange={(e) => setTaxable(e.target.value)} className="input num" />
            </div>
            {isInterstate ? (
              <>
                <div className="md:col-span-2">
                  <label className="label">IGST</label>
                  <input type="number" step="0.01" value={igst} onChange={(e) => setIgst(e.target.value)} className="input num" />
                </div>
                <div className="hidden md:block" />
              </>
            ) : (
              <>
                <div>
                  <label className="label">CGST</label>
                  <input type="number" step="0.01" value={cgst} onChange={(e) => setCgst(e.target.value)} className="input num" />
                </div>
                <div>
                  <label className="label">SGST</label>
                  <input type="number" step="0.01" value={sgst} onChange={(e) => setSgst(e.target.value)} className="input num" />
                </div>
              </>
            )}
            <div>
              <label className="label">Round-off</label>
              <input type="number" step="0.01" value={roundOff} onChange={(e) => setRoundOff(e.target.value)} className="input num" />
            </div>
            <div>
              <label className="label">Total <span className="text-rose-600">*</span></label>
              <input type="number" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} className="input num font-semibold" required />
            </div>
          </div>
        </div>

        {/* ───── Ship to (optional consignee) ───── */}
        <div className="border-t border-line/40 pt-4">
          <ShipToPicker value={shipTo} onChange={setShipTo} />
        </div>

        {/* ───── Vehicle + Notes ───── */}
        {/* Credit notes don't move goods — Vehicle number is hidden. */}
        {!isCreditNote && (
          <div>
            <label className="label">Vehicle number *</label>
            <input
              value={vehicleNo}
              onChange={(e) => setVehicleNo(e.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, ''))}
              className="input uppercase"
              placeholder="e.g. TN33 AB 1234"
              maxLength={20}
              required
              list="inv-edit-vehicle-history"
            />
            <datalist id="inv-edit-vehicle-history">
              {vehicleHistory.map((v) => <option key={v} value={v} />)}
            </datalist>
            <p className="text-[10px] text-ink-mute mt-1">
              Required on every invoice and printed on the bill. Past vehicles auto-suggest.
            </p>
          </div>
        )}
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <label className="label mb-0">Notes</label>
            {notesHistory.length > 0 && (
              <select
                className="text-[10px] border border-line rounded px-1.5 py-0.5 bg-paper text-ink-soft"
                value=""
                onChange={(e) => { if (e.target.value !== '') setNotes(e.target.value); }}
                title="Pick a recently-used note"
                data-disable-enter-nav="true"
              >
                <option value="">Recent notes…</option>
                {notesHistory.map((n) => (
                  <option key={n} value={n}>{n.length > 60 ? n.slice(0, 60) + '…' : n}</option>
                ))}
              </select>
            )}
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="input"
            placeholder={`Anything to record on ${invoiceNo}`}
          />
        </div>

        {/* ───── Save ───── */}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={busy || !dirty}
            className="btn-primary text-xs disabled:opacity-50"
            title={dirty ? 'Save changes' : 'No unsaved changes'}
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save changes
          </button>
          {!dirty && savedAt === null && (
            <span className="text-xs text-ink-mute">Change any field above to enable save.</span>
          )}
        </div>
      </form>

      {error && (
        <div className="mt-3 text-err text-xs">{error}</div>
      )}
    </div>
  );
}
