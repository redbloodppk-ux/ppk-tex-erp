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

async function fetchFromProvider(gstin: string): Promise<GstinData> {
  // TODO(real-api): replace this body with a fetch() to AppyFlow / Sandbox / Surepass.
  // Read API key from process.env.GST_API_KEY (server-only). Map provider's response
  // shape onto GstinData. Cache successful lookups for 24h to avoid burning credits.

  // Simulate network latency so the loading UI is visible.
  await new Promise((r) => setTimeout(r, 600));

  const stateCode = gstin.slice(0, 2);
  const state = STATE_BY_CODE[stateCode] ?? '';

  const sample = SAMPLES[gstin];
  if (sample) {
    return {
      gstin,
      ...sample,
      address: { ...sample.address, state, state_code: stateCode },
    };
  }

  // Generic fallback — real API would return "GSTIN not found" if invalid, but for
  // mock purposes we generate a plausible record so any valid-format GSTIN works.
  return {
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
    const data = await fetchFromProvider(gstin);
    return NextResponse.json({ ok: true, mocked: true, data });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Lookup failed' },
      { status: 502 }
    );
  }
}
