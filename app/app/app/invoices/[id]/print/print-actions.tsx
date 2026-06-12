'use client';
/**
 * Print / Save-PDF / Back toolbar that hangs at the top of every invoice
 * print page. The toolbar is hidden when the page is printing (via the
 * @media print CSS in the parent page). Same UX as the DC print toolbar
 * so the muscle memory carries over.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Printer, FileDown, ArrowLeft, Loader2 } from 'lucide-react';

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
    document.title = `Print ${safeFilename(invoiceNo)}`;
    setTimeout(() => {
      window.print();
      document.title = originalTitle;
      setBusy(null);
    }, 50);
  }

  function handlePdf(): void {
    setBusy('pdf');
    const originalTitle = document.title;
    // Browsers use document.title as the default filename when the user
    // picks "Save as PDF" from the print dialog. So the downloaded file
    // becomes e.g. "ABC TEX INV-26-27-039 12-06-2026.pdf".
    document.title = pdfFilename();
    setTimeout(() => {
      window.print();
      document.title = originalTitle;
      setBusy(null);
    }, 50);
  }

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
        <button
          type="button"
          onClick={handlePdf}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60 disabled:opacity-50"
          title="Save as PDF using the system print dialog's Save-as-PDF option"
        >
          {busy === 'pdf'
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <FileDown className="w-3.5 h-3.5" />}
          Download PDF
        </button>

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
