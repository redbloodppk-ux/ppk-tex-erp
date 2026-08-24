/**
 * Unrecorded shifts — dashboard card.
 *
 * A shift with no attendance_day row is neither worked nor a holiday. It
 * drops out of the week silently: every winder's per-shed rate rises
 * because the denominator shrank, and no shed on that shift can be counted
 * idle, so looms that stood still cost nobody anything.
 *
 * Four went unnoticed for two months (18 Jul, 24 Jul, 12 Aug, 22 Aug).
 * Nothing in the ERP mentioned them. Hence this card, the red bell item,
 * and the banners on the wage and attendance screens - all reading from
 * lib/attendance/unrecorded-shifts.ts so they cannot disagree.
 *
 * Renders NOTHING when there is nothing wrong. A card that is usually
 * empty is one you believe when it does appear.
 */
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import {
  loadUnrecordedShifts, describeShift, todayISO,
} from '@/lib/attendance/unrecorded-shifts';

export async function UnrecordedShiftsWidget(): Promise<React.ReactElement | null> {
  const supabase = await createClient();

  // Sixty days. Older weeks are settled and paid, so a warning about them
  // is history rather than something to act on.
  const from = new Date();
  from.setDate(from.getDate() - 60);
  const gaps = await loadUnrecordedShifts(supabase, todayISO(from), todayISO());

  if (gaps.length === 0) return null;

  return (
    <section className="card border-2 border-rose-300 bg-rose-50 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-rose-900">
            {gaps.length === 1
              ? '1 shift was never recorded'
              : `${gaps.length} shifts were never recorded`}
          </h2>
          <p className="mt-0.5 text-xs text-rose-800">
            Neither worked nor marked a holiday. Wages for those weeks may be
            wrong — a missing shift raises every winder&rsquo;s per-shed rate
            and hides sheds that stood idle.
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {gaps.slice(0, 12).map((g) => (
          <Link
            key={`${g.date}:${g.shift}`}
            href={`/app/attendance/mark?date=${g.date}&shift=${g.shift}`}
            className="rounded-md border border-rose-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-100"
          >
            {describeShift(g)} &rarr;
          </Link>
        ))}
        {gaps.length > 12 && (
          <span className="self-center text-xs text-rose-800">
            +{gaps.length - 12} more
          </span>
        )}
      </div>
    </section>
  );
}
