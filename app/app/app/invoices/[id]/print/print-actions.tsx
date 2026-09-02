'use client';
/**
 * Print / Save-PDF / Back toolbar that hangs at the top of every invoice
 * print page. The toolbar is hidden when the page is printing (via the
 * @media print CSS in the parent page). Same UX as the DC print toolbar
 * so the muscle memory carries over.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Printer, ArrowLeft, Loader2 } from 'lucide-react';
import { DownloadPdfButton } from '@/app/components/download-pdf-button';

interface InvoicePrintActionsProps {
  invoiceId: number;
  invoiceNo: string;
  /** Bill-to party name — part of the saved PDF filename. */
  partyName?: string | null;
  /** Invoice date (YYYY-MM-DD) — part of the saved PDF filename. */
  invoiceDate?: string | null;
}

export function InvoicePrintActions({
  invoiceId,
  invoiceNo,
  partyName,
  invoiceDate,
}: InvoicePrintActionsProps): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState<'print' | 'pdf' | null>(null);

  function safeFilename(code: string): string {
    return code.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
  }

  /** PDF filename = "PARTY NAME INV-NO DD-MM-YYYY". */
  function pdfFilename(): string {
    const parts: string[] = [];
    if (partyName && partyName.trim() !== '') parts.push(partyName.trim());
    parts.push(invoiceNo);
    if (invoiceDate) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(invoiceDate);
      parts.push(m ? `${m[3]}-${m[2]}-${m[1]}` : invoiceDate);
    }
    return safeFilename(parts.join(' '));
  }

  function handlePrint(): void {
    const ok = window.confirm(
      `Send ${invoiceNo} to the printer?\n\n` +
        `When the print dialog opens, pick your printer and click Print. ` +
        `If no printer shows up, set one up on this computer first.`,
    );
    if (!ok) return;
    setBusy('print');
    const originalTitle = document.title;
    // Same title as Download PDF — if the user picks "Save as PDF"
    // inside the print dialog, the filename is still
    // "PARTY NAME INV-NO DD-MM-YYYY.pdf".
    document.title = pdfFilename();
    setTimeout(() => {
      window.print();
      document.title = originalTitle;
      setBusy(null);
    }, 50);
  }

  // Download no longer routes through window.print(). A page cannot choose
  // the print destination, so that button could only ever open the dialog
  // on the last-used printer; the server now renders this same page with
  // headless Chrome and returns a file. See lib/pdf/render-page.

  return (
    <div className="no-print sticky top-0 z-10 bg-paper/95 backdrop-blur border-b border-line/60 px-4 py-2 flex items-center gap-2">
      <button
        type="button"
        onClick={() => router.push(`/app/invoices/${invoiceId}`)}
        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60"
        title="Back to invoice"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </button>

      <div className="text-xs text-ink-mute ml-2">
        Preview of <span className="font-mono">{invoiceNo}</span> &middot; A4 size
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* ?copies=original — the download is the buyer's copy alone. The
            Print button beside it still produces both sheets. */}
        <DownloadPdfButton
          path={`/app/invoices/${invoiceId}/print?copies=original`}
          filename={pdfFilename()}
        />

        <button
          type="button"
          onClick={handlePrint}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo/90 disabled:opacity-50"
          title="Print to your selected printer"
        >
          {busy === 'print'
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Printer className="w-3.5 h-3.5" />}
          Print
        </button>
      </div>
    </div>
  );
}
