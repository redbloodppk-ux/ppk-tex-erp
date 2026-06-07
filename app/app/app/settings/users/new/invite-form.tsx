'use client';
/**
 * Invite User form. Calls inviteUserAction (server) which (1) calls
 * the Supabase Auth admin API to create auth.users + send the magic-
 * link email, and (2) inserts the matching app_user row.
 *
 * UX rules:
 *   - Email and Full Name are required.
 *   - Role default is floor_operator — least privilege.
 *   - On success → navigate to the user list with the new user
 *     highlighted by adding ?new=<email> to the URL.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Send, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { inviteUserAction, type AppRole } from '../actions';

const ROLES: ReadonlyArray<{ value: AppRole; label: string; hint: string }> = [
  { value: 'owner',          label: 'Owner',          hint: 'Full access. Owners can manage other users.' },
  { value: 'mill_manager',   label: 'Mill Manager',   hint: 'Manages production, attendance, and floor settings.' },
  { value: 'sales_manager',  label: 'Sales Manager',  hint: 'Owns sales orders, invoices, customer ledgers.' },
  { value: 'accounts',       label: 'Accounts',       hint: 'Payments, vendor ledgers, GST, and reports.' },
  { value: 'floor_operator', label: 'Floor Operator', hint: 'Day-to-day data entry: attendance, DCs, fabric receipts.' },
  { value: 'auditor',        label: 'Auditor',        hint: 'Read-only access across the app.' },
];

export function InviteUserForm(): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    email: '',
    full_name: '',
    phone: '',
    role: 'floor_operator' as AppRole,
  });
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setError(null);
    setOkMsg(null);
    startTransition(async () => {
      const res = await inviteUserAction({
        email: form.email.trim().toLowerCase(),
        full_name: form.full_name.trim(),
        role: form.role,
        phone: form.phone.trim(),
      });
      if (!res.ok) {
        setError(res.error ?? 'Invite failed.');
        return;
      }
      setOkMsg(`Invite sent to ${form.email}.`);
      // Give the success banner a beat, then bounce to the list.
      window.setTimeout(() => {
        router.push(`/app/settings/users?new=${encodeURIComponent(form.email)}`);
        router.refresh();
      }, 800);
    });
  }

  const roleHint = ROLES.find((r) => r.value === form.role)?.hint ?? '';

  return (
    <form onSubmit={onSubmit} className="card p-5 space-y-4">
      <div>
        <label className="label">Full name *</label>
        <input
          className="input"
          required
          value={form.full_name}
          onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          placeholder="e.g. Suresh Kumar"
          autoComplete="off"
        />
      </div>

      <div>
        <label className="label">Email *</label>
        <input
          className="input num"
          type="email"
          required
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="user@example.com"
          autoComplete="off"
        />
        <p className="text-[11px] text-ink-mute mt-1">
          They&rsquo;ll receive a magic-link sign-in email at this address.
        </p>
      </div>

      <div>
        <label className="label">Phone</label>
        <input
          className="input num"
          type="tel"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          placeholder="+91 98765 43210"
          autoComplete="off"
        />
      </div>

      <div>
        <label className="label">Role *</label>
        <select
          className="input"
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value as AppRole })}
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        <p className="text-[11px] text-ink-mute mt-1">{roleHint}</p>
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

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={() => router.push('/app/settings/users')} className="btn-secondary">
          Cancel
        </button>
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Send invite
        </button>
      </div>
    </form>
  );
}
