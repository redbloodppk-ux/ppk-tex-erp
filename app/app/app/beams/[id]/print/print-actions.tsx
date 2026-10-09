'use client';
/** Back / Download PDF / Print toolbar for the beam transport copy. */
import { useRouter } from 'next/navigation';
import { Printer, ArrowLeft } from 'lucide-react';
import { DownloadPdfButton } from '@/app/components/download-pdf-button';

export function BeamPrintActions({ id, filename }: { id: number; filename: string }): React.ReactElement {
  const router = useRouter();
  function handlePrint(): void {
    const original = document.title;
    document.title = filename;
    setTimeout(() => { window.print(); document.title = original; }, 50);
  }
  return (
    <div className="no-print sticky top-0 z-10 bg-paper/95 backdrop-blur border-b border-line/60 px-4 py-2 flex items-center gap-2">
      <button type="button" onClick={() => router.push('/app/beams')}
        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60">
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </button>
      <div className="text-xs text-ink-mute ml-2">Beam transport copy &middot; A4</div>
      <div className="ml-auto flex items-center gap-2">
        <DownloadPdfButton path={`/app/beams/${id}/print`} filename={filename} />
        <button type="button" onClick={handlePrint}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo/90">
          <Printer className="w-3.5 h-3.5" /> Print
        </button>
      </div>
    </div>
  );
}
