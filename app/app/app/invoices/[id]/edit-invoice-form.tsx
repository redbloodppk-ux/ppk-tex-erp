'use client';
/**
 * Inline editor for an invoice's header-level fields. Line items aren't
 * edited here - changing a billed invoice's lines should mean cancelling
 * and re-issuing (correct paper trail under GST). We keep this lean:
 * invoice_date, due_date, status, notes.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Save } from 'lucide-react';

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
  invoice_date: string;
  due_date: string | null;
  status: Status;
  notes: string;
}

interface EditInvoiceFormProps {
  invoiceId: number;
  invoiceNo: string;
  initial: EditInvoiceInitial;
}

export function EditInvoiceForm({
  invoiceId,
  invoiceNo,
  initial,
}: EditInvoiceFormProps): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();

  const [invoiceDate, setInvoiceDate] = useState<string>(initial.invoice_date);
  const [dueDate, setDueDate]         = useState<string>(initial.due_date ?? '');
  const [status, setStatus]           = useState<Status>(initial.status);
  const [notes, setNotes]             = useState<string>(initial.notes);
  const [busy, setBusy]               = useState<boolean>(false);
  const [savedAt, setSavedAt]         = useState<number | null>(null);
  const [error, setError]             = useState<string | null>(null);

  const dirty =
    invoiceDate !== initial.invoice_date
    || dueDate !== (initial.due_date ?? '')
    || status !== initial.status
    || notes !== initial.notes;

  async function handleSave(): Promise<void> {
    setError(null);
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const payload = {
      invoice_date: invoiceDate,
      due_date: dueDate || null,
      status,
      notes: notes || null,
    };
    const { error: err } = await sb.from('invoice').update(payload).eq('id', invoiceId);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setSavedAt(Date.now());
    router.refresh();
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
        className="grid grid-cols-1 md:grid-cols-4 gap-3"
        onSubmit={(e) => { e.preventDefault(); void handleSave(); }}
      >
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
        <div>
          <label className="label">Due date</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="input"
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
        <div className="md:col-span-1 flex items-end">
          <button
            type="submit"
            disabled={busy || !dirty}
            className="btn-primary text-xs disabled:opacity-50"
            title={dirty ? 'Save changes' : 'No unsaved changes'}
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save changes
          </button>
        </div>
        <div className="md:col-span-4">
          <label className="label">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="input"
            placeholder={`Anything to record on ${invoiceNo}`}
          />
        </div>
      </form>
      {error && (
        <div className="mt-3 text-err text-xs">{error}</div>
      )}
    </div>
  );
}
