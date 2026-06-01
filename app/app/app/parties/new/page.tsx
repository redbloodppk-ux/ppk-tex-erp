'use client';
import { PageHeader } from '@/app/components/page-header';
import { PartyForm } from '../party-form';

export default function NewPartyPage() {
  return (
    <div className="max-w-2xl">
      <PageHeader
        title="New Party"
        crumbs={[{ label: 'Parties', href: '/app/parties' }, { label: 'New' }]}
      />
      <PartyForm />
    </div>
  );
}
