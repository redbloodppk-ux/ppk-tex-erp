'use client';

/**
 * GSTR-1 CSV download button.
 *
 * The page builds the full return object on the server and passes it here.
 * Clicking builds one CSV per non-empty section (via `lib/gstr1-csv.ts`),
 * zips them client-side with JSZip, and triggers a browser download named
 * `GSTR1_<gstin>_<fp>.zip`. Unzip and import each CSV into the GST portal's
 * Returns Offline Tool via GSTR-1/IFF → Import Data Using Excel and CSV
 * Import → One section at a time.
 */
import { useState } from 'react';
import JSZip from 'jszip';
import { Download, Check } from 'lucide-react';
import type { Gstr1Return } from '@/lib/gstr1';
import {
  toB2bCsv,
  toB2clCsv,
  toB2csCsv,
  toCdnrCsv,
  toCdnurCsv,
  toHsnCsv,
  toDocsCsv,
} from '@/lib/gstr1-csv';

interface DownloadCsvButtonProps {
  /** The built GSTR-1 return object. */
  data: Gstr1Return;
  /** Filing period 'MMYYYY'. */
  fp: string;
  /** Supplier GSTIN (for the filename). */
  gstin: string;
  /** Disable when there's nothing to export. */
  disabled?: boolean;
}

export function DownloadCsvButton({ data, fp, gstin, disabled = false }: DownloadCsvButtonProps) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function handleDownload(): Promise<void> {
    setBusy(true);
    try {
      const files: [string, string | null][] = [
        ['b2b.csv', toB2bCsv(data.b2b ?? [])],
        ['b2cl.csv', toB2clCsv(data.b2cl ?? [])],
        ['b2cs.csv', toB2csCsv(data.b2cs ?? [])],
        ['cdnr.csv', toCdnrCsv(data.cdnr ?? [])],
        ['cdnur.csv', toCdnurCsv(data.cdnur ?? [])],
        // Table 12 has had separate B2B and B2C tabs since GSTN's advisory
        // of 20 May 2025, and is mandatory. A single combined hsn.csv has
        // nowhere to go in the current Offline Tool, so the section was
        // silently absent from the generated JSON and the portal rejected
        // the whole return. Two files now, named for the tab each belongs in.
        // THE PARENTHESES MATTER. The Offline Tool checks the FILE NAME
        // against the section id before it reads a single row -
        // returns.ctrl.js:
        //
        //   filename = filename.split('.').slice(0, -1).join('.');
        //   if (sectionId != filename && filename != null) { ...refuse... }
        //
        // sectionId is literally "hsn(b2b)". A file called hsn_b2b.csv is
        // rejected with "Data Invalid. Either all rows have invalid data
        // or the wrong section file is copied/uploaded" - which reads like
        // a data fault and is nothing of the kind. Cost PPK an evening on
        // 2026-09-09. The other sections pass this check only because
        // b2b.csv, cdnr.csv and the rest already match their ids.
        ['hsn(b2b).csv', toHsnCsv(data.hsn_b2b?.data ?? [])],
        ['hsn(b2c).csv', toHsnCsv(data.hsn_b2c?.data ?? [])],
        ['docs.csv', toDocsCsv(data.doc_issue?.doc_det ?? [])],
      ];

      const zip = new JSZip();
      for (const [name, csv] of files) {
        if (csv !== null) zip.file(name, csv);
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `GSTR1_${gstin}_${fp}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDone(true);
      window.setTimeout(() => setDone(false), 2500);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={disabled || busy}
      className="btn-primary inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {done ? <Check className="w-4 h-4" /> : <Download className="w-4 h-4" />}
      {done ? 'Downloaded' : 'Download GSTR-1 CSVs'}
    </button>
  );
}
