/**
 * GET /app/api/wages/winder-amount?employee=<id>&week=YYYY-MM-DD
 *
 * One winder's earned wage for the Mon-Sun week starting `week`, for the
 * New Wage Entry form to prefill "Weekly settlement" with.
 *
 * Served from the server rather than computed in the browser because the
 * answer needs the WHOLE week's roster and attendance - the allocation
 * moves money between winders - and that is a lot of rows to ship to a
 * phone just to fill one box.
 *
 * The arithmetic is winderBookForWeek, which the Weekly Wage Summary also
 * reaches through. This route adds nothing to it but the HTTP.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { winderBookForWeek } from '@/lib/wages/winder-book';
import { addDaysISO } from '@/lib/wages/weekly-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const employeeRaw = url.searchParams.get('employee');
  const week = url.searchParams.get('week');

  const employeeId = Number(employeeRaw);
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    return NextResponse.json({ error: 'employee must be a positive integer' }, { status: 400 });
  }
  if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return NextResponse.json({ error: 'week must be YYYY-MM-DD' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  }

  const weekEnd = addDaysISO(week, 6);

  try {
    const book = await winderBookForWeek(supabase, week, weekEnd, employeeId);
    // Not a winder this week, or no weekly salary set. The form leaves the
    // amount alone rather than prefilling a zero.
    if (!book) return NextResponse.json({ found: false });

    return NextResponse.json({
      found: true,
      weekStart: week,
      weekEnd,
      // Rounded to paise here so the form and the summary show the same
      // string; the allocation itself works in full precision.
      amount: Math.round(book.book * 100) / 100,
      weeklySalary: book.weeklySalary,
      deduction: Math.round(book.deduction * 100) / 100,
      reallocatedIn: Math.round(book.reallocatedIn * 100) / 100,
      reallocatedOut: Math.round(book.reallocatedOut * 100) / 100,
      closedShedSlots: book.weaverAbsentCount,
      expectedShedSlots: book.expectedShedSlots,
      coveredForOthers: book.coveredForOthers,
      assignedSheds: book.assignedSheds,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'failed to compute winder wage';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
