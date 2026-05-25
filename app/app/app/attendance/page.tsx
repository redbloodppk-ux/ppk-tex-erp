import Link from 'next/link';
import { PageHeader } from '@/app/components/page-header';
import { ChevronRight, ClipboardCheck } from 'lucide-react';

export const metadata = { title: 'Attendance' };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        subtitle="Mark Morning (8AM–8PM) and Night (8PM–8AM) shift attendance. Five statuses: present, absent, half-day, late, early leave."
      />

      <div className="card p-5">
        <h2 className="font-display font-bold text-base mb-3">Daily marking</h2>
        <Link
          href="/app/attendance/mark"
          className="flex items-center justify-between gap-3 rounded-lg border border-line hover:border-indigo-300 hover:bg-indigo-50/40 p-3 transition"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
              <ClipboardCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold">Mark Attendance</div>
              <div className="text-xs text-ink-soft">
                Pick a date and shift, then tap a status for each employee. A new
                day starts everyone on Present — just change the exceptions.
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-ink-mute" />
        </Link>
      </div>
    </div>
  );
}
