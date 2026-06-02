import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { DeliveryChallanForm, EMPTY_DC, type DcFormValues, type DcItem } from '../dc-form';

export const metadata = { title: 'Edit Delivery Challan' };
export const dynamic = 'force-dynamic';

interface DcRow {
  id: number;
  code: string;
  dc_date: string;
  status: 'draft' | 'confirmed' | 'invoiced' | 'cancelled';
  production_mode: 'inhouse' | 'jobwork';
  party_id: number | null;
  ship_to_same: boolean;
  ship_to_party_id: number | null;
  bill_to_name: string | null;
  bill_to_address: string | null;
  bill_to_gstin: string | null;
  bill_to_state: string | null;
  bill_to_state_code: string | null;
  ship_to_name: string | null;
  ship_to_address: string | null;
  ship_to_gstin: string | null;
  ship_to_state: string | null;
  ship_to_state_code: string | null;
  vehicle_no: string | null;
  transport_mode: string | null;
  lr_no: string | null;
  lr_date: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  distance_km: number | string | null;
  notes: string | null;
}

interface DcItemRow {
  id: number;
  sno: number;
  fabric_quality_id: number | null;
  description: string | null;
  hsn: string | null;
  metres: number | string | null;
  pieces: number | null;
  bundles: number | null;
  rate_per_m: number | string | null;
}

export default async function EditDcPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const [hdrRes, itemsRes] = await Promise.all([
    sb.from('delivery_challan')
      .select('id, code, dc_date, status, production_mode, party_id, ship_to_same, ship_to_party_id, bill_to_name, bill_to_address, bill_to_gstin, bill_to_state, bill_to_state_code, ship_to_name, ship_to_address, ship_to_gstin, ship_to_state, ship_to_state_code, vehicle_no, transport_mode, lr_no, lr_date, driver_name, driver_phone, distance_km, notes')
      .eq('id', numericId)
      .maybeSingle(),
    sb.from('delivery_challan_item')
      .select('id, sno, fabric_quality_id, description, hsn, metres, pieces, bundles, rate_per_m')
      .eq('dc_id', numericId)
      .order('sno'),
  ]);

  const dc = hdrRes.data as DcRow | null;
  if (!dc) notFound();

  const itemRows = (itemsRes.data ?? []) as DcItemRow[];
  const items: DcItem[] = itemRows.length > 0
    ? itemRows.map((r) => ({
        id: r.id,
        sno: r.sno,
        fabric_quality_id: r.fabric_quality_id == null ? '' : String(r.fabric_quality_id),
        description: r.description ?? '',
        hsn: r.hsn ?? '',
        metres: r.metres == null ? '' : String(r.metres),
        pieces: r.pieces == null ? '' : String(r.pieces),
        bundles: r.bundles == null ? '' : String(r.bundles),
        rate_per_m: r.rate_per_m == null ? '' : String(r.rate_per_m),
      }))
    : EMPTY_DC.items;

  const initial: DcFormValues = {
    id: dc.id,
    code: dc.code,
    dc_date: dc.dc_date,
    status: dc.status,
    production_mode: dc.production_mode,
    party_id: dc.party_id != null ? String(dc.party_id) : '',
    ship_to_same: dc.ship_to_same,
    ship_to_party_id: dc.ship_to_party_id != null ? String(dc.ship_to_party_id) : '',
    bill_to_name:    dc.bill_to_name ?? '',
    bill_to_address: dc.bill_to_address ?? '',
    bill_to_gstin:   dc.bill_to_gstin ?? '',
    bill_to_state:   dc.bill_to_state ?? '',
    bill_to_state_code: dc.bill_to_state_code ?? '',
    ship_to_name:    dc.ship_to_name ?? '',
    ship_to_address: dc.ship_to_address ?? '',
    ship_to_gstin:   dc.ship_to_gstin ?? '',
    ship_to_state:   dc.ship_to_state ?? '',
    ship_to_state_code: dc.ship_to_state_code ?? '',
    vehicle_no:     dc.vehicle_no ?? '',
    transport_mode: dc.transport_mode ?? '',
    lr_no:          dc.lr_no ?? '',
    lr_date:        dc.lr_date ?? '',
    driver_name:    dc.driver_name ?? '',
    driver_phone:   dc.driver_phone ?? '',
    distance_km:    dc.distance_km == null ? '' : String(dc.distance_km),
    notes:          dc.notes ?? '',
    items,
  };

  return (
    <div>
      <PageHeader
        title={`Delivery Challan ${dc.code}`}
        crumbs={[
          { label: 'Delivery Challan', href: '/app/delivery-challan' },
          { label: dc.code },
        ]}
      />
      <DeliveryChallanForm initial={initial} />
    </div>
  );
}
