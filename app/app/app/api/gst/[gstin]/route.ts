// GET /api/gst/:gstin
//
// Returns mock GSTIN lookup data. Same response shape as a real GST verification API
// would return (after we normalize it). To switch to a real provider later, swap the
// body of `fetchFromProvider()` — nothing else changes.
//
// Mock behavior:
//   - Validates GSTIN format (15 chars: 2 digits + 5 letters + 4 digits + 1 letter + 1 alphanum + 'Z' + 1 alphanum)
//   - If GSTIN matches a known sample, returns a rich fake record
//   - Otherwise returns a generic record with state derived from the first 2 digits
//
// Real-provider swap-in points are marked with TODO(real-api).

import { NextResponse } from 'next/server';

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/;

// First-2-digit state code → state name (per GST state-code list)
const STATE_BY_CODE: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab',
  '04': 'Chandigarh',        '05': 'Uttarakhand',      '06': 'Haryana',
  '07': 'Delhi',             '08': 'Rajasthan',        '09': 'Uttar Pradesh',
  '10': 'Bihar',             '11': 'Sikkim',           '12': 'Arunachal Pradesh',
  '13': 'Nagaland',          '14': 'Manipur',          '15': 'Mizoram',
  '16': 'Tripura',           '17': 'Meghalaya',        '18': 'Assam',
  '19': 'West Bengal',       '20': 'Jharkhand',        '21': 'Odisha',
  '22': 'Chhattisgarh',      '23': 'Madhya Pradesh',   '24': 'Gujarat',
  '25': 'Daman and Diu',     '26': 'Dadra and Nagar Haveli', '27': 'Maharashtra',
  '28': 'Andhra Pradesh (Old)', '29': 'Karnataka',     '30': 'Goa',
  '31': 'Lakshadweep',       '32': 'Kerala',           '33': 'Tamil Nadu',
  '34': 'Puducherry',        '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',         '37': 'Andhra Pradesh',   '38': 'Ladakh',
};

// Hardcoded sample responses for testing — paste these into the form to see auto-fill
// in action. Real lookups will replace these.
const SAMPLES: Record<string, Omit<GstinData, 'gstin' | 'address'> & { address: Omit<NonNullable<GstinData['address']>, 'state' | 'state_code'> }> = {
  '33AABCU9603R1ZX': {
    legal_name: 'PPK TEXTILES INDUSTRIES',
    trade_name: 'PPK Tex',
    status: 'Active',
    constitution: 'Partnership',
    taxpayer_type: 'Regular',
    registration_date: '2017-07-01',
    nature_of_business: ['Manufacturer', 'Wholesale Business'],
    address: {
      building: '12/3-A',
      street: 'SIDCO Industrial Estate',
      locality: 'Kurichi',
      city: 'Coimbatore',
      district: 'Coimbatore',
      pincode: '641021',
    },
  },
  '29AABCS1429B1Z1': {
    legal_name: 'SREE LAKSHMI WEAVERS PRIVATE LIMITED',
    trade_name: 'Sree Lakshmi Weavers',
    status: 'Active',
    constitution: 'Private Limited',
    taxpayer_type: 'Regular',
    registration_date: '2018-04-15',
    nature_of_business: ['Manufacturer'],
    address: {
      building: '45',
      street: 'MG Road',
      locality: 'Peenya',
      city: 'Bengaluru',
      district: 'Bengaluru Urban',
      pincode: '560058',
    },
  },
  '27AABCT3518Q1ZP': {
    legal_name: 'BHARAT GARMENT EXPORTS LLP',
    trade_name: 'Bharat Garment',
    status: 'Active',
    constitution: 'Limited Liability Partnership',
    taxpayer_type: 'Regular',
    registration_date: '2019-09-21',
    nature_of_business: ['Exporter', 'Wholesale Business'],
    address: {
      building: 'Unit 4',
      street: 'Andheri Industrial Estate',
      locality: 'Andheri East',
      city: 'Mumbai',
      district: 'Mumbai Suburban',
      pincode: '400069',
    },
  },
};

export type GstinAddress = {
  building?: string;
  street?: string;
  locality?: string;
  city?: string;
  district?: string;
  state?: string;
  state_code?: string;
  pincode?: string;
};

export type GstinData = {
  gstin: string;
  legal_name: string;
  trade_name?: string | null;
  status?: string;
  constitution?: string;
  taxpayer_type?: string;
  registration_date?: string;
  nature_of_business?: string[];
  address?: GstinAddress;
};

// AppyFlow response shape we care about. Fields we don't use are omitted.
// See https://appyflow.in/gst-verification-api for full schema.
interface AppyFlowAddress {
  bnm?: string;   // building name
  bno?: string;   // building number
  st?: string;    // street
  loc?: string;   // locality
  city?: string;
  dst?: string;   // district
  stcd?: string;  // state
  pncd?: string;  // pincode
}
interface AppyFlowTaxpayer {
  gstin?: string;       // GSTIN that was actually resolved
  lgnm?: string;        // legal name
  tradeNam?: string;    // trade name
  sts?: string;         // status (Active / Cancelled / ...)
  ctb?: string;         // constitution of business
  dty?: string;         // dealer / taxpayer type
  rgdt?: string;        // registration date (DD/MM/YYYY)
  nba?: string[];       // nature of business activities
  pradr?: { addr?: AppyFlowAddress };
}
interface AppyFlowResponse {
  taxpayerInfo?: AppyFlowTaxpayer;
  error?: boolean;
  message?: string;
}

/** Normalise AppyFlow's DD/MM/YYYY date to ISO YYYY-MM-DD. */
function normaliseDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return s; // already in some other format, pass through
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

