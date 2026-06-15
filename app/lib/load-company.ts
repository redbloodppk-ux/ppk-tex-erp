/**
 * loadCompany — server-side helper that resolves the company profile
 * for every print template (invoice / DC / statement).
 *
 * Returns a merged object: `company_profile` row from the DB layered
 * on top of the static defaults in `lib/company.ts`. Any field the
 * operator hasn't filled in falls back to the legacy constant, so a
 * fresh install or a missing column never breaks the print.
 *
 * Used by:
 *   - /app/invoices/[id]/print
 *   - /app/delivery-challan/[id]/print
 *   - /app/parties/[id]/statement/print
 */
import { createClient } from '@/lib/supabase/server';
import { COMPANY } from '@/lib/company';

export interface CompanyData {
  name:    string;
  tagline: string;
  /** Multi-line address — what shows in the header / footer of prints. */
  address: string;
  state:   string;
  stateCode: string;
  gstin:   string;
  phones:  string[];
  email:   string;
  bank: {
    name:      string;
    accountNo: string;
    ifsc:      string;
    branch:    string;
  };
  declaration: string;
}

/** Stitch together a single-line address from the DB columns. Strips
 *  empty fragments and joins with ", " so missing values don't leave
 *  awkward double commas. */
function joinAddress(parts: Array<string | null | undefined>): string {
  return parts.map((p) => (p ?? '').trim()).filter((p) => p !== '').join(', ');
}

/** A subset of company_profile columns we read. Cast through
 *  `unknown` because the generated DB types lag the new bank columns. */
interface CompanyRow {
  legal_name:      string | null;
  display_name:    string | null;
  gstin:           string | null;
  state:           string | null;
  address_line1:   string | null;
  address_line2:   string | null;
  city:            string | null;
  pincode:         string | null;
  phone:           string | null;
  email:           string | null;
  bank_name:       string | null;
  bank_account_no: string | null;
  bank_ifsc:       string | null;
  bank_branch:     string | null;
}

/** Tamil Nadu = 33, Kerala = 32, etc. Lifted from the print page —
 *  only used as a fallback when the DB row doesn't carry the code. */
const STATE_CODE_BY_NAME: Record<string, string> = {
  'TAMIL NADU': '33',
  'TAMILNADU':  '33',
  'KERALA':     '32',
  'KARNATAKA':  '29',
  'ANDHRA PRADESH': '37',
};

function stateCodeFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin) return null;
  const m = /^(\d{2})/.exec(gstin.trim());
  return m && m[1] ? m[1] : null;
}

export async function loadCompany(): Promise<CompanyData> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data } = await sb
    .from('company_profile')
    .select('legal_name, display_name, gstin, state, address_line1, address_line2, city, pincode, phone, email, bank_name, bank_account_no, bank_ifsc, bank_branch')
    .limit(1)
    .maybeSingle();
  const row = (data ?? null) as CompanyRow | null;

  // Merge layered (DB column → lib/company default).
  const name    = (row?.display_name ?? row?.legal_name ?? '').trim() || COMPANY.name;
  const gstin   = (row?.gstin ?? '').trim().toUpperCase() || COMPANY.gstin;
  const state   = (row?.state ?? '').trim() || COMPANY.state;
  const stateCode =
    stateCodeFromGstin(gstin)
    ?? STATE_CODE_BY_NAME[state.toUpperCase()]
    ?? COMPANY.stateCode;

  const dbAddress = joinAddress([
    row?.address_line1,
    row?.address_line2,
    row?.city,
    row?.state,
    row?.pincode,
  ]);

  const phones: string[] = [];
  if (row?.phone && row.phone.trim() !== '') phones.push(row.phone.trim());
  // If no DB phone, keep both legacy fallback numbers for continuity.
  if (phones.length === 0) phones.push(...COMPANY.phones);

  return {
    name,
    tagline: COMPANY.tagline,
    address: dbAddress !== '' ? dbAddress : COMPANY.address,
    state,
    stateCode,
    gstin,
    phones,
    email: (row?.email ?? '').trim() || COMPANY.email,
    bank: {
      name:      (row?.bank_name       ?? '').trim() || COMPANY.bank.name,
      accountNo: (row?.bank_account_no ?? '').trim() || COMPANY.bank.accountNo,
      ifsc:      (row?.bank_ifsc       ?? '').trim().toUpperCase() || COMPANY.bank.ifsc,
      branch:    (row?.bank_branch     ?? '').trim() || COMPANY.bank.branch,
    },
    declaration: COMPANY.declaration,
  };
}
