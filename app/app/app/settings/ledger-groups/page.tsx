'use client';
import { SimpleNameMaster } from '@/app/components/simple-name-master';

export default function LedgerGroupsPage() {
  return (
    <SimpleNameMaster
      tableName="ledger_group"
      title="Ledger Groups"
      subtitle="Account groups for the P&L / Balance Sheet (SUNDRY CREDITORS, SUNDRY DEBTORS, etc.). Code auto-generated."
      itemLabel="ledger group"
      codePlaceholder="Auto (LG-NNNN)"
      crumbs={[
        { label: 'Settings', href: '/app/settings' },
        { label: 'Ledger Groups' },
      ]}
    />
  );
}
