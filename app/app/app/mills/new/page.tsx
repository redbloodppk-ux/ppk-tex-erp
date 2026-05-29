'use client';
import { PageHeader } from '@/app/components/page-header';
import { MillForm } from '../mill-form';

export default function NewMillPage() {
  return (
    <div className="max-w-2xl">
      <PageHeader
        title="New Mill"
        crumbs={[{ label: 'Mills', href: '/app/mills' }, { label: 'New' }]}
      />
      <MillForm />
    </div>
  );
}
