'use client';
/**
 * Downloads a print page as a real PDF file.
 *
 * The old button called window.print() and hoped the operator would pick
 * "Save as PDF" in the dialog. It could not do better: a web page cannot
 * choose the print destination, so the dialog always opened on whatever
 * printer was used last. PPK, 2026-09-02: "when i press download button
 * printer must show the save print but showing last selected one."
 *
 * This asks the server to render the same page with headless Chrome and
 * sends back a file. No dialog, no printer, and the filename is ours
 * rather than whatever the browser infers.
 *
 * One component for all five print screens on purpose. Five copies of a
 * fetch-and-save routine is how the fitter wage ended up reading two
 * different numbers on two screens.
 */
import { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';

interface DownloadPdfButtonProps {
  /** Internal print path, e.g. "/app/invoices/12/print". Must be on the
   *  API's allowlist or the request is refused — see lib/pdf/render-page.
   *
   *  Omit it to render the page currently on screen, query string and all.
   *  That is the right default for the ledger and commission statements,
   *  whose date filters live in the URL: hardcoding a bare path there
   *  would quietly hand back an unfiltered document. */
  path?: string;
  /** Filename shown in the download, without needing ".pdf". */
  filename: string;
  className?: string;
  label?: string;
}

export function DownloadPdfButton({
  path,
  filename,
  className,
  label = 'Download PDF',
}: DownloadPdfButtonProps): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleClick(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const target = path ?? `${window.location.pathname}${window.location.search}`;
      // "/app/api/…", not "/api/…": the App Router directory here is
      // app/app, so every route in this project sits under /app. The same
      // path the weekly wage PDF export already uses.
      const res = await fetch(
        `/app/api/pdf?path=${encodeURIComponent(target)}&filename=${encodeURIComponent(filename)}`,
      );
      if (!res.ok) {
        // The route answers with JSON on failure, so the real reason —
        // "No Chrome found", "Print page returned 500" — reaches the
        // operator instead of a silent no-op.
        let reason = `Server returned ${res.status}`;
        try {
          const j = await res.json();
          if (j?.error) reason = String(j.error);
        } catch { /* not JSON; keep the status */ }
        throw new Error(reason);
      }

      // Blob -> object URL -> synthetic click. The only way to hand a
      // fetched file to the browser's downloader with a chosen name.
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked on the next tick: revoking immediately can cancel the
      // download in some browsers before it has read the blob.
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not build the PDF.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className={
          className ??
          'inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60 disabled:opacity-50'
        }
        title="Download this document as a PDF file"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
        {busy ? 'Building…' : label}
      </button>
      {err && (
        <span className="mt-1 max-w-[260px] text-right text-[10px] leading-tight text-rose-600">
          {err}
        </span>
      )}
    </span>
  );
}
