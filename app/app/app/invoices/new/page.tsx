'use client';
/**
 * New Invoice — supports 5 doc types.
 *
 *   tax_invoice   → fabric sale  (from Sales Order or from Fabric Stock)
 *   yarn_sale     → yarn outward (picks yarn_lot, auto-deducts stock)
 *   general_sale  → rental / scrap / services (free-form lines)
 *   credit_note   → sales return (picks original invoice, ticks return lines)
 *   debit_note    → purchase return (against a vendor + free-text supplier bill)
 *
 * Tax math: company state = customer state → CGST + SGST.
 *           Otherwise (interstate) → IGST.
 *           Each line carries its own GST %.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { SearchSelect, type SearchSelectOption } from '@/app/components/search-select';
import { ShipToPicker, shipToPayload, EMPTY_SHIP_TO, type ShipToValue } from '@/app/components/ship-to-picker';
import { useColumnHistory } from '@/app/components/use-column-history';
import { UnpaidBillsPicker, splitAllocationsByKind, type BillAllocation, type SelectedBill } from '@/app/components/unpaid-bills-picker';
import { Plus, Trash2, FileText, Coins, Briefcase, RotateCcw, ArrowDownLeft } from 'lucide-react';

type DocType = 'tax_invoice' | 'yarn_sale' | 'general_sale' | 'credit_note' | 'debit_note';
type SourceKind = 'sales_order' | 'fabric_stock' | 'fabric_receipt' | 'yarn_lot' | 'free' | 'return';

interface Customer { id: number; name: string; gstin: string | null; state: string | null; billing_address: string | null; is_vip?: boolean | null; ledger_type_name?: string | null }
interface Vendor   { id: number; name: string; gstin: string | null; ledger_type?: { name: string } | null }
interface YarnLot  { id: number; lot_code: string; current_kg: number; cost_per_kg: number;
                     yarn_count_id: number; supplier_party_id: number | null;
                     yarn_count?: { display_name: string } | null;
                     // Joined party row (party_type = 'Mill / Yarn Supplier') — was previously joined as mill.
                     supplier?: { name: string } | null }
interface SalesOrder { id: number; so_number: string; customer_id: number; total: number; status: string }
interface SoLine { id: number; so_id: number; quantity_m: number; rate_per_m: number; delivered_m: number;
                   costing?: { quality_code: string; quality_name: string } | null }
/** In-house fabric stock batch = a fabric_purchase row with metres
 *  left. Quality info comes from the fabric master so the dropdown is
 *  organised by fabric quality and the rate/GST prefill correctly. */
interface FabricStock { id: number; code: string | null; current_metres: number; rate: number;
                        fabric_quality_id: number | null;
                        quality?: { code: string | null; name: string; rate_per_m: number | string | null; gst_pct: number | string | null } | null }
interface OriginalInvoice { id: number; invoice_no: string; doc_type: string; customer_id: number; total: number;
                            party_state: string | null; is_interstate: boolean }
interface OriginalLine    { id: number; description: string; hsn_sac: string | null; uom: string;
                            quantity: number; rate: number; gst_rate_pct: number; total_amount: number }

/** In-house fabric receipt offered on a Fabric Sale invoice. One row
 *  per CONFIRMED, un-invoiced in-house DC that has a fabric receipt.
 *  Ticking it seeds invoice lines from the receipt items; on save the
 *  DC is stamped invoice_id + status='invoiced'. */
interface InhouseReceiptItem {
  id: number;
  received_metres: number | string | null;
  no_of_pieces: number | null;
  entry_mode: string | null;
  quality?: { code: string | null; name: string; rate_per_m: number | string | null; gst_pct: number | string | null } | null;
}
interface InhouseReceiptDc {
  id: number;
  code: string;
  dc_date: string;
  bill_to_name: string | null;
  total_metres: number | string | null;
  total_pieces: number | null;
  receipt: {
    id: number;
    code: string;
    receipt_date: string;
    items: InhouseReceiptItem[];
  } | null;
}

interface Row {
  id: string;                    // local key only
  description: string;
  hsn_sac: string;
  uom: string;
  quantity: string;
  rate: string;
  discount_pct: string;
  gst_rate_pct: string;
  // Source linkage (one set per row depending on doc type)
  yarn_lot_id: string;
  fabric_stock_id: string;
  /** Fabric Sale "Direct from Stock": the fabric_purchase batch the
   *  line sells from. Saved on invoice_line and reduced on save. */
  fabric_purchase_id: string;
  so_line_id: string;
  original_line_id: string;
  /** Set when the row was seeded from an in-house fabric receipt — the
   *  source DC id, so unticking the receipt removes its rows. */
  dc_id: string;
}

const DOC_OPTIONS: { key: DocType; label: string; icon: any; tagline: string }[] = [
  { key: 'tax_invoice',  label: 'Fabric Sale',     icon: FileText,       tagline: 'Tax invoice — fabric to a customer' },
  { key: 'yarn_sale',    label: 'Yarn Sale',       icon: Coins,          tagline: 'Sell yarn out of stock' },
  { key: 'general_sale', label: 'General Sale',    icon: Briefcase,      tagline: 'Rental income, scrap, services' },
  { key: 'credit_note',  label: 'Sales Return',    icon: RotateCcw,      tagline: 'Customer is returning fabric/yarn' },
  { key: 'debit_note',   label: 'Purchase Return', icon: ArrowDownLeft,  tagline: 'You are returning yarn to a supplier' },
];

const FABRIC_HSN = '5208';
const YARN_HSN   = '5205';
const GST_DEFAULT = '5';

const newRow = (): Row => ({
  id: Math.random().toString(36).slice(2),
  description: '', hsn_sac: '', uom: 'mtr',
  quantity: '', rate: '', discount_pct: '0', gst_rate_pct: GST_DEFAULT,
  yarn_lot_id: '', fabric_stock_id: '', fabric_purchase_id: '', so_line_id: '', original_line_id: '', dc_id: '',
});

