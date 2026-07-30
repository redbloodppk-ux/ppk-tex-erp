'use server';
/**
 * Server actions for managing reminder categories (migration 246).
 * Categories are owner-manageable: add, rename (label only — the key
 * stays stable so existing reminders keep pointing at the right row),
 * and delete. 'other' is the system fallback category and can't be
 * deleted. A category still referenced by any reminder can't be
 * deleted either — the owner has to reassign those reminders first
 * (the DB's FK would reject the delete anyway; this just gives a
 * friendlier message with the count).
 */
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

type ActionResult = { ok: true } | { ok: false; error: string };

function revalidateAll(): void {
  revalidatePath('/app/reminders');
  revalidatePath('/app/reminders/categories');
  revalidatePath('/app/reminders/new');
  revalidatePath('/app/dashboard');
}

function slugify(label: string): string {
  const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return base || 'category';
}

export async function createCategory(label: string): Promise<ActionResult> {
  const trimmed = label.trim();
  if (!trimmed) return { ok: false, error: 'Enter a category name.' };

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const base = slugify(trimmed);
  let key = base;
  // Guarantee a unique key even if two labels slugify to the same thing
  // (e.g. "Bill Payment" and "bill-payment!").
  for (let n = 2; n < 50; n += 1) {
    const { data: existing } = await sb.from('reminder_category').select('key').eq('key', key).maybeSingle();
    if (!existing) break;
    key = `${base}_${n}`;
  }

  const { data: maxRow } = await sb
    .from('reminder_category')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = (Number(maxRow?.sort_order) || 0) + 1;

  const { error } = await sb.from('reminder_category').insert({ key, label: trimmed, sort_order: nextSort });
  if (error) return { ok: false, error: error.message };

  revalidateAll();
  return { ok: true };
}

export async function renameCategory(key: string, label: string): Promise<ActionResult> {
  const trimmed = label.trim();
  if (!trimmed) return { ok: false, error: 'Enter a category name.' };

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('reminder_category').update({ label: trimmed }).eq('key', key);
  if (error) return { ok: false, error: error.message };

  revalidateAll();
  return { ok: true };
}

export async function deleteCategory(key: string): Promise<ActionResult> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data: cat } = await sb.from('reminder_category').select('is_system').eq('key', key).maybeSingle();
  if (cat?.is_system) return { ok: false, error: '"Other" is the fallback category and can\u2019t be deleted.' };

  const { count } = await sb.from('reminder').select('id', { count: 'exact', head: true }).eq('category', key);
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `${count} reminder${count === 1 ? '' : 's'} still use this category — reassign ${count === 1 ? 'it' : 'them'} first.`,
    };
  }

  const { error } = await sb.from('reminder_category').delete().eq('key', key);
  if (error) return { ok: false, error: error.message };

  revalidateAll();
  return { ok: true };
}
