// /app/costing/[id] — edit an existing costing master row.
//
// Lets the operator tweak the saved figures (quality code, name, rate per
// metre, GSM, width, profit %, notes) and toggle Active vs Archived.
// Full recalculation lives on /app/costing/new — this page is for adjusting
// a saved snapshot, not re-running the entire calculator.

'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { Loader2, Save, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

interface EditCostingPageProps {
  params: Promise<{ id: string }>;
}

interface CostingRow {
  id: number;
  quality_code: string | null;
  quality_name: string | null;
  fabric_type: string | null;
  fabric_width_in: number | null;
  gsm: number | null;
  grams_per_m: number | null;
  pick_paise_market: number | null;
  status: string;
  approval_status: string;
  notes: string | null;
}

export default function EditCostingPage({ params }: EditCostingPageProps): React.ReactElement {
  const supabase = createClient();
  const router = useRouter();
  const [id, setId] = useState<number | null>(null);
  const [row, setRow] = useState<CostingRow | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // Editable fields
  const [qualityCode, setQualityCode] = useState('');
  const [qualityName, setQualityName] = useState('');
  const [finishedWidthIn, setFinishedWidthIn] = useState<number>(0);
  const [gsm, setGsm] = useState<number>(0);
  const [gramsPerM, setGramsPerM] = useState<number>(0);
  const [weavingPaise, setWeavingPaise] = useState<number>(0);
  const [notes, setNotes] = useState('');
  const [active, setActive] = useState<boolean>(true);

  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const p = await params;
      setId(Number(p.id));
    })();
  }, [params]);

  useEffect(() => {
    if (id == null) return;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data, error } = await sb
        .from('costing_master')
        .select('id, quality_code, quality_name, fabric_type, fabric_width_in, gsm, grams_per_m, pick_paise_market, status, approval_status, notes')
        .eq('id', id)
        .single();
      if (error) {
        setLoadErr(error.message);
        return;
      }
      const r = data as CostingRow;
      setRow(r);
      setQualityCode(r.quality_code ?? '');
      setQualityName(r.quality_name ?? '');
      setFinishedWidthIn(Number(r.fabric_width_in ?? 0));
      setGsm(Number(r.gsm ?? 0));
      setGramsPerM(Number(r.grams_per_m ?? 0));
      setWeavingPaise(Number(r.pick_paise_market ?? 0));
      setNotes(r.notes ?? '');
      setActive(r.status === 'active');
    })();
  }, [id, supabase]);

  async function handleSave(): Promise<void> {
    if (id == null) return;
    setSaveErr(null);
    setSaveOk(null);
    if (qualityCode.trim() === '') return setSaveErr('Quality code is required.');
    if (qualityName.trim() === '') return setSaveErr('Quality name is required.');

    setSaving(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error } = await sb
      .from('costing_master')
      .update({
        quality_code: qualityCode.trim(),
        quality_name: qualityName.trim(),
        fabric_width_in: finishedWidthIn,
        gsm: gsm,
        grams_per_m: gramsPerM,
        pick_paise_market: weavingPaise,
        notes: notes.trim() || null,
        status: active ? 'active' : 'archived',
      })
      .eq('id', id);
    setSaving(false);
    if (error) {
      setSaveErr(error.message);
      return;
    }
    setSaveOk('Saved.');
    setTimeout(() => {
      router.push('/app/costing');
      router.refresh();
    }, 600);
  }

  return (
    <div>
      <PageHeader
        title={row ? `Edit Costing - ${row.quality_code ?? row.id}` : 'Edit Costing'}
        subtitle="Adjust the saved costing snapshot. For a full recalc, create a new costing from the calculator."
        actions={
          <Link href="/app/costing" className="btn-ghost">
            <ArrowLeft className="w-4 h-4" /> Back to list
          </Link>
        }
      />

      {loadErr && (
        <div className="card p-4 text-sm text-err">{loadErr}</div>
      )}

      {row && (
        <div className="card p-5 space-y-4 max-w-2xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="label">Quality Code *</label>
              <input className="input num w-full" value={qualityCode}
                onChange={(e) => setQualityCode(e.target.value)} />
            </div>
            <div>
              <label className="label">Quality Name *</label>
              <input className="input w-full" value={qualityName}
                onChange={(e) => setQualityName(e.target.value)} />
            </div>
            <div>
              <label className="label">Fabric Type</label>
              <div className="input bg-cloud/40 text-ink-soft select-none capitalize">
                {row.fabric_type ?? '-'}
              </div>
            </div>
            <div>
              <label className="label">Finished width (in)</label>
              <input type="number" className="input num w-full" value={finishedWidthIn} step={0.5}
                onChange={(e) => setFinishedWidthIn(Number(e.target.value))} />
            </div>
            <div>
              <label className="label">GSM</label>
              <input type="number" className="input num w-full" value={gsm} step={0.5}
                onChange={(e) => setGsm(Number(e.target.value))} />
            </div>
            <div>
              <label className="label">Grams / metre</label>
              <input type="number" className="input num w-full" value={gramsPerM} step={0.5}
                onChange={(e) => setGramsPerM(Number(e.target.value))} />
            </div>
            <div>
              <label className="label">Weaving (paise / pick)</label>
              <input type="number" className="input num w-full" value={weavingPaise} step={0.5}
                onChange={(e) => setWeavingPaise(Number(e.target.value))} />
            </div>
            <div>
              <label className="label">Status</label>
              <label className="flex items-center gap-2 input cursor-pointer">
                <input type="checkbox" checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="w-4 h-4 accent-emerald-600" />
                <span className={active ? 'text-emerald-700 font-semibold text-sm' : 'text-ink-mute text-sm'}>
                  {active ? 'Active' : 'Inactive (archived)'}
                </span>
              </label>
            </div>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea className="input w-full min-h-[80px]" value={notes}
              onChange={(e) => setNotes(e.target.value)} />
          </div>

          {saveErr && <div className="p-3 rounded-lg bg-red-50 text-err text-sm">{saveErr}</div>}
          {saveOk  && <div className="p-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm">{saveOk}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <Link href="/app/costing" className="btn-ghost">Cancel</Link>
            <button type="button" disabled={saving} onClick={handleSave} className="btn-primary">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