type ProviderResult =
  | { ok: true; data: GstinData }
  | { ok: false; error: string };

async function callAppyFlow(gstin: string, apiKey: string): Promise<ProviderResult> {
  // 8s timeout so the operator isn't stuck waiting on a slow provider.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const url = `https://appyflow.in/api/verifyGST?gstNo=${encodeURIComponent(gstin)}&key_secret=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { signal: controller.signal });

    // Read the body once as text so we can return a useful error even when
    // the response isn't JSON (HTML error pages from upstream, etc).
    const raw = await res.text();
    let json: AppyFlowResponse | null = null;
    try { json = raw ? (JSON.parse(raw) as AppyFlowResponse) : null; } catch { /* not JSON */ }

    // Server-side log so the raw response is visible in Vercel function
    // logs. Helps diagnose situations where AppyFlow returns a 200 with a
    // demo / placeholder record instead of the queried business's data.
    // eslint-disable-next-line no-console
    console.log('[gst] AppyFlow', gstin, 'status', res.status, 'body', raw.slice(0, 600));

    if (!res.ok) {
      const snippet = (json?.message ?? raw ?? '').slice(0, 200);
      return { ok: false, error: `AppyFlow HTTP ${res.status}: ${snippet || 'no body'}` };
    }
    if (!json) {
      return { ok: false, error: `AppyFlow returned a non-JSON response: ${raw.slice(0, 200)}` };
    }
    // AppyFlow signals "key invalid", "quota exceeded", "GSTIN not found", etc.
    // by setting error=true and putting the reason in message.
    if (json.error === true || !json.taxpayerInfo) {
      return { ok: false, error: json.message ?? 'GSTIN not found by AppyFlow.' };
    }

    const t = json.taxpayerInfo;

    // Guard against AppyFlow returning a placeholder / sample record
    // ("AppyFlow Technologies" etc) when the key is invalid or the
    // trial quota is exhausted. If the GSTIN that came back doesn't
    // match what we asked for, treat as an error and force the operator
    // to renew their plan instead of accepting fake data.
    if (t.gstin && t.gstin.toUpperCase() !== gstin) {
      return {
        ok: false,
        error: `AppyFlow returned a different GSTIN (${t.gstin}) than requested (${gstin}). This usually means the API key is invalid or the free-trial quota is exhausted.`,
      };
    }
    if (!t.gstin && /appyflow/i.test(t.lgnm ?? '')) {
      return {
        ok: false,
        error: 'AppyFlow returned its own placeholder record. The API key is likely invalid or the free-trial quota is exhausted - check the AppyFlow dashboard.',
      };
    }
    const addr = t.pradr?.addr ?? {};
    const stateCode = gstin.slice(0, 2);
    const state = addr.stcd ?? STATE_BY_CODE[stateCode] ?? '';

    return {
      ok: true,
      data: {
        gstin,
        legal_name: t.lgnm ?? '',
        trade_name: t.tradeNam ?? null,
        status: t.sts,
        constitution: t.ctb,
        taxpayer_type: t.dty,
        registration_date: normaliseDate(t.rgdt),
        nature_of_business: Array.isArray(t.nba) ? t.nba : undefined,
        address: {
          building: [addr.bno, addr.bnm].filter(Boolean).join(' ').trim() || undefined,
          street: addr.st,
          locality: addr.loc,
          city: addr.city,
          district: addr.dst,
          state,
          state_code: stateCode,
          pincode: addr.pncd,
        },
      },
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `AppyFlow request failed: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFromProvider(
  gstin: string,
): Promise<{ data?: GstinData; mocked: boolean; error?: string }> {
  // Real provider path — only runs when GST_API_KEY is set (in Vercel env).
  // When set, we DO NOT fall back to mock on failure: surface the real
  // error so the operator can fix the key / quota / etc.
  const apiKey = process.env.GST_API_KEY;
  if (apiKey && apiKey.trim() !== '') {
    const real = await callAppyFlow(gstin, apiKey);
    if (real.ok) return { data: real.data, mocked: false };
    return { error: real.error, mocked: false };
  }

  // Mock path — only used when GST_API_KEY is NOT set (i.e. dev / preview).
  await new Promise((r) => setTimeout(r, 600));
  const stateCode = gstin.slice(0, 2);
  const state = STATE_BY_CODE[stateCode] ?? '';

  const sample = SAMPLES[gstin];
  if (sample) {
    return {
      data: { gstin, ...sample, address: { ...sample.address, state, state_code: stateCode } },
      mocked: true,
    };
  }

  return {
    data: {
      gstin,
      legal_name: `[Mock] Business linked to ${gstin}`,
      trade_name: null,
      status: 'Active',
      constitution: 'Private Limited',
      taxpayer_type: 'Regular',
      registration_date: '2020-01-01',
      nature_of_business: [],
      address: {
        building: '',
        street: '',
        locality: '',
        city: stateCode === '33' ? 'Coimbatore' : '',
        district: '',
        state,
        state_code: stateCode,
        pincode: '',
      },
    },
    mocked: true,
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ gstin: string }> }
) {
  const { gstin: raw } = await params;
  const gstin = String(raw ?? '').toUpperCase().trim();

  if (!GSTIN_REGEX.test(gstin)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Invalid GSTIN format. Expected 15 chars: 2 digits + 5 letters + 4 digits + 1 letter + 1 alphanumeric + Z + 1 alphanumeric.',
      },
      { status: 400 }
    );
  }

  try {
    const result = await fetchFromProvider(gstin);
    if (result.error || !result.data) {
      return NextResponse.json(
        { ok: false, error: result.error ?? 'GSTIN lookup failed.' },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, mocked: result.mocked, data: result.data });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Lookup failed' },
      { status: 502 }
    );
  }
}
