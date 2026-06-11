/**
 * E-Way Bill GSP provider adapter.
 *
 * Talks to a GSP (GST Suvidha Provider) REST API to generate e-way
 * bills directly from the app. Configured entirely through environment
 * variables so credentials never live in code:
 *
 *   EWB_PROVIDER       'mastergst' (default and only adapter today)
 *   EWB_API_BASE       e.g. https://api.mastergst.com
 *   EWB_EMAIL          GSP account e-mail
 *   EWB_USERNAME       e-way bill API username  (from ewaybillgst.gov.in → Registration → For GSP)
 *   EWB_PASSWORD       e-way bill API password
 *   EWB_CLIENT_ID      GSP client id
 *   EWB_CLIENT_SECRET  GSP client secret
 *   EWB_GSTIN          your GSTIN (must match company profile)
 *   EWB_AUTH_PATH      optional override, default /ewaybillapi/v1.03/authenticate
 *   EWB_GEN_PATH       optional override, default /ewaybillapi/v1.03/ewayapi/genewaybill
 *
 * The request/response shapes follow the NIC EWB v1.03 spec that every
 * GSP proxies; minor differences between GSPs can be absorbed with the
 * path overrides above.
 */

export interface EwbItem {
  productName: string;
  productDesc: string;
  hsnCode: string;
  quantity: number;
  qtyUnit: string;
  taxableAmount: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cessRate: number;
}

export interface EwbPayload {
  supplyType: 'O';
  subSupplyType: string;     // '1' = Supply
  docType: 'INV';
  docNo: string;
  docDate: string;           // DD/MM/YYYY
  fromGstin: string;
  fromTrdName: string;
  fromAddr1: string;
  fromAddr2: string;
  fromPlace: string;
  fromPincode: number;
  actFromStateCode: number;
  fromStateCode: number;
  toGstin: string;           // 'URP' for unregistered
  toTrdName: string;
  toAddr1: string;
  toAddr2: string;
  toPlace: string;
  toPincode: number;
  actToStateCode: number;
  toStateCode: number;
  transactionType: number;   // 1 = Regular
  totalValue: number;
  cgstValue: number;
  sgstValue: number;
  igstValue: number;
  cessValue: number;
  totInvValue: number;
  transMode: string;         // '1' Road
  transDistance: string;     // km
  transporterId: string;
  transporterName: string;
  vehicleNo: string;
  vehicleType: 'R' | 'O';
  itemList: EwbItem[];
}

export interface EwbResult {
  ok: boolean;
  ewbNo?: string;
  ewbDate?: string;       // YYYY-MM-DD
  validUpto?: string;     // YYYY-MM-DD
  raw?: unknown;
  error?: string;
}

interface EwbConfig {
  provider: string;
  base: string;
  email: string;
  username: string;
  password: string;
  clientId: string;
  clientSecret: string;
  gstin: string;
  authPath: string;
  genPath: string;
}

export function loadEwbConfig(): { config: EwbConfig | null; missing: string[] } {
  const required: Record<string, string | undefined> = {
    EWB_API_BASE: process.env.EWB_API_BASE,
    EWB_EMAIL: process.env.EWB_EMAIL,
    EWB_USERNAME: process.env.EWB_USERNAME,
    EWB_PASSWORD: process.env.EWB_PASSWORD,
    EWB_CLIENT_ID: process.env.EWB_CLIENT_ID,
    EWB_CLIENT_SECRET: process.env.EWB_CLIENT_SECRET,
    EWB_GSTIN: process.env.EWB_GSTIN,
  };
  const missing = Object.entries(required).filter(([, v]) => !v || v.trim() === '').map(([k]) => k);
  if (missing.length > 0) return { config: null, missing };
  return {
    config: {
      provider: process.env.EWB_PROVIDER ?? 'mastergst',
      base: (process.env.EWB_API_BASE as string).replace(/\/+$/, ''),
      email: process.env.EWB_EMAIL as string,
      username: process.env.EWB_USERNAME as string,
      password: process.env.EWB_PASSWORD as string,
      clientId: process.env.EWB_CLIENT_ID as string,
      clientSecret: process.env.EWB_CLIENT_SECRET as string,
      gstin: process.env.EWB_GSTIN as string,
      authPath: process.env.EWB_AUTH_PATH ?? '/ewaybillapi/v1.03/authenticate',
      genPath: process.env.EWB_GEN_PATH ?? '/ewaybillapi/v1.03/ewayapi/genewaybill',
    },
    missing: [],
  };
}

/** NIC dates arrive as 'DD/MM/YYYY hh:mm:ss AM/PM' or 'DD/MM/YYYY' —
 *  normalise to YYYY-MM-DD for our date columns. */
