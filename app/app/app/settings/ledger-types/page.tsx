'use client';
import { SimpleNameMaster } from '@/app/components/simple-name-master';

export default function LedgerTypesPage() {
  return (
    <SimpleNameMaster
      tableName="ledger_type"
      title="Ledger Types"
      subtitle="Categorise ledgers (SUPPLIER, CUSTOMER, TAX, AGENT, BANK, etc.). Code auto-generated."
      itemLabel="ledger type"
      codePlaceholder="Auto (LT-NNNN)"
      crumbs={[
        { label: 'Settings', href: '/app/settings' },
        { label: 'Ledger Types' },
      ]}
    />
  );
}
