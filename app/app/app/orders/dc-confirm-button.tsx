'use client';
/**
 * Confirms a draft delivery_challan from the Sales Orders page. Flips
 * status 'draft' -> 'confirmed' so it can later be turned into an
 * invoice. Refreshes the page after.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, CheckCircle2 } from 'lucide-react';

interface DcConfirmButtonProps {
  dcId: number;
  dcCode: string;
}

export function DcConfirmButton({ dcId, dcCode }: DcConfirmButtonProps): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<boolean>(false);

  async function handleClick(): Promise<void> {
    const ok = window.confirm(`Confirm ${dcCode}? It will become ready for invoicing.`);
    if (!ok) return;
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error } = await sb.from('delivery_challan')
      .update({ status: 'confirmed' })
      .eq('id', dcId);
    setBusy(false);
    if (error) {
      window.alert('Confirm failed: ' + error.message);
      return;
    }
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50"
      title={`Confirm ${dcCode} for invoicing`}
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
      Confirm
    </button>
  );
}