function nicDateToISO(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.trim() === '') return undefined;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(v.trim());
  if (!m) return undefined;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Generate an e-way bill through the configured GSP. */
export async function generateEwaybill(payload: EwbPayload): Promise<EwbResult> {
  const { config, missing } = loadEwbConfig();
  if (!config) {
    return {
      ok: false,
      error: 'GSP credentials not configured. Add these environment variables in Vercel and redeploy: ' + missing.join(', '),
    };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    username: config.username,
    password: config.password,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    gstin: config.gstin,
  };
  const emailQ = `?email=${encodeURIComponent(config.email)}`;

  try {
    // 1. Authenticate — MasterGST returns the auth token in the body
    //    and/or expects the same headers on subsequent calls.
    const authRes = await fetch(config.base + config.authPath + emailQ, { method: 'GET', headers });
    const authJson: Record<string, unknown> = await authRes.json().catch(() => ({}));
    const statusCd = String((authJson['status_cd'] ?? authJson['status'] ?? '')).toLowerCase();
    if (!authRes.ok || statusCd === '0' || statusCd === 'failure') {
      return { ok: false, raw: authJson, error: 'GSP authentication failed: ' + JSON.stringify(authJson).slice(0, 400) };
    }
    const authData = (authJson['data'] ?? {}) as Record<string, unknown>;
    const authToken = String(authData['authtoken'] ?? authData['AuthToken'] ?? authJson['authtoken'] ?? '');
    if (authToken !== '') headers['auth-token'] = authToken;

    // 2. Generate.
    const genRes = await fetch(config.base + config.genPath + emailQ, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const genJson: Record<string, unknown> = await genRes.json().catch(() => ({}));
    const genStatus = String((genJson['status_cd'] ?? genJson['status'] ?? '')).toLowerCase();
    const data = (genJson['data'] ?? genJson) as Record<string, unknown>;
    const ewbNoRaw = data['ewayBillNo'] ?? data['ewbNo'] ?? data['EwbNo'];
    if (!genRes.ok || genStatus === '0' || genStatus === 'failure' || ewbNoRaw == null) {
      return { ok: false, raw: genJson, error: 'E-way bill generation failed: ' + JSON.stringify(genJson).slice(0, 600) };
    }
    return {
      ok: true,
      ewbNo: String(ewbNoRaw),
      ewbDate: nicDateToISO(data['ewayBillDate']),
      validUpto: nicDateToISO(data['validUpto']),
      raw: genJson,
    };
  } catch (e: unknown) {
    return { ok: false, error: 'GSP call failed: ' + (e instanceof Error ? e.message : String(e)) };
  }
}

/** GST state name → state code, used when a GSTIN isn't available to
 *  read the code from. Covers the states a TN textile mill trades with;
 *  extend as needed. */
export const GST_STATE_CODES: Record<string, number> = {
  'jammu and kashmir': 1, 'himachal pradesh': 2, 'punjab': 3, 'chandigarh': 4,
  'uttarakhand': 5, 'haryana': 6, 'delhi': 7, 'rajasthan': 8, 'uttar pradesh': 9,
  'bihar': 10, 'sikkim': 11, 'arunachal pradesh': 12, 'nagaland': 13, 'manipur': 14,
  'mizoram': 15, 'tripura': 16, 'meghalaya': 17, 'assam': 18, 'west bengal': 19,
  'jharkhand': 20, 'odisha': 21, 'chhattisgarh': 22, 'madhya pradesh': 23,
  'gujarat': 24, 'maharashtra': 27, 'andhra pradesh': 37, 'karnataka': 29,
  'goa': 30, 'lakshadweep': 31, 'kerala': 32, 'tamil nadu': 33, 'puducherry': 34,
  'andaman and nicobar islands': 35, 'telangana': 36, 'ladakh': 38,
};

export function stateCodeFor(gstin: string | null | undefined, stateName: string | null | undefined): number {
  const g = (gstin ?? '').trim();
  if (/^\d{2}/.test(g)) {
    const n = Number(g.slice(0, 2));
    if (n > 0) return n;
  }
  const s = (stateName ?? '').trim().toLowerCase();
  return GST_STATE_CODES[s] ?? 33; // default Tamil Nadu (company home state)
}

/** Map an invoice line UOM to the closest GST UQC. */
export function uqcFor(uom: string | null | undefined): string {
  const u = (uom ?? '').trim().toLowerCase();
  if (u === 'mtr' || u === 'm' || u === 'metre' || u === 'metres') return 'MTR';
  if (u === 'pcs' || u === 'pc' || u === 'piece' || u === 'pieces') return 'PCS';
  if (u === 'nos' || u === 'no' || u === 'unit' || u === 'units') return 'NOS';
  if (u === 'kg' || u === 'kgs') return 'KGS';
  return 'OTH';
}
