// Reusable "Generate Excel report" button for report pages.
//
// A report page (a server component) computes its filtered, sorted rows and
// hands them to this button along with a column spec. When the user clicks,
// the button POSTs everything to /app/api/reports/export, which streams back a
// styled .xlsx file. The browser then downloads it.
//
// Because the page passes the exact rows it rendered, the spreadsheet always
// matches what is on screen -- same filters, same sort order.
//
// Usage (inside a report server component):
//   <PageHeader
//     title="Sales Register"
//     actions={
//       <ExcelExportButton
//         filename="sales-register"
//         sheetName="Sales Register"
//         title="Sales Register"
//         columns={EXCEL_COLUMNS}
//         rows={filteredRows}
//       />
//     }
//   />

'use client';
import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import type { ExcelColumn } from '@/lib/xlsx';

interface ExcelExportButtonProps {
  /** Download file name, with or without the .xlsx extension. */
  filename: string;
  /** Worksheet tab name. */
  sheetName: string;
  /** Optional bold title row above the table. */
  title?: string;
  /** Column spec: order, labels, value types, totals. */
  columns: ExcelColumn[];
  /** The rows currently shown on screen (already filtered and sorted). */
  rows: ReadonlyArray<Record<string, unknown>>;
  /** Button label. Default: "Generate Excel report". */
  label?: string;
}

export function ExcelExportButton({
  filename,
  sheetName,
  title,
  columns,
  rows,
  label = 'Generate Excel report',
}: ExcelExportButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/app/api/reports/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, sheetName, title, columns, rows }),
      });

      if (!res.ok) {
        let message = `Export failed (HTTP ${res.status}).`;
        try {
          const data = (await res.json()) as { error?: string };
          if (data.error) message = data.error;
        } catch {
          // Response was not JSON -- keep the generic message.
        }
        throw new Error(message);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename.toLowerCase().endsWith('.xlsx')
        ? filename
        : `${filename}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Could not generate the file.'
      );
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || rows.length === 0;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className="btn-ghost border border-line disabled:opacity-50 disabled:cursor-not-allowed"
        title={
          rows.length === 0
            ? 'Nothing to export -- no rows match the current view.'
            : 'Download these rows as an Excel file'
        }
      >
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Download className="w-4 h-4" />
        )}
        {busy ? 'Generating…' : label}
      </button>
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </div>
  );
}
