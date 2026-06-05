// MillForm is retired with the mill table (migration 098). It used to
// be a shared form for /app/mills/new and /app/mills/[id], both of
// which now just redirect to the unified Parties page. The exports
// below are kept as no-op stubs so any stale imports still typecheck.

export interface MillFormValues {
  name: string;
  gstin: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  state_code: string;
  is_preferred: boolean;
  notes: string;
  status: 'active' | 'inactive' | 'archived';
}

export interface MillFormProps {
  millId?: number;
  initial?: MillFormValues;
  code?: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function MillForm(_props: MillFormProps = {}): null {
  // The mill table no longer exists. This stub is intentionally empty;
  // callers (now removed) used to render an edit/create form here.
  return null;
}
