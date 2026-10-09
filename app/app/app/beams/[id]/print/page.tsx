/**
 * Beam transport copy (A4) — empty warp beams going to / coming back
 * from the sizing mill. Returnable, not for sale, job work only.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { BrandLogo } from '@/app/components/brand-logo';
import { loadCompany } from '@/lib/load-company';
import { formatDay } from '@/lib/utils';
import { BeamPrintActions } from './print-actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<{ title: string }> {
  const { id } = await params;
  return { title: `Beam movement ${id} — Transport copy` };
}

export default async function BeamPrintPage({ params }: { params: Promise<{ id: string }> }): Promise<React.ReactElement> {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) notFound();
  const sb = (await createClient()) as any;
  const { data: m } = await sb.from('beam_movement').select('*').eq('id', id).maybeSingle();
  if (!m || (m.kind !== 'sent_to_sizing' && m.kind !== 'returned_from_sizing')) notFound();

  const [company, millRes] = await Promise.all([
    loadCompany(),
    m.party_id != null
      ? sb.from('party').select('name, billing_address, gstin').eq('id', m.party_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const mill = millRes.data as { name: string; billing_address: string | null; gstin: string | null } | null;

  const ours = { name: company.name, address: company.address, gstin: company.gstin };
  const theirs = { name: mill?.name ?? 'Sizing mill', address: mill?.billing_address ?? '', gstin: mill?.gstin ?? '' };
  const sending = m.kind === 'sent_to_sizing';
  const fromP = sending ? ours : theirs;
  const toP = sending ? theirs : ours;
  const code = m.code ?? `BG-${id}`;
  const filename = `${code} ${formatDay(m.move_date)} Beam transport copy`.replace(/[\\/:*?"<>|]/g, '-');

  return (
    <>
      <BeamPrintActions id={id} filename={filename} />
      <style>{`
        @page { size: A4; margin: 10mm; }
        @media print {
          .no-print { display: none !important; }
          html, body { background: #fff !important; }
          .bm-page { box-shadow: none !important; border: none !important; margin: 0 !important; padding: 0 !important; width: auto !important; min-height: 0 !important; }
        }
        body { background: #f3f4f6; }
        .bm-page { width: 210mm; min-height: 297mm; margin: 16px auto; background: #fff; color: #111; padding: 12mm; box-sizing: border-box;
          font-family: 'Calibri', Arial, sans-serif; font-size: 12.5px; font-weight: 600; line-height: 1.45; border: 1px solid #d4d4d4; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
        .bm-head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000; padding-bottom: 8px; }
        .bm-head .brandwrap { display: flex; align-items: center; gap: 12px; }
        .bm-head .brand { font-size: 28px; font-weight: 900; letter-spacing: 1px; line-height: 1; }
        .bm-head .co { font-size: 11px; margin-top: 4px; max-width: 95mm; }
        .bm-head .doctype { text-align: right; font-size: 18px; font-weight: 800; letter-spacing: 1px; }
        .bm-head .doctype small { display: block; font-size: 11px; font-weight: 700; }
        .bm-banner { margin: 10px 0; border: 2px solid #000; text-align: center; padding: 7px; font-size: 15px; font-weight: 900; letter-spacing: .8px; }
        .bm-meta { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #000; }
        .bm-meta > div { padding: 5px 9px; border-right: 1px solid #000; }
        .bm-meta > div:last-child { border-right: none; }
        .lbl { font-size: 10px; font-weight: 700; color: #333; letter-spacing: .5px; text-transform: uppercase; }
        .val { font-size: 13.5px; font-weight: 800; }
        .bm-places { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #000; border-top: none; }
        .bm-places > div { padding: 7px 9px; min-height: 26mm; }
        .bm-places > div:first-child { border-right: 1px solid #000; }
        .bm-places .nm { font-size: 13.5px; font-weight: 800; margin-top: 2px; }
        table.goods { width: 100%; border-collapse: collapse; margin-top: 10px; }
        table.goods th, table.goods td { border: 1px solid #000; padding: 7px 8px; }
        table.goods th { font-size: 11px; text-transform: uppercase; background: #f2f2f2; }
        .r { text-align: right; } .c { text-align: center; }
        .bm-decl { margin-top: 12px; border: 1px dashed #000; padding: 8px 10px; font-size: 12px; }
        .bm-sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 26mm; text-align: center; font-size: 11.5px; }
        .bm-sign > div { border-top: 1px solid #000; padding-top: 4px; }
      `}</style>
      <div className="bm-page">
        <div className="bm-head">
          <div className="brandwrap">
            <BrandLogo variant="mark" height={48} />
            <div>
              <div className="brand">{company.name}</div>
              <div className="co">{company.address}<br />GSTIN: {company.gstin} &middot; Ph: {company.phones.join(', ')}</div>
            </div>
          </div>
          <div className="doctype">DELIVERY NOTE<small>TRANSPORT COPY — RETURNABLE</small></div>
        </div>

        <div className="bm-banner">NOT FOR SALE — EMPTY BEAMS, RETURNABLE — FOR JOB WORK (SIZING) PURPOSE ONLY</div>

        <div className="bm-meta">
          <div><div className="lbl">Note No</div><div className="val">{code}</div></div>
          <div><div className="lbl">Moving date</div><div className="val">{formatDay(m.move_date)}</div></div>
          <div><div className="lbl">Vehicle no</div><div className="val">{m.vehicle_no || '—'}</div></div>
          <div><div className="lbl">Purpose</div><div className="val">{sending ? 'For warp sizing' : 'Empty beams returned'}</div></div>
        </div>
        <div className="bm-places">
          {[{ t: 'Despatched from', p: fromP }, { t: 'Destination (deliver to)', p: toP }].map(({ t, p }) => (
            <div key={t}>
              <div className="lbl">{t}</div>
              <div className="nm">{p.name}</div>
              {p.address && <div>{p.address}</div>}
              {p.gstin && <div>GSTIN: {p.gstin}</div>}
            </div>
          ))}
        </div>

        <table className="goods">
          <thead>
            <tr><th className="c" style={{ width: '10mm' }}>S.No</th><th>Description of goods</th><th className="r">Quantity</th></tr>
          </thead>
          <tbody>
            <tr>
              <td className="c">1</td>
              <td>Empty warp beams (weaver&apos;s beams) — property of {company.name}{m.notes ? <div style={{ fontWeight: 500, fontSize: '11.5px' }}>{m.notes}</div> : null}</td>
              <td className="r val">{m.qty} Nos</td>
            </tr>
          </tbody>
        </table>

        <div className="bm-decl">
          <b>Declaration:</b> These empty beams are the property of {company.name} and are {sending
            ? <>sent to {theirs.name} only for winding our own sized warp (job work). They are to be returned to us as sized paavu or empty.</>
            : <>being returned empty by {theirs.name} to {company.name}.</>}{' '}
          This is <b>not a sale</b> and no consideration is charged.
        </div>

        <div className="bm-sign">
          <div>Driver signature</div>
          <div>Received by (with seal)</div>
          <div>For {company.name}<br />Authorised signatory</div>
        </div>
      </div>
    </>
  );
}
