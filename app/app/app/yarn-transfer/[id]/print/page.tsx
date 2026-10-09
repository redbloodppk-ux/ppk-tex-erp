/**
 * Yarn Transfer — transport copy (A4).
 *
 * Travels with the yarn when it moves between the sizing mill, our
 * warehouse and an outsource / job-work weaver. States clearly that the
 * goods are NOT FOR SALE and move for job work only, with the goods
 * description, the purchase bill they came on (date + invoice no), the
 * moving date and the destination.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { BrandLogo } from '@/app/components/brand-logo';
import { loadCompany } from '@/lib/load-company';
import { formatDay } from '@/lib/utils';
import { TransferPrintActions } from './print-actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<{ title: string }> {
  const { id } = await params;
  return { title: `Yarn transfer ${id} — Transport copy` };
}

interface Place { title: string; name: string; address: string; gstin: string }

const HSN_BY_TYPE: Record<string, string> = { cotton: '5205', polyester: '5402', blend: '5206' };

export default async function YarnTransferPrintPage({ params }: { params: Promise<{ id: string }> }): Promise<React.ReactElement> {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) notFound();
  const sb = (await createClient()) as any;

  const { data: t } = await sb.from('yarn_transfer').select('*').eq('id', id).maybeSingle();
  if (!t) notFound();

  const [company, countRes, lotRes, sizingRes, partyRes] = await Promise.all([
    loadCompany(),
    sb.from('yarn_count').select('code, display_name, yarn_type').eq('id', t.yarn_count_id).maybeSingle(),
    t.purchase_lot_id != null
      ? sb.from('yarn_lot').select('lot_code, invoice_no, received_date, received_kg, bag_count, supplier:supplier_party_id ( name, gstin )').eq('id', t.purchase_lot_id).maybeSingle()
      : Promise.resolve({ data: null }),
    // The sizing mill the yarn sits at: the party on the latest sizing job
    // sent on or before the moving date.
    (t.from_loc === 'sizing' || t.to_loc === 'sizing')
      ? sb.from('sizing_job').select('party:party_id ( name, billing_address, gstin )')
          .lte('date_sent', t.transfer_date).not('party_id', 'is', null)
          .order('date_sent', { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    sb.from('jobwork_party').select('id, name, billing_address, city, gstin')
      .in('id', [t.from_party_id, t.to_party_id].filter((x: number | null) => x != null).concat([-1])),
  ]);

  const count = countRes.data as { code: string; display_name: string | null; yarn_type: string | null } | null;
  const lot = lotRes.data as any;
  const sizingParty = (sizingRes.data as any)?.party ?? null;
  const parties = new Map<number, any>(((partyRes.data ?? []) as any[]).map((p) => [p.id, p]));

  const place = (loc: string, partyId: number | null, title: string): Place => {
    if (loc === 'in_house') return { title, name: `${company.name} (In-house warehouse)`, address: company.address, gstin: company.gstin };
    if (loc === 'sizing') {
      return {
        title,
        name: sizingParty?.name ? `${sizingParty.name} (Sizing — our yarn held for job work)` : 'Sizing mill',
        address: sizingParty?.billing_address ?? '',
        gstin: sizingParty?.gstin ?? '',
      };
    }
    const p = parties.get(partyId ?? -1);
    return { title, name: p?.name ? `${p.name} (Job worker)` : 'Weaver', address: [p?.billing_address, p?.city].filter(Boolean).join(', '), gstin: p?.gstin ?? '' };
  };
  const fromP = place(t.from_loc, t.from_party_id, 'Despatched from');
  const toP = place(t.to_loc, t.to_party_id, 'Destination (deliver to)');

  const kg = Number(t.kg);
  const rate = t.cost_per_kg != null ? Number(t.cost_per_kg) : null;
  const value = rate != null ? kg * rate : null;
  const hsn = HSN_BY_TYPE[(count?.yarn_type ?? '').toLowerCase()] ?? '';
  const fmtKg = (v: number): string => v.toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const fmtRs = (v: number): string => v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const desc = `${count?.display_name ?? count?.code ?? 'Yarn'} yarn${count?.code ? ` (${count.code})` : ''} — in bags, for weft`;
  const code = t.transfer_code ?? `YT-${id}`;
  const filename = `${code} ${formatDay(t.transfer_date)} Transport copy`.replace(/[\\/:*?"<>|]/g, '-');

  return (
    <>
      <TransferPrintActions id={id} filename={filename} />
      <style>{`
        @page { size: A4; margin: 10mm; }
        @media print {
          .no-print { display: none !important; }
          html, body { background: #fff !important; }
          .yt-page { box-shadow: none !important; border: none !important; margin: 0 !important; padding: 0 !important; width: auto !important; min-height: 0 !important; }
        }
        body { background: #f3f4f6; }
        .yt-page { width: 210mm; min-height: 297mm; margin: 16px auto; background: #fff; color: #111; padding: 12mm; box-sizing: border-box;
          font-family: 'Calibri', Arial, sans-serif; font-size: 12.5px; font-weight: 600; line-height: 1.45; border: 1px solid #d4d4d4; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
        .yt-head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000; padding-bottom: 8px; }
        .yt-head .brandwrap { display: flex; align-items: center; gap: 12px; }
        .yt-head .brand { font-size: 28px; font-weight: 900; letter-spacing: 1px; line-height: 1; }
        .yt-head .co { font-size: 11px; font-weight: 600; margin-top: 4px; max-width: 95mm; }
        .yt-head .doctype { text-align: right; font-size: 18px; font-weight: 800; letter-spacing: 1px; }
        .yt-head .doctype small { display: block; font-size: 11px; font-weight: 700; letter-spacing: .5px; }
        .yt-banner { margin: 10px 0; border: 2px solid #000; text-align: center; padding: 7px; font-size: 16px; font-weight: 900; letter-spacing: 1px; }
        .yt-meta { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #000; }
        .yt-meta > div { padding: 5px 9px; border-right: 1px solid #000; }
        .yt-meta > div:last-child { border-right: none; }
        .lbl { font-size: 10px; font-weight: 700; color: #333; letter-spacing: .5px; text-transform: uppercase; }
        .val { font-size: 13.5px; font-weight: 800; }
        .yt-places { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #000; border-top: none; }
        .yt-places > div { padding: 7px 9px; min-height: 26mm; }
        .yt-places > div:first-child { border-right: 1px solid #000; }
        .yt-places .nm { font-size: 13.5px; font-weight: 800; margin-top: 2px; }
        table.goods { width: 100%; border-collapse: collapse; margin-top: 10px; }
        table.goods th, table.goods td { border: 1px solid #000; padding: 6px 8px; }
        table.goods th { font-size: 11px; text-transform: uppercase; background: #f2f2f2; }
        .r { text-align: right; } .c { text-align: center; }
        .yt-purchase { margin-top: 10px; border: 1px solid #000; display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; }
        .yt-purchase > div { padding: 5px 9px; border-right: 1px solid #000; }
        .yt-purchase > div:last-child { border-right: none; }
        .yt-sec { margin-top: 10px; font-size: 11px; font-weight: 800; letter-spacing: .5px; text-transform: uppercase; }
        .yt-decl { margin-top: 10px; border: 1px dashed #000; padding: 8px 10px; font-size: 12px; }
        .yt-sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 26mm; text-align: center; font-size: 11.5px; }
        .yt-sign > div { border-top: 1px solid #000; padding-top: 4px; }
      `}</style>

      <div className="yt-page">
        <div className="yt-head">
          <div className="brandwrap">
            <BrandLogo variant="mark" height={48} />
            <div>
              <div className="brand">{company.name}</div>
              <div className="co">{company.address}<br />GSTIN: {company.gstin} &middot; Ph: {company.phones.join(', ')}</div>
            </div>
          </div>
          <div className="doctype">DELIVERY NOTE<small>TRANSPORT COPY</small></div>
        </div>

        <div className="yt-banner">NOT FOR SALE — FOR JOB WORK PURPOSE ONLY</div>

        <div className="yt-meta">
          <div><div className="lbl">Note No</div><div className="val">{code}</div></div>
          <div><div className="lbl">Moving date</div><div className="val">{formatDay(t.transfer_date)}</div></div>
          <div><div className="lbl">Vehicle no</div><div className="val">{t.vehicle_no || '—'}</div></div>
          <div><div className="lbl">Purpose</div><div className="val">Job work (weaving)</div></div>
        </div>
        <div className="yt-places">
          {[fromP, toP].map((p) => (
            <div key={p.title}>
              <div className="lbl">{p.title}</div>
              <div className="nm">{p.name}</div>
              {p.address && <div>{p.address}</div>}
              {p.gstin && <div>GSTIN: {p.gstin}</div>}
            </div>
          ))}
        </div>

        <table className="goods">
          <thead>
            <tr>
              <th className="c" style={{ width: '8mm' }}>S.No</th>
              <th>Description of goods</th>
              <th className="c">HSN</th>
              <th className="r">Bags</th>
              <th className="r">Qty (kg)</th>
              <th className="r">Rate / kg</th>
              <th className="r">Value (₹)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="c">1</td>
              <td>{desc}{t.notes ? <div style={{ fontWeight: 500, fontSize: '11.5px' }}>{t.notes}</div> : null}</td>
              <td className="c">{hsn}</td>
              <td className="r">{t.bag_count > 0 ? t.bag_count : ''}</td>
              <td className="r">{fmtKg(kg)}</td>
              <td className="r">{rate != null ? fmtRs(rate) : ''}</td>
              <td className="r">{value != null ? fmtRs(value) : ''}</td>
            </tr>
            <tr>
              <td colSpan={3} className="r">Total</td>
              <td className="r">{t.bag_count > 0 ? t.bag_count : ''}</td>
              <td className="r">{fmtKg(kg)}</td>
              <td />
              <td className="r">{value != null ? fmtRs(value) : ''}</td>
            </tr>
          </tbody>
        </table>
        <div style={{ fontSize: '11px', marginTop: '3px' }}>Value shown is the purchase cost, for transport reference only — no sale or payment is involved.</div>

        <div className="yt-sec">Purchase details of the goods</div>
        <div className="yt-purchase" style={{ marginTop: 3 }}>
          <div><div className="lbl">Purchased from</div><div className="val">{lot?.supplier?.name ?? '—'}</div>{lot?.supplier?.gstin ? <div style={{ fontSize: 11 }}>GSTIN: {lot.supplier.gstin}</div> : null}</div>
          <div><div className="lbl">Invoice no</div><div className="val">{lot?.invoice_no ?? '—'}</div></div>
          <div><div className="lbl">Purchase date</div><div className="val">{lot?.received_date ? formatDay(lot.received_date) : '—'}</div></div>
          <div><div className="lbl">Our lot</div><div className="val">{lot?.lot_code ?? '—'}</div></div>
        </div>

        <div className="yt-decl">
          <b>Declaration:</b> The above goods are our own yarn, purchased by {company.name} under the invoice shown above.
          They are being moved from {fromP.name.replace(/ \(.*\)$/, '')} to {toP.name.replace(/ \(.*\)$/, '')} for job work (weaving) purpose only.
          This is <b>not a sale</b> and no consideration is charged.
        </div>

        <div className="yt-sign">
          <div>Driver signature</div>
          <div>Received by (with seal)</div>
          <div>For {company.name}<br />Authorised signatory</div>
        </div>
      </div>
    </>
  );
}
