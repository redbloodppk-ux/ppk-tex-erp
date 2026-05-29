/**
 * /app/costing/new is deprecated. The Quick Calculator at
 * /app/costing-calc now has an inline "Save & Submit for Approval"
 * panel that replaces this form. Any link or breadcrumb still pointing
 * here lands on the calculator.
 */
import { redirect } from 'next/navigation';

export default function DeprecatedNewCostingPage(): never {
  redirect('/app/costing-calc');
}
