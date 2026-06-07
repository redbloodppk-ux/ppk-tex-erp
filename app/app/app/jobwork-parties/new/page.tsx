'use client';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/app/components/page-header';
import { JobworkPartyForm } from '../jobwork-party-form';

export default function NewJobworkPartyPage() {
  // ?kind=outsource opens the form pre-flagged as an outsource weaver
  // entry, which routes the auto-issued code to OWP/26-27/NNNN
  // (instead of the jobwork JWP-NNNN series).
  const sp = useSearchParams();
  const kind: 'jobwork' | 'outsource' = sp.get('kind') === 'outsource' ? 'outsource' : 'jobwork';
  const title = kind === 'outsource' ? 'New Outsource Weaver' : 'New Jobwork Party';
  const crumbHome = kind === 'outsource' ? 'Outsource Weaving' : 'Jobwork Parties';
  const crumbHref = kind === 'outsource' ? '/app/outsource' : '/app/jobwork-parties';
  return (
    <div className="max-w-2xl">
      <PageHeader
        title={title}
        crumbs={[{ label: crumbHome, href: crumbHref }, { label: 'New' }]}
      />
      <JobworkPartyForm kind={kind} />
    </div>
  );
}
