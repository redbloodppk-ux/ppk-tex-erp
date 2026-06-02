'use client';
/**
 * Trash-icon button that deletes an invoice (header + lines) after a
 * typed-confirmation prompt. If the invoice is a jobwork bill that has
 * picked up any DCs (delivery_challan.invoice_id = this invoice), those
 * DCs are unlinked first and their status reverted to 'confirmed' so
 * they reappear in the unbilled list.
 *
 * Used from the invoice list row and from the invoice edit page header.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Trash2 } from 'lucide-react';

interface DeleteInvoiceButtonProps {
  invoiceId: number;
  invoiceNo: string;
  /** Whether to render as a small icon (list row) or a labelled button (detail page). */
  variant?: 'icon' | 'button';
  /** After delete, navigate here. Defaults to "/app/invoices". */
  redirectTo?: string;
}

export function DeleteInvoiceButton({
  invoiceId,
  invoiceNo,
  variant = 'icon',
  redirectTo = '/app/invoices',
}: DeleteInvoiceButtonProps): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<boolean>(false);

  async function handleClick(): Promise<void> {
    const typed = window.prompt(
      `Delete invoice ${invoiceNo}?\n\n` +
        'This permanently removes the invoice and all its lines. ' +
        'Any DCs linked to this invoice will be unlinked and re-marked confirmed.\n\n' +
        `Type the invoice number (${invoiceNo}) to confirm:`,
    );
    if (typed === null) return;
    if (typed.trim() !== invoiceNo) {
      window.alert('Confirmation does not match. Delete cancelled.');
      return;
    }

    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // 1. Unlink any DCs that referenced this invoice. We set the invoice_id
    //    back to NULL and bump status back to 'confirmed' so the DC shows
    //    up again in the unbilled list. If the DC was 'draft' we leave it,
    //    matching the "only confirmed DCs flow into billing" rule.
    const { error: dcErr } = await sb
      .from('delivery_challan')
      .update({ invoice_id: null, status: 'confirmed' })
      .eq('invoice_id', invoiceId);
    if (dcErr) {
      setBusy(false);
      window.alert('Could not unlink DCs: ' + dcErr.message);
      return;
    }

    // 2. Delete the invoice lines. Safe even if a FK CASCADE exists - the
    //    second delete just hits zero rows.
    const { error: lineErr } = await sb
      .from('invoice_line')
      .delete()
      .eq('invoice_id', invoiceId);
    if (lineErr) {
      setBusy(false);
      window.alert('Could not delete invoice lines: ' + lineErr.message);
      return;
    }

    // 3. Delete the invoice header.
    const { error: invErr } = await sb
      .from('invoice')
      .delete()
      .eq('id', invoiceId);
    if (invErr) {
      setBusy(false);
      window.alert('Could not delete invoice: ' + invErr.message);
      return;
    }

    setBusy(false);
    router.push(redirectTo);
    router.refresh();
  }

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={busy}
        title={`Delete ${invoiceNo}`}
        className="p-1 rounded hover:bg-rose-50 text-rose-700 inline-flex disabled:opacity-50"
      >
        {busy
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <Trash2 className="w-4 h-4" />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
      Delete invoice
    </button>
  );
}
