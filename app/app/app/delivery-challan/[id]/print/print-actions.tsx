'use client';
/**
 * Print / Save-PDF / Back toolbar that hangs at the top of the DC print
 * page. The toolbar itself is hidden when the page is printing (see the
 * @media print rule in the print page CSS).
 *
 * - Print  → opens the OS print dialog. If no printer is connected the
 *            dialog shows "No printer" — that's the most a browser-based
 *            app can do.
 * - PDF    → renames the document just before printing so a Save-as-PDF
 *            from the same dialog lands with the DC code as filename.
 * - Back   → returns to the DC edit screen.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Printer, FileDown, ArrowLeft, Loader2 } from 'lucide-react';

interface PrintActionsProps {
  dcId: number;
  dcCode: string;
}

export function PrintActions({ dcId, dcCode }: PrintActionsProps): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState<'print' | 'pdf' | null>(null);

  function safeFilename(code: string): string {
    return code.replace(/[\\/:*?"<>|]/g, '-');
  }

  function handlePrint(): void {
    const ok = window.confirm(
      `Send ${dcCode} to the printer?\n\nWhen the print dialog opens, pick your printer and click Print. ` +
        `If you don't see a printer there, set one up on this computer first.`,
    );
    if (!ok) return;
    setBusy('print');
    const originalTitle = document.title;
    document.title = `Print ${safeFilename(dcCode)}`;
    setTimeout(() => {
      window.print();
      document.title = originalTitle;
      setBusy(null);
    }, 50);
  }

  function handlePdf(): void {
    setBusy('pdf');
    const originalTitle = document.title;
    // Setting document.title makes most browsers default the
    // "Save as PDF" filename to this — e.g. DC-26-27-038.pdf.
    document.title = safeFilename(dcCode);
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
        onClick={() => router.push(`/app/delivery-challan/${dcId}`)}
        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60"
        title="Back to edit"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to edit
      </button>

      <div className="text-xs text-ink-mute ml-2">
        Preview of <span className="font-mono">{dcCode}</span> &middot; A4 size
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={handlePdf}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60 disabled:opacity-50"
          title="Save as PDF (uses the system print dialog's 'Save as PDF' option)"
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
