/**
 * Shared constants for the reminders feature (migration 245) — used by
 * the /app/reminders page, the reminder form, and the notification bell
 * source so labels/order never drift between them.
 */

export type ReminderCategory = 'maintenance' | 'supplier_call' | 'bill_payment' | 'purchase' | 'other';
export type ReminderRepeat = 'none' | 'daily' | 'weekly' | 'monthly';
export type ReminderStatus = 'active' | 'done' | 'archived';

export const REMINDER_CATEGORIES: ReminderCategory[] = [
  'maintenance', 'supplier_call', 'bill_payment', 'purchase', 'other',
];

export const CATEGORY_LABEL: Record<ReminderCategory, string> = {
  maintenance:   'Maintenance',
  supplier_call: 'Supplier call',
  bill_payment:  'Bill payment',
  purchase:      'Purchase',
  other:         'Other',
};

export const REPEAT_LABEL: Record<ReminderRepeat, string> = {
  none:    'One-time',
  daily:   'Repeats daily',
  weekly:  'Repeats weekly',
  monthly: 'Repeats monthly',
};
