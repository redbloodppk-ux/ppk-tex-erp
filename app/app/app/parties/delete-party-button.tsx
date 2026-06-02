'use client';
/**
 * Inline delete control for the Parties list row.
 *
 * Tries a hard delete first. If Postgres rejects it because the party is
 * referenced elsewhere (bobbin.supplier_party_id, jobwork_*, ledger.party_id,
 * etc.) we offer to archive the party instead so it disappears from active
 * lists without losing the historical reference.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Trash2 } from 'lucide-react';

interface DeletePartyButtonProps {
  partyId: number;
  partyName: string;
}

export function DeletePartyButton({ partyId, partyName }: DeletePartyButtonProps): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<boolean>(false);

  async function handleClick(): Promise<void> {
    const ok = window.confirm(`Delete party "${partyName}"?\n\nIf it's referenced by orders / invoices / jobwork, the delete will be blocked and you'll be offered an archive instead.`);
    if (!ok) return;

    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error: delErr } = await sb.from('party').delete().eq('id', partyId);
    if (delErr) {
      const archive = window.confirm(`Hard delete failed (${delErr.message}).\n\nArchive "${partyName}" instead so it stops appearing in active lists?`);
      if (archive) {
        const { error: arcErr } = await sb.from('party').update({ status: 'archived' }).eq('id', partyId);
        if (arcErr) {
          window.alert('Archive failed: ' + arcErr.message);
        } else {
          router.refresh();
        }
      }
      setBusy(false);
      return;
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="p-1 rounded hover:bg-rose-50 text-rose-600 disabled:opacity-50"
      title={`Delete ${partyName}`}
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
    </button>
  );
}
