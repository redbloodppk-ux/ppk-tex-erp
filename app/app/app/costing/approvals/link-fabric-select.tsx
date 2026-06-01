'use client';
// LinkFabricSelect — only shown for approved costings.
//
// Lists every fabric_quality master row and lets the owner pick one to
// link to this costing. On change, fabric_quality.costing_id is set to
// the current costing id (and the previously linked fabric, if any, is
// unlinked so each costing has a single linked fabric).
//
// Selecting "(none)" unlinks the costing from any fabric.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ExternalLink, Loader2 } from 'lucide-react';

export interface FabricOption {
  id: number;
  code: string | null;
  name: string;
}

interface LinkFabricSelectProps {
  costingId: number;
  fabrics: FabricOption[];
  /** id of fabric_quality currently linked to this costing, if any. */
  linkedFabricId: number | null;
}

export function LinkFabricSelect({ costingId, fabrics, linkedFabricId }: LinkFabricSelectProps): React.ReactElement {
  const supabase = createClient();
  const router = useRouter();
  const [value, setValue] = useState<string>(linkedFabricId != null ? String(linkedFabricId) : '');
  const [busy, setBusy] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);

  async function onChange(next: string): Promise<void> {
    setErr(null);
    const prev = value;
    setValue(next);
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // Unlink any fabric currently pointing at this costing.
    const unlink = await sb
      .from('fabric_quality')
      .update({ costing_id: null })
      .eq('costing_id', costingId);
    if (unlink.error) {
      setBusy(false);
      setValue(prev);
      setErr(unlink.error.message);
      return;
    }

    if (next !== '') {
      const link = await sb
        .from('fabric_quality')
        .update({ costing_id: costingId })
        .eq('id', Number(next));
      if (link.error) {
        setBusy(false);
        setValue(prev);
        setErr(link.error.message);
        return;
      }
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="inline-flex items-center gap-2 max-w-full" title={err ?? undefined}>
      <select
        value={value}
        disabled={busy}
        onChange={(e) => onChange(e.target.value)}
        className="input h-9 text-sm px-2 pr-7 min-w-[220px] max-w-[320px] truncate"
      >
        <option value="">— link a fabric —</option>
        {fabrics.map((f) => (
          <option key={f.id} value={String(f.id)}>
            {f.code ? `${f.code} - ` : ''}{f.name}
          </option>
        ))}
      </select>
      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-ink-mute shrink-0" />}
      {value !== '' && !busy && (
        <Link
          href={`/app/settings/fabric-qualities/${value}`}
          className="inline-flex items-center text-xs text-indigo-700 hover:text-indigo-900 shrink-0"
          title="Open this fabric quality"
        >
          <ExternalLink className="w-4 h-4" />
        </Link>
      )}
    </div>
  );
}
