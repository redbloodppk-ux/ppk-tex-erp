'use client';
/**
 * Print / Save-PDF / Back toolbar for the agent-commission report print view.
 * Mirrors the party-statement and DC print toolbars.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Printer, FileDown, ArrowLeft, Loader2 } from 'lucide-react';

interface PrintActionsProps {
  backHref: string;
  from: string;
  to: string;
  agentName: string | null;
}

function safeFilename(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}

export function PrintActions({
  backHref,
  from,
  to,
  agentName,
}: PrintActionsProps): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState<'print' | 'pdf' | null>(null);

  function pdfFilename(): string {
    const parts: string[] = ['Agent Commission'];
    if (agentName) parts.push(agentName);
    parts.push(`${from} to ${to}`);
    return safeFilename(parts.join(' - '));
  }

  function fire(mode: 'print' | 'pdf'): void {
    if (mode === 'print') {
      const ok = window.confirm(
        'Send the agent commission report to the printer?\n\nIf you want a PDF instead, pick "Save as PDF" in the print dialog.',
      );
      if (!ok) return;
    }
    setBusy(mode);
    const originalTitle = document.title;
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
        onClick={() => router.push(backHref)}
        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to report
      </button>

      <div className="text-xs text-ink-mute ml-2">Report preview · A4 size</div>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => fire('pdf')}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60 disabled:opacity-50"
        >
          {busy === 'pdf' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <FileDown className="w-3.5 h-3.5" />
          )}
          Download PDF
        </button>
        <button
          type="button"
          onClick={() => fire('print')}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo/90 disabled:opacity-50"
        >
          {busy === 'print' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Printer className="w-3.5 h-3.5" />
          )}
          Print
        </button>
      </div>
    </div>
  );
}
