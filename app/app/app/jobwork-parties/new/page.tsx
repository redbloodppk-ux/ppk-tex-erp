'use client';
import { PageHeader } from '@/app/components/page-header';
import { JobworkPartyForm } from '../jobwork-party-form';

export default function NewJobworkPartyPage() {
  return (
    <div className="max-w-2xl">
      <PageHeader
        title="New Jobwork Party"
        crumbs={[{ label: 'Jobwork Parties', href: '/app/jobwork-parties' }, { label: 'New' }]}
      />
      <JobworkPartyForm />
    </div>
  );
}
