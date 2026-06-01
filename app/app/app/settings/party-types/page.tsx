// /app/settings/party-types — CRUD for party_type_master.
//
// Drives the Party Type dropdown on /app/parties. Add new categories
// here (e.g. "Cone Supplier", "Trader") and they show up on the unified
// Party master.

import { SimpleNameMaster } from '@/app/components/simple-name-master';

export const metadata = { title: 'Party Types' };
export const dynamic = 'force-dynamic';

export default function PartyTypesPage(): React.ReactElement {
  return (
    <SimpleNameMaster
      tableName="party_type_master"
      title="Party Types"
      subtitle="Categories shown on the Party master dropdown - Customer, Mill, Jobwork, Sizing, etc."
      itemLabel="party type"
      codePlaceholder="PT-0001"
      crumbs={[
        { label: 'Settings', href: '/app/settings' },
        { label: 'Party Types' },
      ]}
    />
  );
}
