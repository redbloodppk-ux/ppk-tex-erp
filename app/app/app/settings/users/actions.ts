'use server';
/**
 * Server actions for Settings → Users.
 *
 * Three actions, all owner-only:
 *   - inviteUserAction:   create auth.users via the Supabase admin API
 *                         and the matching app_user row in one go. Supabase
 *                         sends the OTP / magic-link invite email; on
 *                         first sign-in the user becomes active.
 *   - updateUserAction:   change full_name / phone / role / status on an
 *                         existing app_user row.
 *   - archiveUserAction:  soft-delete by flipping status='inactive'. We
 *                         do NOT hard-delete auth.users — that's owner-
 *                         only manual maintenance because it cascades
 *                         and rewrites audit trails.
 */
import { revalidatePath } from 'next/cache';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { requireOwner, NotOwnerError } from '@/lib/auth/require-owner';

export type AppRole = 'owner' | 'mill_manager' | 'sales_manager' | 'accounts' | 'floor_operator' | 'auditor';
export type AppStatus = 'active' | 'inactive' | 'resigned';

export interface InviteUserInput {
  email: string;
  full_name: string;
  role: AppRole;
  phone: string;
}

export interface UpdateUserInput {
  id: string;
  full_name: string;
  role: AppRole;
  status: AppStatus;
  phone: string;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const ROLES: ReadonlyArray<AppRole> = [
  'owner', 'mill_manager', 'sales_manager', 'accounts', 'floor_operator', 'auditor',
];
const STATUSES: ReadonlyArray<AppStatus> = ['active', 'inactive', 'resigned'];

function isAppRole(s: string): s is AppRole { return (ROLES as readonly string[]).includes(s); }
function isAppStatus(s: string): s is AppStatus { return (STATUSES as readonly string[]).includes(s); }

function validateEmail(email: string): string | null {
  if (!email || email.indexOf('@') < 1) return 'Email is required and must contain @.';
  if (email.length > 254) return 'Email is too long.';
  return null;
}

/** Invite a new user. Sends an OTP/magic-link email via Supabase Auth
 *  admin and creates the matching app_user row. */
export async function inviteUserAction(input: InviteUserInput): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    await requireOwner(supabase);

    const email = input.email.trim().toLowerCase();
    const full_name = input.full_name.trim();
    const role = input.role;
    const phone = input.phone.trim();

    const emailErr = validateEmail(email);
    if (emailErr) return { ok: false, error: emailErr };
    if (full_name === '') return { ok: false, error: 'Full name is required.' };
    if (!isAppRole(role)) return { ok: false, error: 'Pick a valid role.' };

    const admin = createServiceClient();

    // Step 1: invite via Supabase Auth admin. Returns the new auth user
    // (we need its id to populate app_user.id, which FKs auth.users(id)).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminAuth = (admin.auth as any).admin;
    if (!adminAuth || typeof adminAuth.inviteUserByEmail !== 'function') {
      return { ok: false, error: 'Supabase admin API unavailable. Check SUPABASE_SERVICE_ROLE_KEY env var.' };
    }
    const { data: invite, error: inviteErr } = await adminAuth.inviteUserByEmail(email);
    if (inviteErr || !invite?.user) {
      return { ok: false, error: inviteErr?.message ?? 'Invite call returned no user.' };
    }
    const newUserId: string = invite.user.id;

    // Step 2: create the app_user row. If the row insert fails AFTER the
    // auth user is created, we'd be in a broken state — surface the
    // error so the owner can manually delete the auth user and retry.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sbAdmin = admin as any;
    const { error: rowErr } = await sbAdmin.from('app_user').insert({
      id: newUserId,
      full_name,
      email,
      phone: phone || null,
      role,
      status: 'active' as AppStatus,
    });
    if (rowErr) {
      return {
        ok: false,
        error: `Auth user was created but app_user insert failed: ${rowErr.message}. Delete the auth user manually in Supabase Dashboard before retrying.`,
      };
    }

    revalidatePath('/app/settings/users');
    revalidatePath('/app/settings');
    return { ok: true };
  } catch (e: unknown) {
    if (e instanceof NotOwnerError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error.' };
  }
}

/** Update an existing app_user row. The owner can change everything
 *  except the email (Supabase Auth manages email; changing it there
 *  would orphan the row). */
export async function updateUserAction(input: UpdateUserInput): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const owner = await requireOwner(supabase);

    const id = input.id;
    if (!id) return { ok: false, error: 'Missing user id.' };
    if (!isAppRole(input.role))     return { ok: false, error: 'Pick a valid role.' };
    if (!isAppStatus(input.status)) return { ok: false, error: 'Pick a valid status.' };
    if (input.full_name.trim() === '') return { ok: false, error: 'Full name is required.' };

    // Guard rails: don't let the owner lock themselves out by changing
    // their own role away from 'owner' or marking themselves inactive.
    // (They can still demote themselves via the DB if absolutely needed.)
    if (id === owner.userId) {
      if (input.role !== 'owner') return { ok: false, error: 'You cannot change your own role away from owner. Ask another owner to do it, or use the DB directly.' };
      if (input.status !== 'active') return { ok: false, error: 'You cannot mark your own account as inactive.' };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error } = await sb
      .from('app_user')
      .update({
        full_name: input.full_name.trim(),
        phone: input.phone.trim() || null,
        role: input.role,
        status: input.status,
      })
      .eq('id', id);
    if (error) return { ok: false, error: error.message };

    revalidatePath('/app/settings/users');
    revalidatePath('/app/settings');
    return { ok: true };
  } catch (e: unknown) {
    if (e instanceof NotOwnerError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error.' };
  }
}

/** Soft-delete: status → 'inactive'. The auth.users row is preserved so
 *  the audit trail stays intact and re-activation is one click away. */
export async function archiveUserAction(id: string): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const owner = await requireOwner(supabase);
    if (!id) return { ok: false, error: 'Missing user id.' };
    if (id === owner.userId) return { ok: false, error: 'You cannot archive your own account.' };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error } = await sb.from('app_user').update({ status: 'inactive' }).eq('id', id);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/app/settings/users');
    revalidatePath('/app/settings');
    return { ok: true };
  } catch (e: unknown) {
    if (e instanceof NotOwnerError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error.' };
  }
}