export default function NewInvoicePage() {
  const router = useRouter();
  const supabase = createClient();
  const params = useSearchParams();
  const initialType = (params.get('type') as DocType) || 'tax_invoice';

  // ── doc type selection ─────────────────────────────────────────────────────
  const [docType, setDocType] = useState<DocType>(initialType);
  const [sourceKind, setSourceKind] = useState<SourceKind>('sales_order');

  // ── party (customer for sales, vendor for debit_note) ──────────────────────
  const [companyState, setCompanyState] = useState<string>('Tamil Nadu');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vendors, setVendors]     = useState<Vendor[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [vendorId,   setVendorId]   = useState('');
  // Name → party.id lookup so the credit-note bill picker
  // (UnpaidBillsPicker) can resolve a customer to its party.id —
  // the customer.id and party.id are different sequences. Without
  // this, the picker queries against a stale id and returns
  // nothing even when unpaid invoices exist.
  const [partyByName, setPartyByName] = useState<Map<string, number>>(new Map());

  // ── source masters ─────────────────────────────────────────────────────────
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [soLines,     setSoLines]     = useState<SoLine[]>([]);
  const [pickedSoId,  setPickedSoId]  = useState('');
  const [fabricStock, setFabricStock] = useState<FabricStock[]>([]);
  const [yarnLots,    setYarnLots]    = useState<YarnLot[]>([]);
  // Un-invoiced in-house fabric receipts (via their confirmed DCs).
  const [inhouseDcs,  setInhouseDcs]  = useState<InhouseReceiptDc[]>([]);
  const [pickedDcIds, setPickedDcIds] = useState<Set<number>>(new Set());
  // doc_sequence rows so the form can preview the NEXT invoice number.
  const [docSequences, setDocSequences] = useState<Record<string, { prefix: string; fy_code: string; format: string; next_value: number }>>({});

  // ── credit_note: bill-picker driven flow ──────────────────────────────────
  // After picking a customer, all their unpaid invoices show up as
  // checkboxes (via UnpaidBillsPicker). The operator ticks one or
  // many; the credit note records the return against those invoices.
  // When EXACTLY one invoice is ticked, the row editor below is
  // pre-filled with that invoice's lines so the operator can drop
  // the qty to whatever's actually being returned.
  const [originalInvoices, setOriginalInvoices] = useState<OriginalInvoice[]>([]);
  const [originalLines,    setOriginalLines]    = useState<OriginalLine[]>([]);
  const [creditAllocs,     setCreditAllocs]     = useState<BillAllocation[]>([]);
  /** Ticked bills emitted by the picker BEFORE allocation amounts
   *  are computed. We watch this (not creditAllocs) to drive the
   *  line pre-fill — otherwise the chicken-and-egg with totals=0
   *  means lines never fill. */
  const [creditPicks,      setCreditPicks]      = useState<SelectedBill[]>([]);

  // ── debit_note extras ──────────────────────────────────────────────────────
  const [supplierBillNo,   setSupplierBillNo]   = useState('');
  const [supplierBillDate, setSupplierBillDate] = useState('');

  // ── header ──────────────────────────────────────────────────────────────────
  const [invoiceDate,  setInvoiceDate]  = useState(() => new Date().toISOString().slice(0,10));
  // Due date is captured as a number of days after the invoice date, not
  // a hard-coded calendar date. Final due_date is computed at save time
  // (invoice_date + N days). Empty string = no due date.
  const [dueDays,      setDueDays]      = useState('30');
  const [placeOfSupply, setPlaceOfSupply] = useState('Tamil Nadu');
  const [shipTo, setShipTo] = useState<ShipToValue>(EMPTY_SHIP_TO);
  const [notes,        setNotes]        = useState('');
  // Vehicle number — required on every new invoice. Printed alongside
  // the e-way bill block on the invoice template (migration 160).
  const [vehicleNo,    setVehicleNo]    = useState('');
  // Historical picks for the type-ahead datalists on Vehicle / Notes.
  // Pulled from prior invoice rows — most recent first, deduped.
  const vehicleHistory = useColumnHistory('invoice', 'vehicle_no', 100);
  const notesHistory   = useColumnHistory('invoice', 'notes',      50);

  // ── line rows ──────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<Row[]>([newRow()]);

  // Type-ahead options for the party pickers (Customer / Vendor).
  // Labels keep the same text the old <option>s showed so search works
  // on name, state and ledger type alike.
  const customerOptions = useMemo<SearchSelectOption[]>(
    () => customers.map((c) => ({
      value: String(c.id),
      label: `${c.is_vip ? '★ ' : ''}${c.name}${c.state ? ` · ${c.state}` : ''}`,
    })),
    [customers],
  );
  const vendorOptions = useMemo<SearchSelectOption[]>(
    () => vendors.map((v) => ({
      value: String(v.id),
      label: `${v.name}${v.ledger_type?.name ? ` (${v.ledger_type.name})` : ''}`,
    })),
    [vendors],
  );

  // ── ui state ───────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // ── load masters ───────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const [cp, cu, ve, so, fs, yl, oi, ihr, seqs, pm] = await Promise.all([
        supabase.from('company_profile').select('state').single(),
        // All active customers. The customer master is the source of
        // truth; every customer also has a linked CUSTOMER ledger that
        // is auto-maintained via party_type_master wiring. We don't
        // hard-filter on the ledger link here because some legacy
        // customers may briefly lack a ledger row, and we'd rather
        // show them in the dropdown than silently hide them.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from('customer')
          .select('id, name, gstin, state, billing_address, is_vip, ledger:ledger_id ( ledger_type:type_id ( name ) )')
          .eq('status','active')
          // VIPs first so the most important customers sit at the top
          // of the dropdown; alphabetical within each tier.
          .order('is_vip', { ascending: false })
          .order('name'),
        // Vendors are now ledgers - pull any active ledger that's not a CUSTOMER/CASH/BANK/TAX type
        // so we cover SUPPLIER, AGENT, SIZING/WEAVING/FOLDING vendors etc.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from('ledger')
          .select('id, name, gstin, ledger_type:type_id\!inner(name)')
          .eq('active', true)
          .not('ledger_type.name', 'in', '(CUSTOMER,CASH,BANK,TAX)')
          .order('name'),
        supabase.from('sales_order').select('id, so_number, customer_id, total, status').in('status', ['approved','in_production','partial_dispatch','dispatched','invoiced']).order('order_date', { ascending: false }).limit(100),
        // In-house fabric stock = fabric purchases with metres left.
        // Adding a purchase on Inhouse Stock → Fabric Stock makes it
        // appear here (and as a warehouse inflow); selling from it
        // records the outflow + reduces current_metres.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from('fabric_purchase').select(`
          id, code, current_metres, rate, fabric_quality_id,
          quality:fabric_quality_id ( code, name, rate_per_m, gst_pct )
        `).eq('status', 'active')
          .eq('delivery_destination', 'in_house')
          .gt('current_metres', 0)
          .order('received_date', { ascending: true })
          .limit(200),
        // Yarn suppliers now live in the unified party table (migration 098).
        // The old yarn_lot.mill_id FK is gone — supplier_party_id replaces it.
        // Cast to any because the regenerated Supabase types haven't caught
        // up to that rename yet; runtime is correct but the type checker
        // would otherwise see the column as missing.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from('yarn_lot').select(`
          id, lot_code, current_kg, cost_per_kg, yarn_count_id, supplier_party_id,
          yarn_count:yarn_count_id ( display_name ),
          supplier:supplier_party_id ( name )
        `).gt('current_kg', 0).order('received_date', { ascending: false }).limit(100),
        supabase.from('invoice').select('id, invoice_no, doc_type, customer_id, total, party_state, is_interstate')
          .in('doc_type', ['tax_invoice','yarn_sale','general_sale']).order('invoice_date', { ascending: false }).limit(100),
        // Un-invoiced in-house fabric receipts. Pipeline: DC goes
        // draft → confirmed when its fabric receipt is saved →
        // invoiced when picked onto a Fabric Sale invoice here.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from('delivery_challan')
          .select(`
            id, code, dc_date, bill_to_name, total_metres, total_pieces,
            receipt:fabric_receipt_id (
              id, code, receipt_date,
              items:fabric_receipt_item (
                id, received_metres, no_of_pieces, entry_mode,
                quality:fabric_quality_id ( code, name, rate_per_m, gst_pct )
              )
            )
          `)
          .eq('production_mode', 'inhouse')
          .eq('status', 'confirmed')
          .is('invoice_id', null)
          .not('fabric_receipt_id', 'is', null)
          .order('dc_date', { ascending: true })
          .order('id', { ascending: true }),
        // Next-number preview per document type.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from('doc_sequence')
          .select('doc_type, prefix, fy_code, format, next_value')
          .in('doc_type', ['invoice', 'yarn_sale', 'general_sale', 'rental_invoice', 'credit_note', 'debit_note']),
        // Unified party master — used to resolve a picked customer
        // (customer.id) to its party.id for the credit-note bill
        // picker. customer.id and party.id are separate sequences,
        // so without this lookup the picker would always come back
        // empty.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from('party').select('id, name').eq('status', 'active'),
      ]);
      setCompanyState(cp.data?.state ?? 'Tamil Nadu');
      // Flatten the nested ledger.ledger_type.name onto each customer so
      // we can tell at a glance if it's a Rental customer (used to
      // auto-fill the rental defaults on the line rows below).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const flatCustomers: Customer[] = ((cu.data ?? []) as any[]).map((c) => ({
        id: c.id,
        name: c.name,
        gstin: c.gstin ?? null,
        state: c.state ?? null,
        billing_address: c.billing_address ?? null,
        is_vip: c.is_vip ?? false,
        ledger_type_name: c.ledger?.ledger_type?.name ?? null,
      }));
      setCustomers(flatCustomers);
      setVendors(ve.data ?? []);
      setSalesOrders(so.data ?? []);
      setFabricStock((fs.data ?? []) as any);
      setYarnLots((yl.data ?? []) as any);
      setOriginalInvoices((oi.data ?? []) as any);
      setInhouseDcs(((ihr as any).data ?? []) as InhouseReceiptDc[]);
      const seqMap: Record<string, { prefix: string; fy_code: string; format: string; next_value: number }> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const s of (((seqs as any).data ?? []) as Array<{ doc_type: string; prefix: string; fy_code: string; format: string; next_value: number }>)) {
        seqMap[s.doc_type] = { prefix: s.prefix, fy_code: s.fy_code, format: s.format, next_value: Number(s.next_value) };
      }
      setDocSequences(seqMap);
      // Build name → party.id lookup (case-insensitive). The credit-
      // note picker uses this to convert the picked customer to a
      // party.id so the unpaid-invoice query lands on the right rows.
      const lookup = new Map<string, number>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const p of (((pm as any).data ?? []) as Array<{ id: number; name: string }>)) {
        lookup.set(p.name.trim().toUpperCase(), p.id);
      }
      setPartyByName(lookup);
      setLoading(false);
    })();
  }, [supabase]);

  // Resolve the currently-picked customer to its party.id (via name).
  // Memoised so the picker doesn't re-fetch on unrelated re-renders.
  const customerPartyId = useMemo<number | null>(() => {
    if (customerId === '') return null;
    const cust = customers.find((c) => String(c.id) === customerId);
    if (!cust) return null;
    return partyByName.get(cust.name.trim().toUpperCase()) ?? null;
  }, [customerId, customers, partyByName]);

  // ── reset source when doc type changes ─────────────────────────────────────
  useEffect(() => {
    setRows([newRow()]);
    if (docType === 'tax_invoice')   setSourceKind('sales_order');
    if (docType === 'yarn_sale')     setSourceKind('yarn_lot');
    if (docType === 'general_sale')  setSourceKind('free');
    if (docType === 'credit_note')   setSourceKind('return');
    if (docType === 'debit_note')    setSourceKind('free');
    setPickedSoId(''); setSoLines([]);
    setOriginalLines([]); setCreditAllocs([]); setCreditPicks([]);
    setVendorId(''); setCustomerId('');
    setPickedDcIds(new Set());
    setError(null);
  }, [docType]);

  /** Tick / untick an in-house fabric receipt. Ticking appends one
   *  invoice line per receipt item (quality, metres or pieces, rate +
   *  GST defaults from the fabric master). Unticking removes the rows
   *  that came from that DC. */
  function toggleReceiptDc(dc: InhouseReceiptDc): void {
    const next = new Set(pickedDcIds);
    if (next.has(dc.id)) {
      next.delete(dc.id);
      setPickedDcIds(next);
      setRows((prev) => {
        const kept = prev.filter((r) => r.dc_id !== String(dc.id));
        return kept.length > 0 ? kept : [newRow()];
      });
      return;
    }
    next.add(dc.id);
    setPickedDcIds(next);

    const items = dc.receipt?.items ?? [];
    const seeded: Row[] = items.length > 0
      ? items.map((it) => {
          const pcsMode = (it.entry_mode ?? '') === 'pcs' && (it.no_of_pieces ?? 0) > 0;
          const qty = pcsMode ? Number(it.no_of_pieces ?? 0) : Number(it.received_metres ?? 0);
          return {
            ...newRow(),
            description: `${it.quality?.name ?? 'Fabric'} (${dc.receipt?.code ?? dc.code})`,
            hsn_sac: FABRIC_HSN,
            uom: pcsMode ? 'pcs' : 'mtr',
            quantity: qty > 0 ? String(qty) : '',
            rate: it.quality?.rate_per_m != null ? String(it.quality.rate_per_m) : '',
            gst_rate_pct: it.quality?.gst_pct != null ? String(it.quality.gst_pct) : GST_DEFAULT,
            dc_id: String(dc.id),
          };
        })
      : [{
          ...newRow(),
          description: `Fabric (${dc.receipt?.code ?? dc.code})`,
          hsn_sac: FABRIC_HSN,
          quantity: dc.total_metres != null ? String(dc.total_metres) : '',
          dc_id: String(dc.id),
        }];

    setRows((prev) => {
      // Drop the single blank starter row when the first receipt lands.
      const isBlank = (r: Row): boolean =>
        r.description.trim() === '' && r.quantity.trim() === '' && r.rate.trim() === '' && r.dc_id === '';
      const kept = prev.filter((r) => !isBlank(r));
      return [...kept, ...seeded];
    });
  }

  // ── when an SO is picked, load its lines ──────────────────────────────────
  useEffect(() => {
    if (!pickedSoId) { setSoLines([]); return; }
    (async () => {
      const { data } = await supabase
        .from('sales_order_line')
        .select('id, so_id, quantity_m, rate_per_m, delivered_m, costing:costing_id ( quality_code, quality_name )')
        .eq('so_id', Number(pickedSoId));
      setSoLines((data ?? []) as any);
      const so = salesOrders.find(s => s.id === Number(pickedSoId));
      if (so) setCustomerId(String(so.customer_id));
      // Pre-fill rows from SO lines
      setRows((data ?? []).map((l: any) => ({
        ...newRow(),
        description: l.costing?.quality_name ?? 'Fabric',
        hsn_sac: FABRIC_HSN,
        quantity: String(l.quantity_m),
        rate: String(l.rate_per_m),
        so_line_id: String(l.id),
      })));
    })();
  }, [pickedSoId, salesOrders, supabase]);

  // ── pre-fill rows when exactly ONE invoice is ticked ──────────────────────
  // Fires on the tick itself (creditPicks), independent of allocation
  // amount — otherwise the chicken-and-egg with empty rows / zero
  // total keeps the picker's allocations empty too, and lines never
  // fill. Multi-invoice ticks deliberately leave the row editor alone
  // so the operator types what's actually being returned.
  useEffect(() => {
    if (docType !== 'credit_note') return;
    const invoiceTicks = creditPicks.filter((p) => p.kind === 'invoice');
    if (invoiceTicks.length !== 1) {
      setOriginalLines([]);
      return;
    }
    const tickedId = invoiceTicks[0]?.id;
    if (tickedId === undefined) return;
    (async () => {
      const { data } = await supabase
        .from('invoice_line')
        .select('id, description, hsn_sac, uom, quantity, rate, gst_rate_pct, total_amount')
        .eq('invoice_id', tickedId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setOriginalLines((data ?? []) as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setRows((data ?? []).map((l: any) => ({
        ...newRow(),
        description: l.description,
        hsn_sac: l.hsn_sac ?? '',
        uom: l.uom,
        quantity: String(l.quantity),
        rate: String(l.rate),
        gst_rate_pct: String(l.gst_rate_pct),
        original_line_id: String(l.id),
      })));
    })();
  }, [docType, creditPicks, supabase]);

  // ── derived: customer state → interstate? ─────────────────────────────────
  const currentCustomer = customers.find(c => c.id === Number(customerId));
  const isRentalCustomer = currentCustomer?.ledger_type_name === 'RENTAL';

  /** Preview of the exact invoice number the DB trigger will assign on
   *  save, rendered from doc_sequence. Mirrors fn_invoice_auto_no's
   *  doc_type → sequence mapping (incl. the rental-customer special
   *  case on general sales). */
  const nextInvoiceNo = useMemo<string | null>(() => {
    const seqKey =
      docType === 'tax_invoice' ? 'invoice'
      : docType === 'general_sale' && isRentalCustomer ? 'rental_invoice'
      : docType;
    const s = docSequences[seqKey];
    if (!s) return null;
    const padMatch = /\{seq:(0+)\}/.exec(s.format);
    const width = padMatch?.[1]?.length ?? 4;
    let out = s.format
      .replace('{prefix}', s.prefix)
      .replace('{fy}', s.fy_code)
      .replace(/\{seq:0+\}/, String(s.next_value).padStart(width, '0'));
    out = out.replace(/([-/])\1+/g, '$1').replace(/^[-/]+|[-/]+$/g, '');
    return out;
  }, [docType, isRentalCustomer, docSequences]);

  // When a Rental customer is picked on a general-sale invoice, pre-fill
  // sensible defaults on the first row: HSN 997212 ("Renting of
  // commercial space"), description "COMMERCIAL RENT", GST 18%, and
  // UOM "Nos" (rent is billed per unit, not per metre). We only
  // overwrite blank/default fields so the operator's edits aren't trampled.
  useEffect(() => {
    if (docType !== 'general_sale' || !isRentalCustomer) return;
    setRows((prev) => {
      const first = prev[0];
      if (!first) return prev;
      const needsDescription = first.description.trim() === '';
      const needsHsn         = first.hsn_sac.trim() === '';
      const needsGst         = first.gst_rate_pct === '' || first.gst_rate_pct === GST_DEFAULT;
      const needsUom         = first.uom === '' || first.uom === 'mtr';
      if (!needsDescription && !needsHsn && !needsGst && !needsUom) return prev;
      const next = [...prev];
      next[0] = {
        ...first,
        description:  needsDescription ? 'COMMERCIAL RENT' : first.description,
        hsn_sac:      needsHsn         ? '997212'          : first.hsn_sac,
        gst_rate_pct: needsGst         ? '18'              : first.gst_rate_pct,
        uom:          needsUom         ? 'Nos'             : first.uom,
      };
      return next;
    });
  }, [docType, isRentalCustomer]);

  const customerState = currentCustomer?.state ?? '';
  const isInterstate = useMemo(() => {
    if (!customerState || !companyState) return false;
    return customerState.toLowerCase() !== companyState.toLowerCase();
  }, [customerState, companyState]);

  useEffect(() => {
    // Default place of supply to customer's state when one is picked.
    if (customerState) setPlaceOfSupply(customerState);
  }, [customerState]);

  // ── row helpers ────────────────────────────────────────────────────────────
  const updateRow  = (id: string, patch: Partial<Row>) => setRows(r => r.map(x => x.id === id ? { ...x, ...patch } : x));
  const addRow     = () => setRows(r => [...r, newRow()]);
  const removeRow  = (id: string) => setRows(r => r.length === 1 ? r : r.filter(x => x.id !== id));

  // When a yarn lot is picked into a row, prefill description / HSN / rate
  function pickYarnLotForRow(rowId: string, lotId: string) {
    const lot = yarnLots.find(l => l.id === Number(lotId));
    if (!lot) { updateRow(rowId, { yarn_lot_id: lotId }); return; }
    updateRow(rowId, {
      yarn_lot_id: lotId,
      description: `${lot.yarn_count?.display_name ?? ''} ${lot.supplier?.name ?? ''} (${lot.lot_code})`.trim(),
      hsn_sac: YARN_HSN,
      uom: 'kg',
      rate: String(lot.cost_per_kg),
    });
  }

  function pickFabricStockForRow(rowId: string, purchaseId: string) {
    const fs = fabricStock.find(f => f.id === Number(purchaseId));
    if (!fs) { updateRow(rowId, { fabric_purchase_id: purchaseId }); return; }
    updateRow(rowId, {
      fabric_purchase_id: purchaseId,
      description: fs.quality?.name ?? 'Fabric',
      hsn_sac: FABRIC_HSN,
      uom: 'mtr',
      // Selling rate from the fabric master; fall back to the purchase
      // rate when the master has none.
      rate: fs.quality?.rate_per_m != null ? String(fs.quality.rate_per_m) : String(fs.rate),
      gst_rate_pct: fs.quality?.gst_pct != null ? String(fs.quality.gst_pct) : GST_DEFAULT,
    });
  }

  // ── per-row math ───────────────────────────────────────────────────────────
  const computedRows = useMemo(() => rows.map(r => {
    const q  = Number(r.quantity) || 0;
    const rt = Number(r.rate)     || 0;
    const dp = Number(r.discount_pct) || 0;
    const gross   = q * rt;
    const disc    = +(gross * dp / 100).toFixed(2);
    const taxable = +(gross - disc).toFixed(2);
    const gstRate = Number(r.gst_rate_pct) || 0;
    const totalGst = +(taxable * gstRate / 100).toFixed(2);
    const cgst = isInterstate ? 0 : +(totalGst / 2).toFixed(2);
    const sgst = isInterstate ? 0 : +(totalGst / 2).toFixed(2);
    const igst = isInterstate ? totalGst : 0;
    const total = +(taxable + cgst + sgst + igst).toFixed(2);
    return { ...r, gross, disc, taxable, cgst, sgst, igst, total };
  }), [rows, isInterstate]);

  // ── totals ─────────────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    let taxable = 0, cgst = 0, sgst = 0, igst = 0;
    for (const r of computedRows) {
      taxable += r.taxable; cgst += r.cgst; sgst += r.sgst; igst += r.igst;
    }
    const sub = +(taxable + cgst + sgst + igst).toFixed(2);
    const rounded = Math.round(sub);
    const roundOff = +(rounded - sub).toFixed(2);
    return {
      taxable: +taxable.toFixed(2),
      cgst:    +cgst.toFixed(2),
      sgst:    +sgst.toFixed(2),
      igst:    +igst.toFixed(2),
      roundOff,
      total:   rounded,
    };
  }, [computedRows]);

  // ── submit ─────────────────────────────────────────────────────────────────
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validate party
    if (docType === 'debit_note') {
      if (!vendorId) return setError('Pick a vendor.');
    } else {
      if (!customerId) return setError('Pick a customer.');
    }
    if (docType === 'credit_note') {
      const ticked = creditAllocs.filter((a) => a.kind === 'invoice');
      if (ticked.length === 0) {
        return setError('Tick at least one invoice the credit note applies against.');
      }
    }
    if (docType === 'tax_invoice' && sourceKind === 'fabric_receipt' && pickedDcIds.size === 0) {
      return setError('Tick at least one in-house fabric receipt to invoice.');
    }

    // Validate rows
    if (!computedRows.length) return setError('At least one line item is required.');
    for (const r of computedRows) {
      if (!r.description.trim()) return setError('Every line needs a description.');
      if (!Number(r.quantity))   return setError(`"${r.description}": quantity must be > 0.`);
      if (!Number(r.rate))       return setError(`"${r.description}": rate must be > 0.`);
    }

    // Vehicle number is mandatory on every new invoice (migration 160).
    if (vehicleNo.trim() === '') return setError('Vehicle number is required.');

    setBusy(true);

    // Party snapshot
    const party = docType === 'debit_note'
      ? vendors.find(v => v.id === Number(vendorId))
      : customers.find(c => c.id === Number(customerId));

    const partyName  = party?.name ?? '';
    const partyGstin = party?.gstin ?? null;
    const partyState = docType === 'debit_note'
      ? null   // vendor table has no state in current schema
      : (currentCustomer?.state ?? null);

    // Header insert
    const headerPayload: any = {
      doc_type:      docType,
      source_kind:   sourceKind,
      customer_id:   docType === 'debit_note' ? null : Number(customerId),
      ledger_id:     docType === 'debit_note' ? Number(vendorId) : null,
      so_id:         pickedSoId ? Number(pickedSoId) : null,
      // For GST paper trail: stamp the first ticked invoice as the
      // primary "against" link. The full set of ticked invoices is
      // captured separately via payment_allocation rows.
      original_invoice_id: (() => {
        if (docType !== 'credit_note') return null;
        const firstInvoice = creditAllocs.find((a) => a.kind === 'invoice');
        return firstInvoice ? (firstInvoice as { invoice_id: number }).invoice_id : null;
      })(),
      party_name:    partyName,
      party_gstin:   partyGstin,
      party_state:   partyState,
      place_of_supply: placeOfSupply,
      is_interstate: isInterstate,
      invoice_date:  invoiceDate,
      // due_date = invoice_date + dueDays (N). Empty/zero days = no due
      // date. We add days in UTC to avoid timezone slippage.
      due_date:      (() => {
        const n = Number(dueDays);
        if (!Number.isFinite(n) || n <= 0 || !invoiceDate) return null;
        const d = new Date(invoiceDate + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().slice(0, 10);
      })(),
      taxable_value: totals.taxable,
      subtotal:      totals.taxable,        // legacy column kept for back-compat
      cgst_amount:   totals.cgst,
      sgst_amount:   totals.sgst,
      igst_amount:   totals.igst,
      gst_amount:    +(totals.cgst + totals.sgst + totals.igst).toFixed(2),
      round_off:     totals.roundOff,
      total:         totals.total,
      status:        'issued',
      notes:         notes.trim() || null,
      vehicle_no:    vehicleNo.trim().toUpperCase(),
      supplier_bill_no:   docType === 'debit_note' ? (supplierBillNo.trim() || null) : null,
      supplier_bill_date: docType === 'debit_note' && supplierBillDate ? supplierBillDate : null,
      ...shipToPayload(shipTo),
    };

    const { data: inv, error: invErr } = await supabase
      .from('invoice')
      .insert(headerPayload)
      .select('id, invoice_no')
      .single();

    if (invErr || !inv) {
      setBusy(false);
      return setError(invErr?.message ?? 'Could not create invoice.');
    }

    // Lines insert
    const lineRows = computedRows.map(r => ({
      invoice_id:     inv.id,
      description:    r.description.trim(),
      hsn_sac:        r.hsn_sac.trim() || null,
      uom:            r.uom,
      quantity:       Number(r.quantity),
      rate:           Number(r.rate),
      discount_pct:   Number(r.discount_pct) || 0,
      discount_amount: r.disc,
      gst_rate_pct:   Number(r.gst_rate_pct) || 0,
      taxable_amount: r.taxable,
      cgst_amount:    r.cgst,
      sgst_amount:    r.sgst,
      igst_amount:    r.igst,
      total_amount:   r.total,
      yarn_lot_id:    r.yarn_lot_id    ? Number(r.yarn_lot_id)    : null,
      fabric_stock_id: r.fabric_stock_id ? Number(r.fabric_stock_id) : null,
      fabric_purchase_id: r.fabric_purchase_id ? Number(r.fabric_purchase_id) : null,
      so_line_id:     r.so_line_id     ? Number(r.so_line_id)     : null,
      original_line_id: r.original_line_id ? Number(r.original_line_id) : null,
    }));

    // Cast: generated types predate the fabric_purchase_id column.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: lineErr } = await (supabase as any).from('invoice_line').insert(lineRows);
    if (lineErr) {
      setBusy(false);
      return setError(`Invoice ${inv.invoice_no} created but lines failed: ${lineErr.message}`);
    }

    // Fabric Sale from in-house receipts: advance each picked DC's
    // workflow status — confirmed (set when the receipt was saved) →
    // invoiced — and lock it to this invoice so it never shows up in
    // the un-invoiced receipt picker again.
    if (docType === 'tax_invoice' && sourceKind === 'fabric_receipt' && pickedDcIds.size > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: dcErr } = await (supabase as any)
        .from('delivery_challan')
        .update({ invoice_id: inv.id, status: 'invoiced' })
        .in('id', Array.from(pickedDcIds));
      if (dcErr) {
        setBusy(false);
        return setError(`Invoice ${inv.invoice_no} created but marking the DCs invoiced failed: ${dcErr.message}`);
      }
    }

    // Stock deduction for Fabric Sale "Direct from Stock": subtract the
    // sold metres from each picked fabric_purchase batch. The warehouse
    // fabric pivot reads these invoice lines as outflows.
    if (docType === 'tax_invoice' && sourceKind === 'fabric_stock') {
      for (const r of computedRows) {
        if (!r.fabric_purchase_id) continue;
        const fp = fabricStock.find(f => f.id === Number(r.fabric_purchase_id));
        if (!fp) continue;
        const newM = Math.max(0, Number(fp.current_metres) - Number(r.quantity));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from('fabric_purchase').update({ current_metres: newM }).eq('id', fp.id);
      }
    }

    // Stock deduction for yarn_sale: subtract from yarn_lot.current_kg
    // (only rows that picked a lot — free-entry rows touch no stock).
    if (docType === 'yarn_sale') {
      for (const r of computedRows) {
        if (!r.yarn_lot_id) continue;
        const lot = yarnLots.find(l => l.id === Number(r.yarn_lot_id));
        if (!lot) continue;
        const newKg = Math.max(0, Number(lot.current_kg) - Number(r.quantity));
        await supabase.from('yarn_lot').update({ current_kg: newKg }).eq('id', lot.id);
      }
    }
    // Stock add-back for credit_note (sales return) when the return is yarn
    if (docType === 'credit_note') {
      for (const r of computedRows) {
        if (!r.yarn_lot_id) continue;
        const lot = yarnLots.find(l => l.id === Number(r.yarn_lot_id));
        if (!lot) continue;
        const newKg = Number(lot.current_kg) + Number(r.quantity);
        await supabase.from('yarn_lot').update({ current_kg: newKg }).eq('id', lot.id);
      }

      // Credit-note money side: synthetic payment + allocations
      // straight from the ticked invoices in the picker.
      const creditAmount = totals.total;
      if (creditAmount > 0 && customerId !== '' && creditAllocs.length > 0) {
        const stamp = Date.now().toString().slice(-6);
        const paymentNo = 'CN-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + stamp;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sb = supabase as any;
        const { data: pmt, error: pErr } = await sb
          .from('payment')
          .insert({
            payment_no:   paymentNo,
            direction:    'in',
            party_id:     Number(customerId),
            payment_date: invoiceDate,
            amount:       creditAmount,
            mode:         'credit_note',
            reference:    inv.invoice_no,
            notes:        `Credit note ${inv.invoice_no}`,
            invoice_id:   inv.id,
          })
          .select('id')
          .single();
        if (pErr) {
          setBusy(false);
          return setError(`Credit note ${inv.invoice_no} saved but money side failed: ${pErr.message}`);
        }
        const pid = pmt?.id as number | undefined;
        if (pid !== undefined) {
          const buckets = splitAllocationsByKind(creditAllocs);
          if (buckets.invoices.length) {
            const { error: e } = await sb.from('payment_allocation')
              .insert(buckets.invoices.map((a) => ({ ...a, payment_id: pid })));
            if (e) { setBusy(false); return setError(`Credit saved but allocations failed: ${e.message}`); }
          }
          if (buckets.openings.length) {
            const { error: e } = await sb.from('payment_opening_allocation')
              .insert(buckets.openings.map((a) => ({ ...a, payment_id: pid })));
            if (e) { setBusy(false); return setError(`Credit saved but opening allocations failed: ${e.message}`); }
          }
        }
      }
    }

    router.push('/app/invoices');
    router.refresh();
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="New Invoice"
        subtitle="Pick the document type — the form adapts to it."
        crumbs={[{ label: 'Invoices', href: '/app/invoices' }, { label: 'New' }]}
      />

      {loading ? (
        <div className="card p-6 text-sm text-ink-soft">Loading masters…</div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5">
          {/* ── Doc-type picker ────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {DOC_OPTIONS.map(opt => {
              const Icon = opt.icon;
              const active = docType === opt.key;
              return (
                <button
                  type="button"
                  key={opt.key}
                  onClick={() => setDocType(opt.key)}
                  className={`card p-3 text-left transition border ${active
                    ? 'border-indigo bg-indigo/5 ring-2 ring-indigo/20'
                    : 'border-line hover:border-indigo/40'}`}
                >
                  <Icon className={`w-4 h-4 mb-1.5 ${active ? 'text-indigo' : 'text-ink-soft'}`} />
                  <div className={`text-xs font-bold ${active ? 'text-indigo' : 'text-ink'}`}>{opt.label}</div>
                  <div className="text-[10px] text-ink-mute leading-tight mt-0.5">{opt.tagline}</div>
                </button>
              );
            })}
          </div>

          {/* ── Header ─────────────────────────────────────────────────────── */}
          <div className="card p-6 space-y-4">
            <h3 className="text-sm font-bold text-ink">Document header</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Invoice No</label>
                {/* Shows the ACTUAL next number from doc_sequence; the
                    DB trigger assigns this exact number on save. */}
                <div className="input num bg-cloud/60 text-ink flex items-center cursor-not-allowed select-none font-mono">
                  {nextInvoiceNo ?? 'Auto'}
                </div>
              </div>
              <div>
                <label className="label">Invoice Date *</label>
                <input type="date" required value={invoiceDate}
                  onChange={e => setInvoiceDate(e.target.value)} className="input" />
              </div>

              {/* Party picker */}
              {docType === 'debit_note' ? (
                <div className="sm:col-span-2">
                  <label className="label">Vendor (supplier) *</label>
                  <SearchSelect
                    options={vendorOptions}
                    value={vendorId}
                    onChange={setVendorId}
                    required
                    placeholder="Type to search vendor name…"
                  />
                </div>
              ) : (
                <div className="sm:col-span-2">
                  <label className="label">Customer *</label>
                  <SearchSelect
                    options={customerOptions}
                    value={customerId}
                    onChange={setCustomerId}
                    required
                    placeholder="Type to search customer name…"
                  />
                  {currentCustomer && (
                    <p className="text-[11px] text-ink-mute mt-1">
                      GSTIN: <span className="font-mono">{currentCustomer.gstin ?? '—'}</span>
                      {' · '}
                      {isInterstate
                        ? <span className="text-amber-700 font-semibold">Interstate → IGST</span>
                        : <span className="text-emerald-700 font-semibold">Intrastate → CGST + SGST</span>}
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="label">Place of supply</label>
                <input value={placeOfSupply} onChange={e => setPlaceOfSupply(e.target.value)}
                  className="input" placeholder="e.g. Tamil Nadu" />
              </div>
              <div>
                <label className="label">Due in (days)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={dueDays}
                  onChange={e => setDueDays(e.target.value)}
                  className="input num"
                  placeholder="e.g. 30"
                />
                <p className="text-[11px] text-ink-mute mt-1">
                  {(() => {
                    const n = Number(dueDays);
                    if (!Number.isFinite(n) || n <= 0 || !invoiceDate) return 'No due date';
                    const d = new Date(invoiceDate + 'T00:00:00Z');
                    d.setUTCDate(d.getUTCDate() + n);
                    return `Due on ${d.toISOString().slice(0, 10)}`;
                  })()}
                </p>
              </div>
            </div>

            {/* Optional consignee — different ship-to address. */}
            <div className="border-t border-line/40 pt-4">
              <ShipToPicker value={shipTo} onChange={setShipTo} />
            </div>

            {/* Credit note: tick the customer's unpaid invoices that
                this credit applies against. One ticked = lines below
                pre-fill from that invoice. Many ticked = enter the
                returned lines manually; the credit value spreads
                across the ticked bills oldest-first. */}
            {docType === 'credit_note' && (
              <div className="border-t pt-4 space-y-3">
                {customerId === '' ? (
                  <p className="text-xs text-ink-soft italic">
                    Pick the customer above first — their unpaid invoices will appear here for selection.
                  </p>
                ) : customerPartyId === null ? (
                  // Customer exists but no matching party-master row.
                  // Surface a clear diagnostic so the operator can fix
                  // the master data instead of seeing a silent empty list.
                  <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-800">
                    This customer is not linked to a party in the unified party master, so their unpaid invoices
                    can&rsquo;t be looked up. Open <span className="font-semibold">Settings → Parties</span> and
                    make sure the party name matches the customer name exactly.
                  </div>
                ) : (
                  <>
                    <div>
                      <h3 className="text-sm font-bold text-ink mb-1">
                        Which invoice(s) is this credit note against? <span className="text-rose-600">*</span>
                      </h3>
                      <p className="text-[11px] text-ink-mute">
                        Tick one invoice to auto-fill the returned lines below. Tick several to spread the credit
                        value across them — enter the returned-goods lines manually in that case.
                      </p>
                    </div>
                    <UnpaidBillsPicker
                      partyId={customerPartyId}
                      totalAmount={totals.total}
                      direction="in"
                      heading="Customer's unpaid invoices"
                      onAllocationsChange={setCreditAllocs}
                      onSelectionChange={setCreditPicks}
                    />
                  </>
                )}
              </div>
            )}

            {docType === 'debit_note' && (
              <div className="border-t pt-4 grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Supplier bill no</label>
                  <input value={supplierBillNo} onChange={e => setSupplierBillNo(e.target.value)}
                    className="input" placeholder="Their bill number you're returning against" />
                </div>
                <div>
                  <label className="label">Supplier bill date</label>
                  <input type="date" value={supplierBillDate}
                    onChange={e => setSupplierBillDate(e.target.value)} className="input" />
                </div>
              </div>
            )}

            {docType === 'yarn_sale' && (
              <div className="border-t pt-4">
                <label className="label">Where is the yarn coming from? *</label>
                <div className="flex gap-2 mb-1">
                  <button type="button" onClick={() => { setSourceKind('yarn_lot'); setRows([newRow()]); }}
                    className={`btn-sm ${sourceKind === 'yarn_lot' ? 'btn-primary' : 'btn-ghost'}`}>
                    From Yarn Stock
                  </button>
                  <button type="button" onClick={() => { setSourceKind('free'); setRows([newRow()]); }}
                    className={`btn-sm ${sourceKind === 'free' ? 'btn-primary' : 'btn-ghost'}`}>
                    Free entry (no stock reduction)
                  </button>
                </div>
                <p className="text-[11px] text-ink-mute">
                  From Yarn Stock: pick a lot per line and the sold kgs reduce that lot.
                  Free entry: type the lines yourself — yarn stock is untouched.
                </p>
              </div>
            )}

            {docType === 'tax_invoice' && (
              <div className="border-t pt-4">
                <label className="label">Where is the fabric coming from? *</label>
                <div className="flex gap-2 mb-3">
                  <button type="button" onClick={() => { setSourceKind('sales_order'); setRows([newRow()]); }}
                    className={`btn-sm ${sourceKind === 'sales_order' ? 'btn-primary' : 'btn-ghost'}`}>
                    From Sales Order
                  </button>
                  <button type="button" onClick={() => { setSourceKind('fabric_stock'); setRows([newRow()]); setPickedSoId(''); setPickedDcIds(new Set()); }}
                    className={`btn-sm ${sourceKind === 'fabric_stock' ? 'btn-primary' : 'btn-ghost'}`}>
                    Direct from Stock
                  </button>
                  <button type="button" onClick={() => { setSourceKind('fabric_receipt'); setRows([newRow()]); setPickedSoId(''); setPickedDcIds(new Set()); }}
                    className={`btn-sm ${sourceKind === 'fabric_receipt' ? 'btn-primary' : 'btn-ghost'}`}>
                    From Fabric Receipts (in-house)
                  </button>
                </div>
                {sourceKind === 'sales_order' && (
                  <>
                    <label className="label">Pick the Sales Order</label>
                    <select value={pickedSoId} onChange={e => setPickedSoId(e.target.value)} className="input">
                      <option value="">— select an SO —</option>
                      {salesOrders.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.so_number} · ₹{Number(s.total).toFixed(2)} · {s.status}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-ink-mute mt-1">
                      Selecting an SO will copy its delivered line items into the rows below.
                    </p>
                  </>
                )}
                {sourceKind === 'fabric_receipt' && (
                  inhouseDcs.length === 0 ? (
                    <p className="text-sm text-ink-soft">
                      No un-invoiced in-house fabric receipts. A receipt appears here once its DC is
                      confirmed (which happens automatically when the fabric receipt is saved).
                    </p>
                  ) : (
                    <div className="border border-line/40 rounded-md overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-cloud/60 text-[10px] uppercase tracking-wide text-ink-soft">
                          <tr>
                            <th className="px-2 py-2" />
                            <th className="text-left  px-2 py-2">Receipt</th>
                            <th className="text-left  px-2 py-2">DC</th>
                            <th className="text-left  px-2 py-2">Date</th>
                            <th className="text-right px-2 py-2">Metres</th>
                            <th className="text-right px-2 py-2">Pcs</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inhouseDcs.map((d) => (
                            <tr key={d.id}
                              className={`border-t border-line/40 cursor-pointer ${pickedDcIds.has(d.id) ? 'bg-indigo-50/50' : 'hover:bg-haze/60'}`}
                              onClick={() => toggleReceiptDc(d)}>
                              <td className="px-2 py-1.5">
                                <input type="checkbox" readOnly checked={pickedDcIds.has(d.id)} className="w-4 h-4 accent-indigo-600" />
                              </td>
                              <td className="px-2 py-1.5 font-mono">{d.receipt?.code ?? '—'}</td>
                              <td className="px-2 py-1.5 font-mono">{d.code}</td>
                              <td className="px-2 py-1.5 text-ink-soft">{d.receipt?.receipt_date ?? d.dc_date}</td>
                              <td className="px-2 py-1.5 text-right num">{Number(d.total_metres ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                              <td className="px-2 py-1.5 text-right num">{d.total_pieces ?? 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="text-[10px] text-ink-mute px-2 py-1.5 border-t border-line/40">
                        Tick a receipt to copy its items into the lines below. On save, the picked DCs are
                        marked <span className="font-semibold">invoiced</span> and stop appearing here.
                      </p>
                    </div>
                  )
                )}
              </div>
            )}
          </div>

          {/* ── Line items ─────────────────────────────────────────────────── */}
          <div className="card p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink">Line items</h3>
              <button type="button" onClick={addRow} className="btn-ghost btn-sm">
                <Plus className="w-3.5 h-3.5" /> Add row
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-ink-mute">
                  <tr>
                    <th className="text-left  px-2 py-2 min-w-[220px]">Description</th>
                    <th className="text-left  px-2 py-2">HSN</th>
                    <th className="text-right px-2 py-2">Qty</th>
                    <th className="text-left  px-2 py-2">UOM</th>
                    <th className="text-right px-2 py-2">Rate</th>
                    <th className="text-right px-2 py-2">Disc %</th>
                    <th className="text-right px-2 py-2">GST %</th>
                    <th className="text-right px-2 py-2">Taxable</th>
                    <th className="text-right px-2 py-2">{isInterstate ? 'IGST' : 'CGST'}</th>
                    {!isInterstate && <th className="text-right px-2 py-2">SGST</th>}
                    <th className="text-right px-2 py-2">Total</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {computedRows.map((r, i) => (
                    <tr key={r.id} className="border-t border-line/40">
                      <td className="px-2 py-1.5">
                        {/* Source picker if applicable */}
                        {docType === 'yarn_sale' && sourceKind === 'yarn_lot' ? (
                          <select value={r.yarn_lot_id}
                            onChange={e => pickYarnLotForRow(r.id, e.target.value)}
                            className="input input-sm w-full mb-1">
                            <option value="">— pick yarn lot —</option>
                            {yarnLots.map(l => (
                              <option key={l.id} value={l.id}>
                                {l.lot_code} · {l.yarn_count?.display_name ?? ''} · {Number(l.current_kg).toFixed(0)} kg avail
                              </option>
                            ))}
                          </select>
                        ) : (docType === 'tax_invoice' && sourceKind === 'fabric_stock') ? (
                          <select value={r.fabric_purchase_id}
                            onChange={e => pickFabricStockForRow(r.id, e.target.value)}
                            className="input input-sm w-full mb-1">
                            <option value="">— pick fabric stock (by quality) —</option>
                            {fabricStock.map(f => (
                              <option key={f.id} value={f.id}>
                                {f.quality?.name ?? 'Fabric'} · {Number(f.current_metres).toFixed(0)} m avail · {f.code ?? '#' + f.id}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        <input value={r.description}
                          onChange={e => updateRow(r.id, { description: e.target.value })}
                          className="input input-sm w-full" placeholder="Item description" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input value={r.hsn_sac}
                          onChange={e => updateRow(r.id, { hsn_sac: e.target.value })}
                          className="input input-sm w-20 num" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input value={r.quantity} onChange={e => updateRow(r.id, { quantity: e.target.value })}
                          className="input input-sm w-20 num text-right" type="number" step="0.01" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input value={r.uom} onChange={e => updateRow(r.id, { uom: e.target.value })}
                          className="input input-sm w-16" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input value={r.rate} onChange={e => updateRow(r.id, { rate: e.target.value })}
                          className="input input-sm w-24 num text-right" type="number" step="0.01" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input value={r.discount_pct}
                          onChange={e => updateRow(r.id, { discount_pct: e.target.value })}
                          className="input input-sm w-16 num text-right" type="number" step="0.01" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input value={r.gst_rate_pct}
                          onChange={e => updateRow(r.id, { gst_rate_pct: e.target.value })}
                          className="input input-sm w-16 num text-right" type="number" step="0.01" />
                      </td>
                      <td className="px-2 py-1.5 text-right num">{r.taxable.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right num">{(isInterstate ? r.igst : r.cgst).toFixed(2)}</td>
                      {!isInterstate && <td className="px-2 py-1.5 text-right num">{r.sgst.toFixed(2)}</td>}
                      <td className="px-2 py-1.5 text-right num font-semibold">{r.total.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right">
                        <button type="button" onClick={() => removeRow(r.id)}
                          className="text-rose-600 hover:text-rose-700 disabled:opacity-30"
                          disabled={rows.length === 1}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Totals ─────────────────────────────────────────────────────── */}
          <div className="card p-6">
            <h3 className="text-sm font-bold text-ink mb-3">Totals</h3>
            <div className="max-w-xs ml-auto space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-ink-soft">Taxable value</span><span className="num">{totals.taxable.toFixed(2)}</span></div>
              {isInterstate ? (
                <div className="flex justify-between"><span className="text-ink-soft">IGST</span><span className="num">{totals.igst.toFixed(2)}</span></div>
              ) : (
                <>
                  <div className="flex justify-between"><span className="text-ink-soft">CGST</span><span className="num">{totals.cgst.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-soft">SGST</span><span className="num">{totals.sgst.toFixed(2)}</span></div>
                </>
              )}
              <div className="flex justify-between text-ink-mute"><span>Round off</span><span className="num">{totals.roundOff.toFixed(2)}</span></div>
              <div className="flex justify-between border-t border-line pt-2 text-base font-bold">
                {/* Grand total is the rounded whole-rupee figure that
                    matches what gets stored as `total` and printed on
                    the bill. */}
                <span>Grand total</span><span className="num">₹ {totals.total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
              </div>
            </div>
          </div>

          {/* ── Vehicle + Notes + Submit ───────────────────────────────────── */}
          <div className="card p-6 space-y-3">
            <div>
              <label className="label">Vehicle number *</label>
              <input
                value={vehicleNo}
                onChange={(e) => setVehicleNo(e.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, ''))}
                className="input uppercase"
                placeholder="e.g. TN33 AB 1234"
                maxLength={20}
                required
                list="inv-new-vehicle-history"
              />
              {/* Browser-native autocomplete fed by past invoice rows.
                  Operator can type to filter or click the dropdown. */}
              <datalist id="inv-new-vehicle-history">
                {vehicleHistory.map((v) => <option key={v} value={v} />)}
              </datalist>
              <p className="text-[10px] text-ink-mute mt-1">
                Transport vehicle registration. Required on every invoice and printed on the bill. Past vehicles auto-suggest.
              </p>
            </div>
            <div>
              <div className="flex items-baseline justify-between mb-1">
                <label className="label mb-0">Notes</label>
                {notesHistory.length > 0 && (
                  <select
                    className="text-[10px] border border-line rounded px-1.5 py-0.5 bg-paper text-ink-soft"
                    value=""
                    onChange={(e) => {
                      if (e.target.value !== '') setNotes(e.target.value);
                    }}
                    title="Pick a recently-used note"
                    data-disable-enter-nav="true"
                  >
                    <option value="">Recent notes…</option>
                    {notesHistory.map((n) => (
                      <option key={n} value={n}>{n.length > 60 ? n.slice(0, 60) + '…' : n}</option>
                    ))}
                  </select>
                )}
              </div>
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                className="input" rows={2} placeholder="Internal remarks (won't print)" />
            </div>

            {error && <div className="text-sm text-rose-600 font-semibold">{error}</div>}

            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => router.push('/app/invoices')} className="btn-ghost">Cancel</button>
              <button type="submit" disabled={busy} className="btn-primary">
                {busy ? 'Saving…' : 'Save invoice'}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
