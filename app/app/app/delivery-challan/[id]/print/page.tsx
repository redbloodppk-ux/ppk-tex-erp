/**
 * Delivery Challan — A4 print view.
 *
 * This is the page the customer takes home with the goods. The layout is
 * a faithful rebuild of the legacy PPK TEX DC format (see SRI VISHNU TEX
 * DC038 page 1), with the bundle grid as the heart of the page: bundles
 * run across as columns (1..N), each piece's metres stacks down inside
 * its bundle column, and the column foot shows the bundle total.
 *
 * Pagination is computed here in JS (not left to the browser's print
 * reflow): the bundle grid is chunked into ROWS_PER_PAGE-row pages, so we
 * always know in advance exactly how many physical pages there will be and
 * which one is first/last. That lets every page carry the right
 * header/footer variant — full header + Bill To/Ship To on page 1, a slim
 * one-line header on continuation pages; the full signature/summary
 * footer only on the last page, a slim address footer on every other page
 * (so a stray sheet can still be traced back to its DC/party).
 *
 * Three top toolbar buttons let the user Print, save as PDF, or jump
 * back to the edit screen. The toolbar is hidden when the page actually
 * prints (see @media print rule below).
 *
 * No app shell (sidebar / header) is rendered here so the printed page
 * is just the document. The root layout opts this route out of the chrome
 * via the .print-shell class on the body.
 */
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { BrandLogo } from '@/app/components/brand-logo';
import { PrintActions } from './print-actions';
import { loadCompany } from '@/lib/load-company';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<{ title: string }> {
  const { id } = await params;
  return { title: `DC ${id} — Print` };
}

// ────────────────────────────────────────────────────────────────────────
// Data types
// ────────────────────────────────────────────────────────────────────────

interface DcHeader {
  id: number;
  code: string | null;
  void_code: string | null;
  dc_date: string;
  status: 'draft' | 'confirmed' | 'invoiced' | 'cancelled';
  production_mode: 'inhouse' | 'jobwork';
  entry_mode: 'detailed' | 'summary' | null;
  bill_to_name: string | null;
  bill_to_address: string | null;
  bill_to_gstin: string | null;
  bill_to_state: string | null;
  bill_to_state_code: string | null;
  ship_to_same: boolean;
  ship_to_name: string | null;
  ship_to_address: string | null;
  ship_to_gstin: string | null;
  ship_to_state: string | null;
  ship_to_state_code: string | null;
  vehicle_no: string | null;
  notes: string | null;
  total_metres: number | string | null;
  total_pieces: number | null;
  total_bundles: number | null;
}

interface BundleJson { sno?: number; pieces?: Array<number | string> }

interface DcItemRow {
  id: number;
  sno: number;
  fabric_quality_id: number | null;
  description: string | null;
  hsn: string | null;
  metres: number | string | null;
  pieces: number | null;
  bundles: number | null;
  bundles_detail: BundleJson[] | null;
}

