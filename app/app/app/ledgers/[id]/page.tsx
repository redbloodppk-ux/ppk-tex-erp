import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { LedgerForm, type LedgerFormValues, type LedgerOption } from '../ledger-form';

export const metadata = { title: 'Edit Ledger' };
export const dynamic = 'force-dynamic';

interface LedgerRow {
  id: number;
  code: string;
  name: string;
  type_id: number;
  group_id: number;
  address1: string | null;
  address2: string | null;
  address3: string | null;
  address4: string | null;
  phone: string | null;
  email: string | null;
  pan_no: string | null;
  gstin: string | null;
  gstin_verified_at: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_ifsc: string | null;
  bank_branch: string | null;
  area: string | null;
  active: boolean;
  notes: string | null;
}

export default async function EditLedgerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const [ledRes, typesRes, groupsRes] = await Promise.all([
    sb.from('ledger').select('*').eq('id', numericId).maybeSingle(),
    sb.from('ledger_type').select('id, code, name').eq('active', true).order('name'),
    sb.from('ledger_group').select('id, code, name').eq('active', true).order('name'),
  ]);

  const l = ledRes.data as unknown as LedgerRow | null;
  if (!l) notFound();

  const types = (typesRes.data ?? []) as unknown as LedgerOption[];
  const groups = (groupsRes.data ?? []) as unknown as LedgerOption[];

  const initial: LedgerFormValues = {
    name:     l.name,
    type_id:  String(l.type_id),
    group_id: String(l.group_id),
    address1: l.address1 ?? '',
    address2: l.address2 ?? '',
    address3: l.address3 ?? '',
    address4: l.address4 ?? '',
    phone:    l.phone ?? '',
    email:    l.email ?? '',
    pan_no:   l.pan_no ?? '',
    gstin:    l.gstin ?? '',
    gstin_verified_at: l.gstin_verified_at ?? null,
    bank_name:       l.bank_name       ?? '',
    bank_account_no: l.bank_account_no ?? '',
    bank_ifsc:       l.bank_ifsc       ?? '',
    bank_branch:     l.bank_branch     ?? '',
    area:     l.area ?? '',
    active:   l.active,
    notes:    l.notes ?? '',
  };

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={l.name}
        subtitle={`${l.code} - edit ledger`}
        crumbs={[{ label: 'Ledgers', href: '/app/ledgers' }, { label: l.name }]}
      />
      <LedgerForm ledgerId={l.id} code={l.code} initial={initial} types={types} groups={groups} />
    </div>
  );
}
