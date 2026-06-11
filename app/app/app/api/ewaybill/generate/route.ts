/**
 * POST /app/api/ewaybill/generate
 *
 * Body: { invoice_id, vehicle_no, distance_km, transporter_id?,
 *         transporter_name?, trans_mode? }
 *
 * Builds the NIC e-way bill payload from the invoice + company profile,
 * generates it through the configured GSP (lib/ewaybill/provider), and
 * on success AUTO-UPDATES the invoice's ewaybill_no / ewaybill_date /
 * ewaybill_valid_till columns — the card and the invoice print pick the
 * number up from there.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateEwaybill, stateCodeFor, uqcFor, type EwbPayload, type EwbItem } from '@/lib/ewaybill/provider';

export const dynamic = 'force-dynamic';

interface GenerateBody {
  invoice_id?: number;
  vehicle_no?: string;
  distance_km?: number | string;
  transporter_id?: string;
  transporter_name?: string;
  trans_mode?: string;
}

function ddmmyyyy(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: GenerateBody;
  try {
    body = (await req.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }
  const invoiceId = Number(body.invoice_id);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    return NextResponse.json({ ok: false, error: 'invoice_id is required.' }, { status: 400 });
  }
  const vehicleNo = (body.vehicle_no ?? '').trim().toUpperCase().replace(/\s+/g, '');
  const distance = String(Math.max(0, Math.trunc(Number(body.distance_km ?? 0))));
  if (vehicleNo === '') {
    return NextResponse.json({ ok: false, error: 'Vehicle number is required for a road e-way bill.' }, { status: 400 });
  }

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const [invRes, cpRes] = await Promise.all([
    sb.from('invoice')
      .select(`
        id, invoice_no, invoice_date, doc_type, status, total, taxable_value,
        cgst_amount, sgst_amount, igst_amount, is_interstate,
        party_name, party_gstin, party_state, place_of_supply, ewaybill_no,
        customer:customer_id ( name, gstin, state, billing_address ),
        lines:invoice_line ( description, hsn_sac, uom, quantity, taxable_amount, gst_rate_pct )
      `)
      .eq('id', invoiceId)
      .maybeSingle(),
    sb.from('company_profile')
      .select('legal_name, display_name, gstin, address_line1, address_line2, city, state, pincode')
      .limit(1)
      .maybeSingle(),
  ]);

  const inv = invRes.data;
  if (!inv) return NextResponse.json({ ok: false, error: 'Invoice not found.' }, { status: 404 });
  if (inv.ewaybill_no) {
    return NextResponse.json({ ok: false, error: `Invoice already has e-way bill ${inv.ewaybill_no}. Clear it first to regenerate.` }, { status: 409 });
  }
  if (!['tax_invoice', 'yarn_sale', 'general_sale'].includes(inv.doc_type)) {
    return NextResponse.json({ ok: false, error: 'E-way bills are generated for customer sales invoices only.' }, { status: 400 });
  }
  const cp = cpRes.data;
  if (!cp?.gstin) {
    return NextResponse.json({ ok: false, error: 'Company GSTIN missing — fill it in Settings → Company Profile first.' }, { status: 400 });
  }

  type Line = { description: string; hsn_sac: string | null; uom: string; quantity: number | string; taxable_amount: number | string; gst_rate_pct: number | string };
  const lines = ((inv.lines ?? []) as Line[]);
  if (lines.length === 0) {
    return NextResponse.json({ ok: false, error: 'Invoice has no line items.' }, { status: 400 });
  }

  const interstate: boolean = inv.is_interstate === true;
  const itemList: EwbItem[] = lines.map((l) => {
    const rate = Number(l.gst_rate_pct ?? 0);
    return {
      productName: String(l.description ?? 'Goods').slice(0, 100),
      productDesc: String(l.description ?? '').slice(0, 100),
      hsnCode: String(l.hsn_sac ?? '5208').replace(/\D/g, '') || '5208',
      quantity: Number(l.quantity ?? 0),
      qtyUnit: uqcFor(l.uom),
      taxableAmount: Number(l.taxable_amount ?? 0),
      cgstRate: interstate ? 0 : rate / 2,
      sgstRate: interstate ? 0 : rate / 2,
      igstRate: interstate ? rate : 0,
      cessRate: 0,
    };
  });

  const fromState = stateCodeFor(cp.gstin, cp.state);
  const partyGstin = (inv.customer?.gstin ?? inv.party_gstin ?? '').trim();
  const toState = stateCodeFor(partyGstin, inv.party_state ?? inv.place_of_supply);

  const payload: EwbPayload = {
    supplyType: 'O',
    subSupplyType: '1',
    docType: 'INV',
    docNo: String(inv.invoice_no),
    docDate: ddmmyyyy(String(inv.invoice_date)),
    fromGstin: String(cp.gstin).trim(),
    fromTrdName: String(cp.legal_name ?? cp.display_name ?? ''),
    fromAddr1: String(cp.address_line1 ?? ''),
    fromAddr2: String(cp.address_line2 ?? ''),
    fromPlace: String(cp.city ?? ''),
    fromPincode: Number(String(cp.pincode ?? '0').replace(/\D/g, '')) || 0,
    actFromStateCode: fromState,
    fromStateCode: fromState,
    toGstin: partyGstin !== '' ? partyGstin : 'URP',
    toTrdName: String(inv.party_name ?? inv.customer?.name ?? ''),
    toAddr1: String(inv.customer?.billing_address ?? '').slice(0, 100),
    toAddr2: '',
    toPlace: String(inv.place_of_supply ?? inv.party_state ?? ''),
    toPincode: 0,
    actToStateCode: toState,
    toStateCode: toState,
    transactionType: 1,
    totalValue: Number(inv.taxable_value ?? 0),
    cgstValue: Number(inv.cgst_amount ?? 0),
    sgstValue: Number(inv.sgst_amount ?? 0),
    igstValue: Number(inv.igst_amount ?? 0),
    cessValue: 0,
    totInvValue: Number(inv.total ?? 0),
    transMode: (body.trans_mode ?? '1').trim() || '1',
    transDistance: distance,
    transporterId: (body.transporter_id ?? '').trim(),
    transporterName: (body.transporter_name ?? '').trim(),
    vehicleNo,
    vehicleType: 'R',
    itemList,
  };

  const result = await generateEwaybill(payload);
  if (!result.ok || !result.ewbNo) {
    // 501 when simply not configured, 502 when the GSP rejected it.
    const notConfigured = (result.error ?? '').includes('not configured');
    return NextResponse.json({ ok: false, error: result.error ?? 'Generation failed.' }, { status: notConfigured ? 501 : 502 });
  }

  // AUTO-UPDATE the invoice — this is what the card and the print read.
  const { error: upErr } = await sb
    .from('invoice')
    .update({
      ewaybill_no: result.ewbNo,
      ewaybill_date: result.ewbDate ?? String(inv.invoice_date),
      ewaybill_valid_till: result.validUpto ?? null,
      ewaybill_notes: `Generated via GSP API · vehicle ${vehicleNo}${distance !== '0' ? ` · ${distance} km` : ''}`,
    })
    .eq('id', invoiceId);
  if (upErr) {
    return NextResponse.json({
      ok: true,
      ewb_no: result.ewbNo,
      warning: `E-way bill ${result.ewbNo} generated, but saving to the invoice failed: ${upErr.message}. Enter it manually.`,
    });
  }

  return NextResponse.json({
    ok: true,
    ewb_no: result.ewbNo,
    ewb_date: result.ewbDate ?? null,
    valid_upto: result.validUpto ?? null,
  });
}
