'use client';
/** Back / edit details / Download PDF / Print toolbar for the yarn
 *  transport copy. Hidden when printing (.no-print).
 *
 *  "Edit details" fills in what is often known only after saving: the
 *  vehicle number, the e-way bill (generated on the portal once the
 *  value is known) and the bag count. These are print-only fields — the
 *  stock movement itself is not touched. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Printer, ArrowLeft, Pencil, Loader2, AlertTriangle } from 'lucide-react';
import { DownloadPdfButton } from '@/app/components/download-pdf-button';
import { createClient } from '@/lib/supabase/client';

interface Props {
  id: number; filename: string;
  vehicleNo: string; ewayNo: string; ewayDate: string; bags: number; ewayNeeded: boolean;
}

export function TransferPrintActions({ id, filename, vehicleNo, ewayNo, ewayDate, bags, ewayNeeded }: Props): React.ReactElement {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [veh, setVeh] = useState(vehicleNo);
  const [ew, setEw] = useState(ewayNo);
  const [ewd, setEwd] = useState(ewayDate);
  const [bg, setBg] = useState(bags > 0 ? String(bags) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function handlePrint(): void {
    const original = document.title;
    document.title = filename;
    setTimeout(() => { window.print(); document.title = original; }, 50);
  }

  async function save(): Promise<void> {
    setBusy(true); setErr(null);
    const sb = createClient() as any;
    const { error } = await sb.from('yarn_transfer').update({
      vehicle_no: veh.trim().toUpperCase() || null,
      eway_bill_no: ew.trim() || null,
      eway_bill_date: ew.trim() ? (ewd || null) : null,
      bag_count: Math.max(0, Math.round(Number(bg || 0))),
    }).eq('id', id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setEditing(false);
    router.refresh();
  }

  const btn = 'inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60';
  return (
    <div className="no-print sticky top-0 z-10 bg-paper/95 backdrop-blur border-b border-line/60">
      <div className="px-4 py-2 flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => router.push('/app/yarn-transfer')} className={btn}>
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
        <button type="button" onClick={() => setEditing((v) => !v)} className={btn}>
          <Pencil className="w-3.5 h-3.5" /> Vehicle / e-way bill / bags
        </button>
        {ewayNeeded && !ewayNo && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
            <AlertTriangle className="w-3.5 h-3.5" /> Value above ₹1 lakh — e-way bill no not entered
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <DownloadPdfButton path={`/app/yarn-transfer/${id}/print`} filename={filename} />
          <button type="button" onClick={handlePrint}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo/90">
            <Printer className="w-3.5 h-3.5" /> Print
          </button>
        </div>
      </div>
      {editing && (
        <div className="px-4 pb-3 grid sm:grid-cols-5 gap-2 items-end">
          <div><label className="label">Vehicle no</label><input value={veh} onChange={(e) => setVeh(e.target.value)} className="input w-full uppercase" /></div>
          <div><label className="label">E-way bill no</label><input value={ew} onChange={(e) => setEw(e.target.value)} inputMode="numeric" className="input w-full num" /></div>
          <div><label className="label">E-way bill date</label><input type="date" value={ewd} onChange={(e) => setEwd(e.target.value)} className="input w-full" /></div>
          <div><label className="label">Bags</label><input type="number" min="0" step="1" value={bg} onChange={(e) => setBg(e.target.value)} className="input w-full num" /></div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy} onClick={() => void save()} className="btn-primary inline-flex items-center gap-1.5">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Save
            </button>
            {err && <span className="text-xs text-rose-600">{err}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
