/**
 * ExportButtons — small server component widget on the Weekly Summary page.
 *
 * Renders two plain anchor links to the Excel and PDF endpoints. Anchor links
 * keep this trivially server-renderable and let the browser handle the file
 * download; no client JS needed.
 */
import { FileSpreadsheet, FileText } from 'lucide-react';

interface ExportButtonsProps {
  weekStart: string;
}

export function ExportButtons({ weekStart }: ExportButtonsProps): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      <a
        href={`/app/api/wages/weekly/export?week=${weekStart}`}
        className="btn-secondary"
        download
      >
        <FileSpreadsheet className="w-4 h-4" />
        Export Excel
      </a>
      <a
        href={`/app/api/wages/weekly/export-pdf?week=${weekStart}`}
        className="btn-secondary"
        download
      >
        <FileText className="w-4 h-4" />
        Download PDF
      </a>
    </div>
  );
}
