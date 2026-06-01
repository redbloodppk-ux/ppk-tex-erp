// /app/settings/fabric-types — CRUD for fabric_type_master.
//
// Lets the operator add new fabric types (e.g. "double cloth", "bedsheet")
// that show up in the Fabric Quality form's "Fabric type" dropdown. Uses
// the shared SimpleNameMaster so add/edit/delete + active toggle come for
// free.

import { SimpleNameMaster } from '@/app/components/simple-name-master';

export const metadata = { title: 'Fabric Types' };
export const dynamic = 'force-dynamic';

export default function FabricTypesPage(): React.ReactElement {
  return (
    <SimpleNameMaster
      tableName="fabric_type_master"
      title="Fabric Types"
      subtitle="Master list of fabric types (woven, towel, dupatta, etc.). Used by the Fabric Quality form."
      itemLabel="fabric type"
      codePlaceholder="FT-0001"
      crumbs={[
        { label: 'Settings', href: '/app/settings' },
        { label: 'Fabric Types' },
      ]}
    />
  );
}
