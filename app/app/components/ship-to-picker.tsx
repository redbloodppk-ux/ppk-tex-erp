'use client';
/**
 * ShipToPicker — optional consignee block shared by every invoice form.
 *
 * Unticked (default): goods ship to the bill-to party; the invoice
 * saves NULL ship_to fields and the print shows nothing extra.
 *
 * Ticked: a party dropdown (universal party master) appears. Picking a
 * party snapshots its name / address / GSTIN / state into the form so
 * the invoice stores exactly what was printed, even if the party master
 * changes later.
 */
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { SearchSelect, type SearchSelectOption } from '@/app/components/search-select';

export interface ShipToValue {
  enabled: boolean;
  party_id: number | null;
  name: string;
  address: string;
  gstin: string;
  state: string;
}

export const EMPTY_SHIP_TO: ShipToValue = {
  enabled: false, party_id: null, name: '', address: '', gstin: '', state: '',
};

/** Shape merged into the invoice insert/update payload. */
export function shipToPayload(v: ShipToValue): {
  ship_to_party_id: number | null;
  ship_to_name: string | null;
  ship_to_address: string | null;
  ship_to_gstin: string | null;
  ship_to_state: string | null;
} {
  if (!v.enabled || v.name.trim() === '') {
    return { ship_to_party_id: null, ship_to_name: null, ship_to_address: null, ship_to_gstin: null, ship_to_state: null };
  }
  return {
    ship_to_party_id: v.party_id,
    ship_to_name: v.name.trim(),
    ship_to_address: v.address.trim() || null,
    ship_to_gstin: v.gstin.trim() || null,
    ship_to_state: v.state.trim() || null,
  };
}

interface PartyRow {
  id: number; name: string; gstin: string | null; state: string | null;
  billing_address: string | null; shipping_address: string | null;
  address1: string | null; address2: string | null; address3: string | null; address4: string | null;
}

function partyAddress(p: PartyRow): string {
  const lines = [p.address1, p.address2, p.address3, p.address4]
    .map((l) => (l ?? '').trim())
    .filter((l) => l !== '');
  if (lines.length > 0) return lines.join('\n');
  return (p.shipping_address ?? p.billing_address ?? '').trim();
}

export function ShipToPicker({
  value,
  onChange,
}: {
  value: ShipToValue;
  onChange: (v: ShipToValue) => void;
}): React.ReactElement {
  const [parties, setParties] = useState<PartyRow[]>([]);
  const [loaded, setLoaded] = useState<boolean>(false);

  // Load SHIPPING parties lazily — only once the box is ticked. The
  // dropdown lists only parties whose type is "Shipping" (primary type
  // or one of the additional types), so the operator can't mis-ship to
  // a yarn mill or a broker. Add consignees under Parties with the
  // Shipping type to see them here.
  useEffect(() => {
    if (!value.enabled || loaded) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      // Resolve the "Shipping" party type id by name — no hardcoded id.
      const { data: typeRow } = await sb
        .from('party_type_master')
        .select('id')
        .ilike('name', 'shipping')
        .maybeSingle();
      const shippingTypeId: number | null = typeRow?.id ?? null;
      let q = sb
        .from('party')
        .select('id, name, gstin, state, billing_address, shipping_address, address1, address2, address3, address4')
        .eq('status', 'active')
        .order('name');
      if (shippingTypeId != null) {
        q = q.or(`party_type_id.eq.${shippingTypeId},party_type_ids.cs.{${shippingTypeId}}`);
      }
      const { data } = await q;
      if (!cancelled) {
        setParties((data ?? []) as PartyRow[]);
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [value.enabled, loaded]);

  const options: SearchSelectOption[] = parties.map((p) => ({
    value: String(p.id),
    label: p.gstin ? `${p.name} · ${p.gstin}` : p.name,
  }));

  function pickParty(id: string): void {
    if (id === '') {
      onChange({ ...value, party_id: null, name: '', address: '', gstin: '', state: '' });
      return;
    }
    const p = parties.find((x) => String(x.id) === id);
    if (!p) return;
    onChange({
      ...value,
      party_id: p.id,
      name: p.name,
      address: partyAddress(p),
      gstin: p.gstin ?? '',
      state: p.state ?? '',
    });
  }

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => onChange(e.target.checked ? { ...value, enabled: true } : { ...EMPTY_SHIP_TO })}
          className="w-4 h-4 accent-indigo-600"
        />
        <span className="font-medium">Ship to different address</span>
        <span className="text-xs text-ink-mute">(consignee differs from bill-to)</span>
      </label>

      {value.enabled && (
        <div className="rounded-lg border border-line/60 bg-cloud/30 p-3 space-y-2">
          <div>
            <label className="label">Shipping party</label>
            <SearchSelect
              options={options}
              value={value.party_id != null ? String(value.party_id) : ''}
              onChange={pickParty}
              placeholder={loaded ? 'Type to search shipping parties…' : 'Loading shipping parties…'}
              noMatchText="No shipping party found — add one under Parties with type 'Shipping'."
            />
            {loaded && parties.length === 0 && (
              <p className="text-[11px] text-amber-700 mt-1">
                No shipping parties yet. Add the consignee under Parties and set its type to &ldquo;Shipping&rdquo;.
              </p>
            )}
          </div>
          {value.name !== '' && (
            <div className="text-xs text-ink-soft space-y-0.5">
              <div className="font-semibold text-ink">{value.name}</div>
              {value.address !== '' && <div className="whitespace-pre-line">{value.address}</div>}
              <div>
                {value.gstin !== '' && <span>GSTIN: {value.gstin}</span>}
                {value.gstin !== '' && value.state !== '' && <span> · </span>}
                {value.state !== '' && <span>{value.state}</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
