import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Printer } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import {
  DeliveryChallanForm,
  EMPTY_DC,
  type DcFormValues,
  type DcItem,
  type Bundle,
} from '../dc-form';

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
  notes: string | null;
}

interface BundleDetailJson {
  sno?: number;
  pieces?: Array<number | string>;
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
  bundles_detail: BundleDetailJson[] | null;
}

/**
 * Convert the JSON stored in `bundles_detail` back into the controlled-form
 * shape the form uses (string piece values, sequential sno).
 *
 * Fallback: if the row pre-dates migration 083 (bundles_detail is null), we
 * synthesise N bundles from the legacy `bundles` count and put one empty
 * piece slot in each so the operator can re-enter the breakdown.
 */
function hydrateBundles(row: DcItemRow): Bundle[] {
  if (Array.isArray(row.bundles_detail) && row.bundles_detail.length > 0) {
    return row.bundles_detail.map((b, idx): Bundle => {
      const rawPieces = Array.isArray(b?.pieces) ? b.pieces : [];
      const pieces = rawPieces
        .map((p) => (p == null ? '' : String(p)))
        .filter((p) => p.trim() !== '');
      return {
        sno: typeof b?.sno === 'number' ? b.sno : idx + 1,
        pieces: pieces.length > 0 ? pieces : [''],
      };
    });
  }

  // Legacy fallback: synthesise empty bundles so the count survives the edit.
  const count = Math.max(1, Number(row.bundles ?? 0) || 1);
  const out: Bundle[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({ sno: i + 1, pieces: [''] });
  }
  return out;
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
      .select('id, code, dc_date, status, production_mode, party_id, ship_to_same, ship_to_party_id, bill_to_name, bill_to_address, bill_to_gstin, bill_to_state, bill_to_state_code, ship_to_name, ship_to_address, ship_to_gstin, ship_to_state, ship_to_state_code, vehicle_no, notes')
      .eq('id', numericId)
      .maybeSingle(),
    sb.from('delivery_challan_item')
      .select('id, sno, fabric_quality_id, description, hsn, metres, pieces, bundles, bundles_detail')
      .eq('dc_id', numericId)
      .order('sno'),
  ]);

  const dc = hdrRes.data as DcRow | null;
  if (!dc) notFound();

  const itemRows = (itemsRes.data ?? []) as DcItemRow[];
  const items: DcItem[] = itemRows.length > 0
    ? itemRows.map((r): DcItem => ({
        id: r.id,
        sno: r.sno,
        fabric_quality_id: r.fabric_quality_id == null ? '' : String(r.fabric_quality_id),
        description: r.description ?? '',
        hsn: r.hsn ?? '',
        bundles: hydrateBundles(r),
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
    vehicle_no:      dc.vehicle_no ?? '',
    notes:           dc.notes ?? '',
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
        actions={
          <Link
            href={`/app/delivery-challan/${dc.id}/print`}
            target="_blank"
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60"
            title="View / Print / Download PDF"
          >
            <Printer className="w-3.5 h-3.5" /> View / Print / PDF
          </Link>
        }
      />
      <DeliveryChallanForm initial={initial} />
    </div>
  );
}
