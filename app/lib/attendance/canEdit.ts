/**
 * canEdit — CORR-A4.
 *
 * Pure function that decides whether an attendance record may still be
 * edited, based on how long ago it was first marked and the role of the
 * person attempting the edit.
 *
 * Edit windows (measured from `marked_at`):
 *   • < 24 hours      → free edit for anyone who can mark attendance.
 *   • 24 to 168 hours → restricted: only owner or mill_manager (admin).
 *   • > 168 hours     → locked: nobody can edit through the app.
 *
 * 168 hours = 7 days. No over-ride password in v1 — a plain role check.
 *
 * This function does no I/O. The caller supplies the current time so the
 * result is deterministic and easy to unit-test.
 */

/** App roles allowed to edit inside the 24–168h restricted window. */
export type AdminRole = 'owner' | 'mill_manager';

/** All app roles relevant to attendance editing. */
export type EditorRole =
  | 'owner'
  | 'mill_manager'
  | 'sales_manager'
  | 'accounts'
  | 'floor_operator'
  | 'auditor';

export type EditWindow = 'free' | 'restricted' | 'locked';

export interface CanEditInput {
  /** When the record was first marked (ISO string or Date). */
  markedAt: string | Date;
  /** App role of the person trying to edit. */
  role: EditorRole;
  /** Current time — defaults to now(). Injectable for tests. */
  now?: string | Date;
}

export interface CanEditResult {
  /** Whether the edit is permitted. */
  allowed: boolean;
  /** Which time window the record falls into. */
  window: EditWindow;
  /** Hours elapsed since markedAt (>= 0). */
  hoursElapsed: number;
  /** Human-readable reason, suitable for a UI banner. */
  reason: string;
}

const HOUR_MS = 60 * 60 * 1000;
const FREE_LIMIT_HOURS = 24;
const LOCK_LIMIT_HOURS = 168; // 7 days

const ADMIN_ROLES: ReadonlySet<EditorRole> = new Set<EditorRole>([
  'owner',
  'mill_manager',
]);

/** True if the role may edit during the 24–168h restricted window. */
export function isAdminRole(role: EditorRole): role is AdminRole {
  return ADMIN_ROLES.has(role);
}

/**
 * Decide whether an attendance record can be edited right now.
 */
export function canEdit(input: CanEditInput): CanEditResult {
  const marked = new Date(input.markedAt).getTime();
  const current = new Date(input.now ?? Date.now()).getTime();

  // Guard against an unparseable date — treat as locked, fail safe.
  if (Number.isNaN(marked) || Number.isNaN(current)) {
    return {
      allowed: false,
      window: 'locked',
      hoursElapsed: 0,
      reason: 'Cannot determine when this record was marked.',
    };
  }

  const hoursElapsed = Math.max(0, (current - marked) / HOUR_MS);

  if (hoursElapsed < FREE_LIMIT_HOURS) {
    return {
      allowed: true,
      window: 'free',
      hoursElapsed,
      reason: 'Within 24 hours of marking — free to edit.',
    };
  }

  if (hoursElapsed <= LOCK_LIMIT_HOURS) {
    const allowed = isAdminRole(input.role);
    return {
      allowed,
      window: 'restricted',
      hoursElapsed,
      reason: allowed
        ? 'Marked more than 24 hours ago — editing allowed for owner/manager.'
        : 'Marked more than 24 hours ago — only an owner or mill manager can edit.',
    };
  }

  return {
    allowed: false,
    window: 'locked',
    hoursElapsed,
    reason: 'Marked more than 7 days ago — this record is locked.',
  };
}
