'use client';
/**
 * Edit User form. The email is locked (Supabase Auth manages it) — to
 * change it the owner would have to delete the user and re-invite.
 *
 * Self-edit guards:
 *   - Role and status fields are disabled when editing your own row,
 *     preventing accidental owner lockout. Backend re-checks the same
 *     guard in updateUserAction.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Save, AlertTriangle, CheckCircle2, Archive } from 'lucide-react';
import { updateUserAction, archiveUserAction, type AppRole, type AppStatus } from '../actions';

interface InitialUser {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: string;
  status: string;
  last_login: string | null;
  created_at: string;
}

interface Props {
  initial: InitialUser;
  isSelf: boolean;
}

const ROLES: ReadonlyArray<{ value: AppRole; label: string }> = [
  { value: 'owner',          label: 'Owner' },
  { value: 'mill_manager',   label: 'Mill Manager' },
  { value: 'sales_manager',  label: 'Sales Manager' },
  { value: 'accounts',       label: 'Accounts' },
  { value: 'floor_operator', label: 'Floor Operator' },
  { value: 'auditor',        label: 'Auditor' },
];

const STATUSES: ReadonlyArray<{ value: AppStatus; label: string }> = [
  { value: 'active',   label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'resigned', label: 'Resigned' },
];

function isRole(s: string): s is AppRole {
  return ROLES.some((r) => r.value === s);
}
function isStatus(s: string): s is AppStatus {
  return STATUSES.some((r) => r.value === s);
}

export function EditUserForm({ initial, isSelf }: Props): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    full_name: initial.full_name,
    phone: initial.phone ?? '',
    role: (isRole(initial.role) ? initial.role : 'floor_operator') as AppRole,
    status: (isStatus(initial.status) ? initial.status : 'active') as AppStatus,
  });
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setError(null);
    setOkMsg(null);
    startTransition(async () => {
      const res = await updateUserAction({
        id: initial.id,
        full_name: form.full_name,
        phone: form.phone,
        role: form.role,
        status: form.status,
      });
      if (!res.ok) { setError(res.error ?? 'Save failed.'); return; }
      setOkMsg('Saved.');
      router.refresh();
    });
  }

  function onArchive(): void {
    if (!window.confirm(`Archive ${initial.full_name}? They lose access on next sign-out. Audit trail is preserved and you can flip status back to Active any time.`)) return;
    setError(null);
    setOkMsg(null);
    startTransition(async () => {
      const res = await archiveUserAction(initial.id);
      if (!res.ok) { setError(res.error ?? 'Archive failed.'); return; }
      router.push('/app/settings/users');
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="card p-5 space-y-4">
      {/* Email (locked) */}
      <div>
        <label className="label">Email</label>
        <input className="input bg-cloud/40 text-ink-mute cursor-not-allowed" value={initial.email} disabled readOnly />
        <p className="text-[11px] text-ink-mute mt-1">
          Email is locked. Delete + re-invite if it needs to change.
        </p>
      </div>

      <div>
        <label className="label">Full name *</label>
        <input
          className="input"
          required
          value={form.full_name}
          onChange={(e) => setForm({ ...form, full_name: e.target.value })}
        />
      </div>

      <div>
        <label className="label">Phone</label>
        <input
          className="input num"
          type="tel"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          placeholder="+91 98765 43210"
        />
      </div>

      <div>
        <label className="label">Role *</label>
        <select
          className={'input ' + (isSelf ? 'bg-cloud/40 text-ink-mute cursor-not-allowed' : '')}
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value as AppRole })}
          disabled={isSelf}
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        {isSelf && (
          <p className="text-[11px] text-ink-mute mt-1">
            You cannot change your own role — ask another owner.
          </p>
        )}
      </div>

      <div>
        <label className="label">Status *</label>
        <select
          className={'input ' + (isSelf ? 'bg-cloud/40 text-ink-mute cursor-not-allowed' : '')}
          value={form.status}
          onChange={(e) => setForm({ ...form, status: e.target.value as AppStatus })}
          disabled={isSelf}
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-rose-50 text-rose-800 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {okMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 text-emerald-800 text-sm flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{okMsg}</span>
        </div>
      )}

      <div className="flex justify-between gap-2 pt-2">
        <div>
          {!isSelf && (
            <button
              type="button"
              onClick={onArchive}
              disabled={pending}
              className="btn-ghost text-rose-700 text-xs"
              title="Soft-delete: status → inactive. Reversible from this same page."
            >
              <Archive className="w-3.5 h-3.5" /> Archive user
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => router.push('/app/settings/users')} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={pending} className="btn-primary">
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save changes
          </button>
        </div>
      </div>
    </form>
  );
}