interface FabricQualityMeta {
  id: number;
  code: string;
  name: string;
  hsn: string | null;
  reed: number | string | null;
  pick_per_inch: number | string | null;
  width_in: number | string | null;
  weight_gsm: number | string | null;
  meter_per_pc: number | string | null;
  fabric_type: string | null;
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDc(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, '0')}/${MONTHS[m - 1] ?? '???'}/${String(y).slice(-2)}`;
}

function num(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtMetres(v: number): string {
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPiece(v: number): string {
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Chunk an array of bundles into rows of N for the printed grid. */
function chunk<T>(arr: ReadonlyArray<T>, size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Returns a 0-based piece count = the maximum pieces across all bundles
 *  in this item. Used to decide how many "Pc" rows to render. */
function maxPiecesInItem(bundles: BundleJson[]): number {
  let m = 0;
  for (const b of bundles) {
    const len = Array.isArray(b.pieces) ? b.pieces.length : 0;
    if (len > m) m = len;
  }
  return m;
}

const BUNDLES_PER_ROW = 7;
/** Bundle-row tables per printed page — keeps every physical sheet showing
 *  exactly this many rows so pagination is fully predictable. */
const ROWS_PER_PAGE = 2;

// ────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────

export default async function DcPrintPage({
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
  const companyP = loadCompany();
  const [hdrRes, itemsRes] = await Promise.all([
    sb.from('delivery_challan')
      .select('id, code, void_code, dc_date, status, production_mode, entry_mode, bill_to_name, bill_to_address, bill_to_gstin, bill_to_state, bill_to_state_code, ship_to_same, ship_to_name, ship_to_address, ship_to_gstin, ship_to_state, ship_to_state_code, vehicle_no, notes, total_metres, total_pieces, total_bundles')
      .eq('id', numericId)
      .maybeSingle(),
    sb.from('delivery_challan_item')
      .select('id, sno, fabric_quality_id, description, hsn, metres, pieces, bundles, bundles_detail')
      .eq('dc_id', numericId)
      .order('sno'),
  ]);

  const COMPANY = await companyP;
  const dc = hdrRes.data as DcHeader | null;
  if (!dc) notFound();

  const itemRows = (itemsRes.data ?? []) as DcItemRow[];

  // Pull fabric_quality details for the per-item summary box.
  const qualityIds = Array.from(new Set(
    itemRows.map((r) => r.fabric_quality_id).filter((x): x is number => x != null),
  ));
  let qualityById = new Map<number, FabricQualityMeta>();
  if (qualityIds.length > 0) {
    const qRes = await sb
      .from('fabric_quality')
      .select('id, code, name, hsn, reed, pick_per_inch, width_in, weight_gsm, meter_per_pc, fabric_type')
      .in('id', qualityIds);
    qualityById = new Map<number, FabricQualityMeta>(
      ((qRes.data ?? []) as FabricQualityMeta[]).map((q) => [q.id, q]),
    );
  }

  // Resolve ship-to display.
  const shipToName    = dc.ship_to_same ? (dc.bill_to_name ?? '')    : (dc.ship_to_name ?? '');
  const shipToAddress = dc.ship_to_same ? (dc.bill_to_address ?? '') : (dc.ship_to_address ?? '');
  const shipToGstin   = dc.ship_to_same ? (dc.bill_to_gstin ?? '')   : (dc.ship_to_gstin ?? '');
  const shipToState   = dc.ship_to_same ? (dc.bill_to_state ?? '')   : (dc.ship_to_state ?? '');
  const shipToCode    = dc.ship_to_same ? (dc.bill_to_state_code ?? '') : (dc.ship_to_state_code ?? '');
  // Cancelled DCs have `code` nulled; the original number lives in void_code.
  const dcDisplayCode = dc.code ?? dc.void_code ?? '';

  // ── Group items by quality ──
  // A batch DC combines several production batches (one delivery_challan_item
  // each). Batches that share a fabric quality are MERGED into one continuous
  // bundle grid and one summary line; DIFFERENT qualities stay separate and
  // are never summed into a single mixed total. Bundle numbers run
  // continuously across the whole DC (1..N), flowing quality group by group.
  interface QualityGroup {
    key: string;
    fq: FabricQualityMeta | null;
    qualityLabel: string;
    hsn: string | null;
    isTowel: boolean;
    bundles: BundleJson[];
    totalMetres: number;
    totalPieces: number;
    totalBundles: number;
  }

  const groupOrder: string[] = [];
  const groupMap = new Map<string, QualityGroup>();

  for (const item of itemRows) {
    const fq = item.fabric_quality_id != null ? (qualityById.get(item.fabric_quality_id) ?? null) : null;
    // Same fabric_quality_id → same group. Items with no quality id never
    // merge (each keyed by its own row id) so distinct free-text lines stay
    // separate.
    const key = item.fabric_quality_id != null ? `q:${item.fabric_quality_id}` : `i:${item.id}`;
    const isTowelQuality = fq?.fabric_type === 'towel';

    const bundles = Array.isArray(item.bundles_detail) ? item.bundles_detail : [];

    let itemMetres = 0;
    let itemPieces = 0;
    let hasDecimalValue = false;
    for (const b of bundles) {
      for (const p of (b.pieces ?? [])) {
        const v = num(p);
        if (v > 0) {
          itemMetres += v; itemPieces += 1;
          if (!Number.isInteger(v)) hasDecimalValue = true;
        }
      }
    }
    let itemBundles = bundles.length;

    // Summary-mode rows have no bundles_detail to roll up - take the totals
    // straight off the row instead.
    if (dc.entry_mode === 'summary') {
      itemMetres  = num(item.metres);
      itemPieces  = item.pieces  ?? 0;
      itemBundles = item.bundles ?? 0;
      hasDecimalValue = !Number.isInteger(itemMetres);
    }

    const isTowel = isTowelQuality && !hasDecimalValue;

    let g = groupMap.get(key);
    if (!g) {
      g = {
        key,
        fq,
        qualityLabel: fq ? `${fq.code}${fq.name ? ' \u2014 ' + fq.name : ''}` : (item.description || '-'),
        hsn: item.hsn ?? fq?.hsn ?? null,
        isTowel: true,
        bundles: [],
        totalMetres: 0,
        totalPieces: 0,
        totalBundles: 0,
      };
      groupMap.set(key, g);
      groupOrder.push(key);
    }
    g.bundles.push(...bundles);
    g.totalMetres += itemMetres;
    g.totalPieces += itemPieces;
    g.totalBundles += itemBundles;
    // A merged group counts as towel only if EVERY batch in it is towel.
    g.isTowel = g.isTowel && isTowel;
  }

  // Attach continuous bundle offsets and formatted specs per group. Bundle
  // numbers run continuously across the whole DC (not just within one
  // quality), so the grid always reads 1..N regardless of pagination.
  let runningBundleOffset = 0;
  const groups = groupOrder.map((key) => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const g = groupMap.get(key)!;
    const bundleRows = chunk(g.bundles, BUNDLES_PER_ROW);
    const maxPieces = Math.max(1, maxPiecesInItem(g.bundles));
    const bundleOffset = runningBundleOffset;
    runningBundleOffset += g.bundles.length;
    const fq = g.fq;
    const reedXpick = fq?.reed && fq?.pick_per_inch
      ? `${Number(fq.reed)} \u00d7 ${Number(fq.pick_per_inch)}`
      : '-';
    const widthLabel = fq?.width_in ? `${Number(fq.width_in)} INCH` : '-';
    const weightLabel = fq?.weight_gsm ? `${Number(fq.weight_gsm)} GMS` : '-';
    return { ...g, bundleRows, maxPieces, bundleOffset, reedXpick, widthLabel, weightLabel };
  });

  // A single-quality DC keeps the classic one-box summary; a mixed DC shows
  // one summary block per quality (no merged grand total).
  const singleQuality = groups.length === 1;

  // Detailed-mode groups whose bundle grid came back empty (no bundle
  // breakdown captured) never contribute a row to the pagination below —
  // show their "not captured" notice once, up front, on page 1.
  const emptyDetailGroups = dc.entry_mode !== 'summary'
    ? groups.filter((g) => g.bundleRows.length === 0)
    : [];

  // ── Build print pages ──────────────────────────────────────────────
  // Flatten every group's bundle rows into one ordered list, then chunk
  // that list into ROWS_PER_PAGE-row pages. Because this happens here in
  // JS (not via browser reflow), we know in advance exactly how many pages
  // there are and which is first/last.
  interface RowUnit {
    groupKey: string;
    qualityLabel: string;
    hsn: string | null;
    rowBundles: BundleJson[];
    maxPieces: number;
    bundleOffset: number;
    startBundle: number;
  }
  interface PageSegment {
    groupKey: string;
    qualityLabel: string;
    hsn: string | null;
    isContinuation: boolean;
    rows: RowUnit[];
  }

  const rowUnits: RowUnit[] = [];
  if (dc.entry_mode !== 'summary') {
    for (const g of groups) {
      g.bundleRows.forEach((rowBundles, rowIdx) => {
        rowUnits.push({
          groupKey: g.key,
          qualityLabel: g.qualityLabel,
          hsn: g.hsn,
          rowBundles,
          maxPieces: g.maxPieces,
          bundleOffset: g.bundleOffset,
          startBundle: rowIdx * BUNDLES_PER_ROW,
        });
      });
    }
  }

  const rowPages: RowUnit[][] = rowUnits.length > 0
    ? Array.from(
        { length: Math.ceil(rowUnits.length / ROWS_PER_PAGE) },
        (_, i) => rowUnits.slice(i * ROWS_PER_PAGE, (i + 1) * ROWS_PER_PAGE),
      )
    : [[]];
  const pageCount = rowPages.length;

  // Group each page's rows into contiguous same-quality segments, tracking
  // whether a group's "QUALITY :" line already appeared on an earlier page
  // (continuation pages label it "(Contd.)" instead of repeating cold).
  const seenGroupKeys = new Set<string>();
  const pages: PageSegment[][] = rowPages.map((rows) => {
    const segments: PageSegment[] = [];
    for (const row of rows) {
      const lastSeg = segments[segments.length - 1];
      if (lastSeg && lastSeg.groupKey === row.groupKey) {
        lastSeg.rows.push(row);
        continue;
      }
      const isContinuation = seenGroupKeys.has(row.groupKey);
      seenGroupKeys.add(row.groupKey);
      segments.push({
        groupKey: row.groupKey,
        qualityLabel: row.qualityLabel,
        hsn: row.hsn,
        isContinuation,
        rows: [row],
      });
    }
    return segments;
  });

  return (
    <>
      {/*
        Page-level styles. Keep them inline so the print route is fully
        self-contained — no dependency on whether the global layout is
        loaded or whether tailwind purges these classes.
      */}
      <style>{`
        /* ── Multi-page print: header/footer repeat on every printed page ──
           Pagination is decided in JS above (ROWS_PER_PAGE bundle rows per
           .dc-page), so each page here is a real, separate DOM block with a
           hard page-break between them — not a single flowing column relying
           on the browser to guess where to cut. Page 1 carries the full
           header (company + DC meta + Bill To/Ship To); continuation pages
           get a slim one-line header instead. The full signature/summary
           footer only ever appears on the last page; every other page gets
           a slim address footer. The @page rule injects the "Page N of M"
           counter at the bottom of every sheet. */
        @page {
          size: A4;
          margin: 7mm 8mm 8mm 8mm;
          @bottom-center {
            content: "Page " counter(page) " of " counter(pages);
            font-family: 'Calibri', Arial, sans-serif;
            font-size: 10px;
            font-weight: 700;
            color: #222;
          }
        }
        @media print {
          .no-print { display: none !important; }
          html, body { background: #fff !important; }
          .dc-sheet { display: block !important; margin: 0 !important; }
          /* Critical: keep each .dc-page full-printable-page tall so the
             flex column actually stretches and 'margin-top:auto' on the
             footer pushes it to the bottom of that page. 100vh in print
             mode = the printable area height between the @page margins. */
          .dc-page { box-shadow: none !important; border: none !important; padding: 0 !important; min-height: 100vh !important; margin: 0 !important; width: auto !important; display: flex !important; flex-direction: column !important; }
          .dc-page + .dc-page { break-before: page; page-break-before: always; }
          /* Tighten page breaks: don't split a bundle table across two
             pages if it can be avoided, and never orphan a header row. */
          .dc-item table.bundles { page-break-inside: avoid; }
          .dc-item table.bundles thead { display: table-header-group; }
          .dc-item table.bundles tfoot { display: table-footer-group; }
        }
        body { background: #f3f4f6; }
        .dc-sheet { display: flex; flex-direction: column; align-items: center; margin: 16px auto; }
        /* Each .dc-page is one physical A4 sheet — a flex column so the
           footer block (full or slim) can use margin-top: auto and stick to
           the bottom of that page even when its content is short. */
        .dc-page {
          width: 210mm;
          min-height: 297mm;
          margin-bottom: 16px;
          background: #fff;
          color: #111;
          padding: 10mm 12mm;
          box-sizing: border-box;
          font-family: 'Calibri', Arial, sans-serif;
          font-size: 12px;
          font-weight: 600;
          line-height: 1.4;
          border: 1px solid #d4d4d4;
          box-shadow: 0 4px 24px rgba(0,0,0,0.08);
          display: flex;
          flex-direction: column;
          position: relative;
        }
        .dc-page:last-child { margin-bottom: 0; }
        .dc-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 8px; border-bottom: 2px solid #000; padding-bottom: 8px; }
        .dc-head .brandwrap { display: flex; align-items: center; gap: 12px; }
        .dc-head .brand { font-size: 32px; font-weight: 900; letter-spacing: 1px; color: #111; line-height: 1; }
        .dc-head .doctype { text-align: right; font-size: 19px; font-weight: 800; letter-spacing: 1.2px; color: #111; }
        .dc-orig { text-align: right; font-size: 11px; font-weight: 700; margin: 5px 0; color: #222; letter-spacing: 0.5px; }
        .dc-meta { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; border: 1px solid #000; }
        .dc-meta > div { border-right: 0.5px solid #000; padding: 5px 10px; }
        .dc-meta > div:last-child { border-right: none; }
        .dc-meta .lbl { font-size: 10px; color: #333; letter-spacing: 0.5px; font-weight: 700; }
        .dc-meta .val { font-size: 13px; font-weight: 800; }
        .dc-secbar { background: #e8e8e8; font-weight: 800; font-size: 12px; padding: 4px 10px; border: 1px solid #000; border-top: none; letter-spacing: 0.6px; }
        .dc-deliv { border: 1px solid #000; border-top: none; padding: 6px 12px; display: flex; justify-content: space-between; align-items: flex-start; font-size: 12px; font-weight: 600; }
        .dc-deliv .for { font-weight: 800; font-size: 13px; }
        .dc-billship { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #000; border-top: none; }
        .dc-billship > div { padding: 6px 12px; }
        .dc-billship > div + div { border-left: 0.5px solid #000; }
        .dc-billship .tag { display: inline-block; background: #000; color: #fff; font-size: 11px; padding: 3px 13px; letter-spacing: 1.5px; margin-bottom: 6px; font-weight: 800; }
        .dc-billship .gst { font-size: 12px; font-weight: 700; margin-bottom: 4px; }
        .dc-billship .party { font-weight: 800; font-size: 13px; margin-bottom: 4px; }
        .dc-billship .addr { font-size: 12px; font-weight: 600; color: #111; }
        .dc-billship .ps { font-size: 11px; color: #222; margin-top: 6px; font-weight: 700; letter-spacing: 0.3px; }
        /* Slim one-line header for continuation pages (page 2+) — just
           enough to identify the DC/party if a sheet gets separated. */
        .dc-slimhead { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1.4px solid #000; font-size: 11px; font-weight: 700; color: #333; }
        .dc-slimhead .name { font-weight: 900; font-size: 13px; color: #111; }
        .dc-item { border: 1px solid #000; border-top: none; }
        .dc-item .qline { display: grid; grid-template-columns: 1fr 1fr; padding: 5px 12px; font-size: 12px; font-weight: 800; background: #fafafa; border-bottom: 0.5px solid #000; }
        .dc-item .qline .agent { text-align: right; }
        .dc-item table.bundles { width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed; }
        .dc-item table.bundles th, .dc-item table.bundles td { border: 0.5px solid #000; padding: 3px 6px; text-align: right; height: 18px; font-weight: 700; overflow: hidden; }
        .dc-item table.bundles th { background: #e8e8e8; font-weight: 800; text-align: center; font-size: 12px; }
        .dc-item table.bundles td.empty { color: #ccc; font-weight: 500; }
        .dc-item table.bundles td.lbl, .dc-item table.bundles th.lbl { text-align: left; background: #fafafa; font-weight: 700; width: 56px; }
        .dc-item table.bundles tr.total td { background: #efefef; font-weight: 800; border-top: 1.4px solid #000; font-size: 12px; }
        .dc-item .summary { display: grid; grid-template-columns: 1fr 1fr; border-top: 0.5px solid #000; }
        .dc-item .summary > div { padding: 5px 12px; }
        .dc-item .summary > div + div { border-left: 0.5px solid #000; }
        .dc-item .summary table { width: 100%; font-size: 12px; }
        .dc-item .summary td { padding: 3px 0; }
        .dc-item .summary td.l { color: #222; font-weight: 700; }
        .dc-item .summary td.v { text-align: right; font-weight: 800; font-size: 12px; }
        /* Consolidated whole-DC summary (replaces per-batch subtotal boxes). */
        .dc-summary { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #000; border-top: none; }
        .dc-summary > div { padding: 6px 12px; }
        .dc-summary > div + div { border-left: 0.5px solid #000; }
        .dc-summary table { width: 100%; font-size: 13px; }
        .dc-summary td { padding: 3px 0; }
        .dc-summary td.l { color: #222; font-weight: 700; }
        .dc-summary td.v { text-align: right; font-weight: 800; font-size: 13px; }
        .dc-summary td.v.big { font-size: 15px; }
        .notforsale { font-size: 13px; font-weight: 900; color: #000; letter-spacing: 1.5px; border: 1.6px solid #000; padding: 1px 9px; white-space: nowrap; }
        /* Signature footer block — margin-top:auto pushes it to the bottom
           of the LAST .dc-page's flex column. The whole bottom block
           (vehicle + signatures + address + totals) is pushed down as ONE
           unit so the address/totals never get shoved onto their own page. */
        .dc-bottom { margin-top: auto; }
        .dc-foot { border: 1px solid #000; display: grid; grid-template-columns: 1fr 1fr; min-height: 100px; }
        .dc-foot > div { padding: 9px 12px; font-size: 12px; font-weight: 700; }
        .dc-foot > div + div { border-left: 0.5px solid #000; text-align: center; }
        .dc-foot .sig { font-weight: 800; margin-bottom: 34px; font-size: 12px; letter-spacing: 0.4px; }
        .dc-foot .auth { font-weight: 800; letter-spacing: 0.6px; font-size: 12px; }
        .dc-foot .seal { color: #333; font-weight: 700; letter-spacing: 0.5px; margin-top: 6px; text-align: center; font-size: 11px; }
        .dc-addrfoot { margin-top: 6px; padding-top: 6px; border-top: 1px solid #000; text-align: center; font-size: 11px; font-weight: 700; line-height: 1.55; }
        .dc-addrfoot .small { font-weight: 600; font-size: 10px; }
        /* Slim address-only footer for every page except the last. */
        .dc-slimfoot { margin-top: auto; padding-top: 6px; border-top: 1px solid #999; text-align: center; font-size: 10px; font-weight: 700; color: #555; }
        .dc-watermark { position: relative; }
        /* DRAFT watermark removed per operator request — draft DCs print
           clean. The CANCELLED watermark is retained because it's a
           safety signal (prevents an old cancelled DC being mistaken
           for a live one). Applied per-page so it shows on every sheet. */
        .dc-status-cancelled::before { content: 'CANCELLED'; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 62px; color: rgba(220, 38, 38, 0.15); font-weight: 900; letter-spacing: 8px; pointer-events: none; transform: rotate(-30deg); }
      `}</style>

      <PrintActions dcId={dc.id} dcCode={dcDisplayCode} partyName={dc.bill_to_name} dcDate={dc.dc_date} />

      <div className="dc-sheet">
        {pages.map((segments, pageIdx) => {
          const isFirstPage = pageIdx === 0;
          const isLastPage = pageIdx === pageCount - 1;
          return (
            <div
              key={pageIdx}
              className={'dc-page dc-watermark ' + (dc.status === 'cancelled' ? 'dc-status-cancelled' : '')}
            >
              {isFirstPage ? (
                <>
                  {/* ───── Header band: logo + brand on the left, "DELIVERY CHELLAN" on the right ───── */}
                  <div className="dc-head">
                    <div className="brandwrap">
                      <BrandLogo variant="mark" height={52} />
                      <span className="brand">{COMPANY.name}</span>
                    </div>
                    <div className="doctype">DELIVERY CHELLAN</div>
                  </div>

                  <div className="dc-orig">{dc.status === 'invoiced' ? 'ORIGINAL COPY' : 'ORIGINAL COPY'}</div>

                  {/* ───── Meta strip ───── */}
                  <div className="dc-meta">
                    <div><div className="lbl">CHELLAN DATE</div><div className="val">{fmtDc(dc.dc_date)}</div></div>
                    <div><div className="lbl">CHELLAN #</div><div className="val">{dcDisplayCode}</div></div>
                    <div><div className="lbl">GSTIN</div><div className="val">{COMPANY.gstin}</div></div>
                    <div><div className="lbl">STATE / CODE</div><div className="val">{COMPANY.state} / {COMPANY.stateCode}</div></div>
                  </div>

                  {/* ───── Delivery Details section ───── */}
                  <div className="dc-secbar">DELIVERY DETAILS :</div>
                  <div className="dc-deliv">
                    <div style={{ fontSize: 12, color: '#555' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span>Mode: <span style={{ fontWeight: 700, color: '#111', textTransform: 'capitalize' }}>{dc.production_mode}</span></span>
                        {dc.production_mode === 'jobwork' && (
                          <span className="notforsale">NOT FOR SALES</span>
                        )}
                      </div>
                      <div style={{ marginTop: 6 }}>
                        Vehicle No: <span style={{ fontWeight: 700, color: '#111' }}>{dc.vehicle_no || '-'}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="for">FOR, {COMPANY.name}</div>
                      <div>STATE CODE : {COMPANY.stateCode}</div>
                    </div>
                  </div>

                  {/* ───── Bill To / Ship To ───── */}
                  <div className="dc-billship">
                    <div>
                      <div className="tag">BILL TO</div>
                      <div className="gst">GSTIN : {dc.bill_to_gstin || '-'}</div>
                      <div className="party">{dc.bill_to_name || '-'}</div>
                      <div className="addr">{(dc.bill_to_address || '').split('\n').map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}</div>
                      <div className="ps">
                        PLACE OF SUPPLY : {dc.bill_to_state || '-'} &nbsp;&middot;&nbsp; STATE CODE : {dc.bill_to_state_code || '-'}
                      </div>
                    </div>
                    <div>
                      <div className="tag">SHIP TO</div>
                      <div className="gst">GSTIN : {shipToGstin || '-'}</div>
                      <div className="party">{shipToName || '-'}</div>
                      <div className="addr">{(shipToAddress || '').split('\n').map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}</div>
                      <div className="ps">
                        PLACE OF SUPPLY : {shipToState || '-'} &nbsp;&middot;&nbsp; STATE CODE : {shipToCode || '-'}
                      </div>
                    </div>
                  </div>

                  {emptyDetailGroups.map((g) => (
                    <div className="dc-item" key={`empty-${g.key}`}>
                      <div className="qline">
                        <div>QUALITY : {g.qualityLabel}</div>
                        <div className="agent">HSN : {g.hsn || '-'}</div>
                      </div>
                      <div style={{ padding: 12, textAlign: 'center', color: '#888', fontSize: 11 }}>
                        No bundle breakdown captured.
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <div className="dc-slimhead">
                  <span className="name">{COMPANY.name}</span>
                  <span>CHELLAN # {dcDisplayCode}</span>
                  <span>{fmtDc(dc.dc_date)}</span>
                  <span>{dc.bill_to_name || '-'}</span>
                  <span>DELIVERY CHELLAN (Contd.)</span>
                </div>
              )}

              {/* ───── Items: one merged grid per quality. Batches of the same
                    quality are combined; different qualities stay separate. Bundle
                    numbers run continuously across the whole DC (1..N). ───── */}
              {groups.length === 0 ? (
                <div style={{ border: '1px solid #000', borderTop: 'none', padding: 14, textAlign: 'center', color: '#888' }}>
                  No items on this DC.
                </div>
              ) : dc.entry_mode === 'summary' ? (
                groups.map((g) => (
                  <div className="dc-item" key={g.key}>
                    <div className="qline">
                      <div>QUALITY : {g.qualityLabel}</div>
                      <div className="agent">HSN : {g.hsn || '-'}</div>
                    </div>
                    <div style={{ padding: '8px 10px', fontSize: 11, color: '#555', fontStyle: 'italic', background: '#fafafa', borderBottom: '0.5px solid #000' }}>
                      Summary entry &mdash; bundle-wise piece breakdown not captured for this DC.
                    </div>
                  </div>
                ))
              ) : (
                segments.map((seg) => (
                  <div className="dc-item" key={`${seg.groupKey}-${pageIdx}`}>
                    <div className="qline">
                      <div>QUALITY : {seg.qualityLabel}{seg.isContinuation ? ' (Contd.)' : ''}</div>
                      <div className="agent">HSN : {seg.hsn || '-'}</div>
                    </div>
                    {seg.rows.map((row, rowIdx) => (
                      <table className="bundles" key={rowIdx}>
                        <thead>
                          <tr>
                            <th className="lbl" style={{ minWidth: 50 }}>BUNDLE</th>
                            {Array.from({ length: BUNDLES_PER_ROW }).map((_, i) => {
                              const b = row.rowBundles[i];
                              const label = b ? (row.bundleOffset + row.startBundle + i + 1) : '';
                              return <th key={i}>{label}</th>;
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {Array.from({ length: row.maxPieces }).map((_, pIdx) => (
                            <tr key={pIdx}>
                              <td className="lbl">Pc {pIdx + 1}</td>
                              {Array.from({ length: BUNDLES_PER_ROW }).map((_, bIdx) => {
                                const b = row.rowBundles[bIdx];
                                const v = b?.pieces?.[pIdx];
                                const n = num(v);
                                return (
                                  <td key={bIdx} className={n > 0 ? '' : 'empty'}>
                                    {n > 0 ? fmtPiece(n) : '-'}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                          <tr className="total">
                            <td className="lbl">TOTAL</td>
                            {Array.from({ length: BUNDLES_PER_ROW }).map((_, bIdx) => {
                              const b = row.rowBundles[bIdx];
                              if (!b) return <td key={bIdx}>0.00</td>;
                              const t = (b.pieces ?? []).reduce<number>((s, p) => s + num(p), 0);
                              return <td key={bIdx}>{fmtMetres(t)}</td>;
                            })}
                          </tr>
                        </tbody>
                      </table>
                    ))}
                  </div>
                ))
              )}

              {isLastPage ? (
                <>
                  {/* ───── Summary: one block PER QUALITY (spec + that quality's own
                        totals). Qualities are never summed into a single mixed total.
                        A single-quality DC naturally shows exactly one block. ───── */}
                  {groups.map((g) => (
                    <div className="dc-summary" key={`sum-${g.key}`}>
                      <div>
                        {!singleQuality && (
                          <div style={{ fontWeight: 800, fontSize: 12, marginBottom: 4 }}>QUALITY : {g.qualityLabel}</div>
                        )}
                        <table>
                          <tbody>
                            <tr><td className="l">REED &times; PICK</td><td className="v">{g.reedXpick}</td></tr>
                            <tr><td className="l">FABRIC WIDTH</td><td className="v">{g.widthLabel}</td></tr>
                            <tr><td className="l">FABRIC WEIGHT</td><td className="v">{g.weightLabel}</td></tr>
                          </tbody>
                        </table>
                      </div>
                      <div>
                        <table>
                          <tbody>
                            {g.isTowel ? (
                              <>
                                <tr><td className="l">TOTAL TOWEL PCS</td><td className="v big">{Math.round(g.totalMetres)}</td></tr>
                                <tr><td className="l">TOTAL PCS</td><td className="v big">{g.totalPieces}</td></tr>
                              </>
                            ) : (
                              <>
                                <tr><td className="l">TOTAL METRES</td><td className="v big">{fmtMetres(g.totalMetres)}</td></tr>
                                <tr><td className="l">TOTAL PIECES</td><td className="v big">{g.totalPieces}</td></tr>
                              </>
                            )}
                            <tr><td className="l">TOTAL BUNDLES</td><td className="v big">{g.totalBundles}</td></tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}

                  {/* ───── Bottom block: vehicle + signatures + address + totals.
                        Grouped so they sit together at the page bottom on ONE page. ───── */}
                  <div className="dc-bottom">
                    <div className="dc-foot">
                      <div>
                        <div className="sig">RECEIVER&apos;S SIGNATURE &amp; DATE</div>
                        <div className="seal">COMMON SEAL</div>
                      </div>
                      <div>
                        <div style={{ marginBottom: 34 }}>FOR, {COMPANY.name}</div>
                        <div className="auth">AUTHORISED SIGNATORY</div>
                      </div>
                    </div>

                    {/* ───── Address footer ───── */}
                    <div className="dc-addrfoot">
                      <div>{COMPANY.address}</div>
                      <div className="small">
                        MOB: {COMPANY.phones.join(' \u00b7  MOB: ')} &nbsp;&middot;&nbsp; E-mail: {COMPANY.email}
                      </div>
                    </div>

                    {/* The small "DC Totals" cross-check line was removed — the
                        per-quality TOTAL METRES / PIECES / BUNDLES box above
                        already carries the totals, and the extra line was
                        overflowing single-page DCs onto a near-empty page 2. */}
                  </div>
                </>
              ) : (
                <div className="dc-slimfoot">
                  {COMPANY.address} &nbsp;&middot;&nbsp; MOB: {COMPANY.phones[0] ?? ''} &nbsp;&middot;&nbsp; Continued on next page&hellip;
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
