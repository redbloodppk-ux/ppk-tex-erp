'use client';
/**
 * E-waybill capture card.
 *
 * E-waybill is mandatory for movement of goods worth > Rs 50,000 under
 * Indian GST. Two paths to populate it:
 *
 *  1. MANUAL (today) - operator opens ewaybill.gov.in in a new tab,
 *     generates the EWB there, pastes the number + validity back here.
 *  2. API (later)    - call a GSP (Sandbox / Cygnet / ClearTax) directly
 *     from the Generate button. Stubbed out below with a clear note.
 *
 * The card has two states:
 *   - No EWB yet  -> shows the "Generate E-waybill" button + a manual
 *                    capture form below it.
 *   - EWB present -> shows the number + dates + a "Clear" link to undo.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Save, ExternalLink, Truck, AlertTriangle, X } from 'lucide-react';

interface EwaybillCardProps {
  invoiceId: number;
  invoiceNo: string;
  invoiceTotal: number;
  ewaybillNo: string | null;
  ewaybillDate: string | null;
  ewaybillValidTill: string | null;
  ewaybillNotes: string | null;
}

const EWB_PORTAL = 'https://ewaybill.gov.in';

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + d.getFullYear();
}

export function EwaybillCard({
  invoiceId,
  invoiceNo,
  invoiceTotal,
  ewaybillNo,
  ewaybillDate,
  ewaybillValidTill,
  ewaybillNotes,
}: EwaybillCardProps): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();

  const has = ewaybillNo !== null && ewaybillNo.trim() !== '';
  const [open, setOpen] = useState<boolean>(false);
  const [ebNo, setEbNo]   = useState<string>(ewaybillNo ?? '');
  const [ebDate, setEbDate] = useState<string>(ewaybillDate ?? todayISO());
  const [ebTill, setEbTill] = useState<string>(ewaybillValidTill ?? addDaysISO(todayISO(), 1));
  const [ebNotes, setEbNotes] = useState<string>(ewaybillNotes ?? '');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const requiresEwb = invoiceTotal > 50000;

  async function save(payload: {
    ewaybill_no: string | null;
    ewaybill_date: string | null;
    ewaybill_valid_till: string | null;
    ewaybill_notes: string | null;
  }): Promise<void> {
    setError(null);
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error: err } = await sb.from('invoice').update(payload).eq('id', invoiceId);
    setBusy(false);
    if (err) { setError(err.message); return; }
    setOpen(false);
    router.refresh();
  }

  async function handleSave(): Promise<void> {
    const trimmed = ebNo.trim();
    if (trimmed === '') { setError('Enter the e-waybill number.'); return; }
    await save({
      ewaybill_no: trimmed,
      ewaybill_date: ebDate || null,
      ewaybill_valid_till: ebTill || null,
      ewaybill_notes: ebNotes || null,
    });
  }

  async function handleClear(): Promise<void> {
    const ok = window.confirm(`Clear e-waybill ${ewaybillNo} from ${invoiceNo}?`);
    if (!ok) return;
    await save({
      ewaybill_no: null,
      ewaybill_date: null,
      ewaybill_valid_till: null,
      ewaybill_notes: null,
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // EWB present  -> show the captured data + Clear link
  // ──────────────────────────────────────────────────────────────────
  if (has) {
    return (
      <div className="card p-4 mb-4 border-l-4 border-l-emerald-500">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-display font-bold text-sm inline-flex items-center gap-2">
            <Truck className="w-4 h-4 text-emerald-700" /> E-waybill captured
          </h2>
          <button
            type="button"
            onClick={() => void handleClear()}
            disabled={busy}
            className="text-xs text-rose-700 hover:underline disabled:opacity-50 inline-flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Clear
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-mute">EWB no</div>
            <div className="num font-bold font-mono">{ewaybillNo}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-mute">Generated on</div>
            <div className="num font-bold">{fmtDate(ewaybillDate)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-mute">Valid till</div>
            <div className="num font-bold">{fmtDate(ewaybillValidTill)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-mute">Portal</div>
            <a
              href={EWB_PORTAL}
              target="_blank"
              rel="noopener noreferrer"
              className="num font-bold text-indigo hover:underline inline-flex items-center gap-1"
            >
              ewaybill.gov.in <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
        {ewaybillNotes && (
          <div className="mt-3 text-xs text-ink-soft border-t border-line/50 pt-2 whitespace-pre-line">
            {ewaybillNotes}
          </div>
        )}
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // No EWB yet -> show the Generate button + manual entry form
  // ──────────────────────────────────────────────────────────────────
  return (
    <div className={'card p-4 mb-4 border-l-4 ' + (requiresEwb ? 'border-l-amber-500' : 'border-l-line')}>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-display font-bold text-sm inline-flex items-center gap-2">
          <Truck className="w-4 h-4 text-ink-soft" /> E-waybill
          {requiresEwb && (
            <span className="pill bg-amber-50 text-amber-700 text-[10px] inline-flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Required (invoice &gt; Rs 50,000)
            </span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="btn-primary text-xs"
        >
          {open ? 'Cancel' : 'Generate E-waybill'}
        </button>
      </div>

      {!open && (
        <p className="text-xs text-ink-soft">
          E-waybill is generated on the government portal{' '}
          <a href={EWB_PORTAL} target="_blank" rel="noopener noreferrer" className="text-indigo hover:underline inline-flex items-center gap-1">
            ewaybill.gov.in <ExternalLink className="w-3 h-3" />
          </a>{' '}
          and then captured here. Click <b>Generate E-waybill</b> to open the capture form.
        </p>
      )}

      {open && (
        <form
          className="mt-2 space-y-3"
          onSubmit={(e) => { e.preventDefault(); void handleSave(); }}
        >
          <div className="rounded-md bg-cloud/40 border border-line p-3 text-xs text-ink-soft">
            <div className="font-semibold text-ink mb-1">How to generate</div>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>Open the e-waybill portal:&nbsp;
                <a href={EWB_PORTAL} target="_blank" rel="noopener noreferrer" className="text-indigo hover:underline inline-flex items-center gap-1">
                  ewaybill.gov.in <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>Generate a new e-waybill for invoice <b>{invoiceNo}</b>.</li>
              <li>Copy the 12-digit EWB number and validity, then paste below + Save.</li>
            </ol>
            <div className="mt-2 text-[11px] text-ink-mute italic">
              Direct API generation (without the portal step) needs GSP credentials -
              I&apos;ll wire that in once you pick a GSP (Sandbox, Cygnet, ClearTax).
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="label">EWB number <span className="text-rose-600">*</span></label>
              <input
                type="text"
                inputMode="numeric"
                value={ebNo}
                onChange={(e) => setEbNo(e.target.value)}
                placeholder="12 digits"
                className="input font-mono"
                required
              />
            </div>
            <div>
              <label className="label">Generated on</label>
              <input
                type="date"
                value={ebDate}
                onChange={(e) => setEbDate(e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="label">Valid till</label>
              <input
                type="date"
                value={ebTill}
                onChange={(e) => setEbTill(e.target.value)}
                className="input"
              />
            </div>
          </div>

          <div>
            <label className="label">Notes (optional)</label>
            <textarea
              value={ebNotes}
              onChange={(e) => setEbNotes(e.target.value)}
              rows={2}
              className="input"
              placeholder="Transporter, vehicle, anything to record"
            />
          </div>

          {error && (
            <div className="text-err text-xs flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> {error}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button type="submit" disabled={busy} className="btn-primary text-xs">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save e-waybill
            </button>
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary text-xs">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
