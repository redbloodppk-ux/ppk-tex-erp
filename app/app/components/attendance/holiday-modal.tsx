'use client';
/**
 * HolidayModal — CORR-A3.
 *
 * Launched from the Daily Marking screen. Flags a whole date (one shift
 * or both) as a non-working holiday.
 *
 *   • Pick which shift(s): Morning, Night, or Both.
 *   • Pick a reason: Power cut, National holiday, Maintenance, Other.
 *   • A remark is optional, except for "Other" where it is mandatory.
 *
 * On save it writes one `attendance_day` row per chosen shift with
 * `is_working = false` and the reason. No per-employee rows are needed
 * for a holiday — the day itself is the non-working record. If a few
 * employees still came in, they can be marked Present individually on
 * the Daily Marking screen.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { createClient } from '@/lib/supabase/client';
import { Loader2, CalendarOff, X } from 'lucide-react';
import type { Database } from '@/lib/database.types';

type ShiftCode = Database['public']['Enums']['shift_code'];
type NonWorkingReason = Database['public']['Enums']['non_working_reason'];

type ShiftChoice = 'morning' | 'night' | 'both';

const REASONS: { value: NonWorkingReason; label: string }[] = [
  { value: 'power_cut', label: 'Power cut' },
  { value: 'national_holiday', label: 'National holiday' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'other', label: 'Other' },
];

interface HolidayModalProps {
  open: boolean;
  date: string;
  defaultShift: ShiftCode;
  onClose: () => void;
  onSaved: () => void;
}

export function HolidayModal({
  open,
  date,
  defaultShift,
  onClose,
  onSaved,
}: HolidayModalProps) {
  const supabase = createClient();
  const [shiftChoice, setShiftChoice] = useState<ShiftChoice>(defaultShift);
  const [reason, setReason] = useState<NonWorkingReason>('national_holiday');
  const [remark, setRemark] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // Portals need a DOM to mount into, which the server render does not
  // have. Flip after mount so the first client render matches the server's.
  const [mounted, setMounted] = useState<boolean>(false);
  useEffect(() => { setMounted(true); }, []);

  // The modal stays mounted between openings, so useState(defaultShift) only
  // saw the shift the page loaded with. Every time it opens, start from the
  // shift currently selected on the marking screen.
  useEffect(() => {
    if (open) {
      setShiftChoice(defaultShift);
      setError(null);
    }
  }, [open, defaultShift]);

  // Escape closes, and the page behind does not scroll while the dialog is
  // up — otherwise a flick on a phone scrolls the list under the backdrop.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  async function handleSave(): Promise<void> {
    setError(null);

    if (reason === 'other' && remark.trim() === '') {
      setError('A remark is required when the reason is "Other".');
      return;
    }

    const shifts: ShiftCode[] =
      shiftChoice === 'both' ? ['morning', 'night'] : [shiftChoice];

    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const rows = shifts.map((s) => ({
      attendance_date: date,
      shift: s,
      is_working: false,
      reason,
      remark: remark.trim() || null,
      marked_by: user?.id ?? null,
      marked_at: new Date().toISOString(),
    }));

    const { error: err } = await supabase
      .from('attendance_day')
      .upsert(rows, { onConflict: 'attendance_date,shift' });
    setSaving(false);

    if (err) {
      setError(err.message);
      return;
    }
    onSaved();
  }

  const SHIFT_CHOICES: { value: ShiftChoice; label: string }[] = [
    { value: 'morning', label: 'Morning' },
    { value: 'night', label: 'Night' },
    { value: 'both', label: 'Both shifts' },
  ];

  // Mounted on document.body rather than in place. A `fixed` overlay is
  // positioned against the viewport only while no ancestor has a transform,
  // filter or will-change — the app shell has carried one of those, and any
  // future animation could bring it back. Rendering at the body root means
  // this dialog cannot be captured by a wrapper again.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Mark day as holiday"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* max-h keeps a tall dialog inside a short window — on a phone in
          landscape this form is taller than the screen. */}
      <div className="card w-full max-w-md p-5 space-y-4 my-auto max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <h2 className="flex items-center gap-2 font-display font-bold text-base">
            <CalendarOff className="h-5 w-5 text-amber-600" />
            Mark day as holiday
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-ink-mute hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-ink-soft">
          This records {date} as a non-working day. Employees who still came in
          can be marked Present afterwards on the marking screen.
        </p>

        <div>
          <span className="label">Which shift?</span>
          <div className="flex flex-wrap gap-2">
            {SHIFT_CHOICES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setShiftChoice(c.value)}
                className={
                  'min-h-[44px] ' +
                  (shiftChoice === c.value ? 'btn-primary' : 'btn-ghost')
                }
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label" htmlFor="holiday-modal-reason">
            Reason
          </label>
          <select
            id="holiday-modal-reason"
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value as NonWorkingReason)}
          >
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="holiday-modal-remark">
            Remark {reason === 'other' ? '(required)' : '(optional)'}
          </label>
          <input
            id="holiday-modal-remark"
            type="text"
            className="input w-full"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder={reason === 'other' ? 'Describe the reason' : 'e.g. Diwali'}
          />
        </div>

        {error && <p className="text-sm text-err">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            className="btn-ghost min-h-[44px]"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary flex items-center gap-1.5 min-h-[44px]"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CalendarOff className="h-4 w-4" />
            )}
            Mark as holiday
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
