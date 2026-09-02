/**
 * WeaverRangeExport — pick a date range, download weaver wages for it.
 *
 * PPK, 2026-09-02: "we need available date range download option for Weaver
 * Wages only." The rest of this page is locked to one week, which is what
 * you want when paying people on Saturday and no use at all for looking
 * back over a season.
 *
 * Weavers only — the metre-basis section. Loom-shift and weekly staff are
 * not in it, on purpose.
 *
 * A server component: the two buttons are plain anchors, so the browser
 * does the downloading and no client JavaScript is involved. The dates are
 * a GET form, so picking a range and pressing a button re-renders this page
 * with ?wfrom=&wto= and the links pick it up. Slightly old-fashioned, and
 * it means the range survives a refresh or a bookmark.
 */
import { FileSpreadsheet, FileText, CalendarRange } from 'lucide-react';

interface WeaverRangeExportProps {
  /** Currently chosen range (already clamped to available records). */
  from: string;
  to: string;
  /** Earliest and latest dates with production records, or null if none. */
  min?: string;
  max?: string;
  /** Week the rest of the page is showing, preserved across the form post
   *  so choosing a range does not also throw you back to this week. */
  weekStart: string;
}

export function WeaverRangeExport({
  from, to, min, max, weekStart,
}: WeaverRangeExportProps): React.ReactElement {
  const qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return (
    <div className="card p-3 mb-4">
      <div className="flex items-center gap-2 mb-2">
        <CalendarRange className="w-4 h-4 text-ink-soft" />
        <span className="text-sm font-semibold">Weaver wages for a date range</span>
        <span className="text-[11px] text-ink-mute">
          Metre-basis weavers only · one line per weaver per week
        </span>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        {/* Keeps the week the rest of the page is on. */}
        <input type="hidden" name="week" value={weekStart} />
        <div>
          <label className="label text-xs" htmlFor="wfrom">From</label>
          <input id="wfrom" name="wfrom" type="date" defaultValue={from}
            min={min} max={max} className="input h-9 text-sm" />
        </div>
        <div>
          <label className="label text-xs" htmlFor="wto">To</label>
          <input id="wto" name="wto" type="date" defaultValue={to}
            min={from || min} max={max} className="input h-9 text-sm" />
        </div>
        <button type="submit" className="btn-ghost h-9">Apply range</button>

        <div className="flex items-center gap-2 ml-auto">
          <a href={`/app/api/wages/weaver-range/export?${qs}`} className="btn-secondary" download>
            <FileSpreadsheet className="w-4 h-4" /> Weaver Excel
          </a>
          <a href={`/app/api/wages/weaver-range/export-pdf?${qs}`} className="btn-secondary" download>
            <FileText className="w-4 h-4" /> Weaver PDF
          </a>
        </div>
      </form>

      {min && max && (
        <p className="mt-2 text-[11px] text-ink-mute">
          Records available {min} to {max}. A long range takes a few seconds —
          each week is calculated the same way the summary above calculates it,
          so the figures cannot drift apart.
        </p>
      )}
    </div>
  );
}
