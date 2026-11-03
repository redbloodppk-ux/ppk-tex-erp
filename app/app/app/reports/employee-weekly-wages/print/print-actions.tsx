'use client';
/** Back / Download PDF / Print toolbar for the Employee Weekly Wages print view. */
import Link from 'next/link';
import { Printer, ArrowLeft } from 'lucide-react';
import { DownloadPdfButton } from '@/app/components/download-pdf-button';

function safeFilename(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}

export function PrintActions({ backHref, filename }: { backHref: string; filename: string }): React.ReactElement {
  return (
    <div className="no-print print:hidden sticky top-0 z-10 bg-paper/95 backdrop-blur border-b border-line/60 px-4 py-2 flex items-center gap-2">
      <Link href={backHref}
        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to report
      </Link>
      <div className="text-xs text-ink-mute ml-2">Report preview · A4 landscape</div>
      <div className="ml-auto flex items-center gap-2">
        {/* No path: filters live in the query string. */}
        <DownloadPdfButton filename={safeFilename(filename)} />
        <button type="button" onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo/90">
          <Printer className="w-3.5 h-3.5" /> Print
        </button>
      </div>
    </div>
  );
}
