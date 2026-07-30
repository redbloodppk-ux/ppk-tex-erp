/**
 * Category management (migration 246) — owner can add, rename, and delete
 * reminder categories here. 'other' is the system fallback and can't be
 * deleted; a category still referenced by a reminder can't be deleted
 * either (see app/app/reminders/categories/actions.ts).
 */
import { PageHeader } from '@/app/components/page-header';
import { createClient } from '@/lib/supabase/server';
import { fetchAllCategories } from '@/lib/reminders/constants';
import { CategoryRowItem } from '@/app/components/reminders/category-row';
import { AddCategoryForm } from '@/app/components/reminders/add-category-form';

export const metadata = { title: 'Manage Categories' };
export const dynamic = 'force-dynamic';

export default async function CategoriesPage(): Promise<React.ReactElement> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const categories = await fetchAllCategories(supabase as any);

  return (
    <div>
      <PageHeader
        title="Manage Categories"
        subtitle="Add, rename, or delete the categories used to tag reminders. 'Other' is the built-in fallback and can't be removed."
        crumbs={[{ label: 'Reminders', href: '/app/reminders' }, { label: 'Categories' }]}
      />

      <div className="card p-5 max-w-xl space-y-4">
        <div className="space-y-2">
          {categories.map((c) => (
            <CategoryRowItem key={c.key} category={c} />
          ))}
        </div>

        <div className="pt-3 border-t border-line/40">
          <AddCategoryForm />
        </div>
      </div>
    </div>
  );
}
