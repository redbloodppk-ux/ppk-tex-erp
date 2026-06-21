'use client';

/**
 * GSTR-1 JSON download button.
 *
 * The page builds the full return object on the server and passes it here.
 * Clicking serialises it to a Blob and triggers a browser download named
 * `GSTR1_<gstin>_<fp>.json` — the exact file you upload on the GST portal.
 */
import { useState } from 'react';
import { Download, Check } from 'lucide-react';

interface DownloadJsonButtonProps {
  /** The built GSTR-1 return object. */
  data: unknown;
  /** Filing period 'MMYYYY'. */
  fp: string;
  /** Supplier GSTIN (for the filename). */
  gstin: string;
  /** Disable when there's nothing to export. */
  disabled?: boolean;
}

export function DownloadJsonButton({ data, fp, gstin, disabled = false }: DownloadJsonButtonProps) {
  const [done, setDone] = useState(false);

  function handleDownload(): void {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GSTR1_${gstin}_${fp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setDone(true);
    window.setTimeout(() => setDone(false), 2500);
  }

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={disabled}
      className="btn-primary inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {done ? <Check className="w-4 h-4" /> : <Download className="w-4 h-4" />}
      {done ? 'Downloaded' : 'Download GSTR-1 JSON'}
    </button>
  );
}
