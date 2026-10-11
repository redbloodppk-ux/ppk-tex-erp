/**
 * Bobbin transfer — transport copy (A4). Bobbins moving between our
 * floor, an outsource weaver and a job-work party. Not a sale.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { BrandLogo } from '@/app/components/brand-logo';
import { loadCompany } from '@/lib/load-company';
import { formatDay } from '@/lib/utils';
import { BobbinPrintActions } from './print-actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<{ title: string }> {
  const { id } = await params;
  return { title: `Bobbin transfer ${id} — Transport copy` };
}

export default async function BobbinTransferPrint({ params }: { params: Promise<{ id: string }> }): Promise<React.ReactElement> {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) notFound();
  const sb = (await createClient()) as any;
  const { data: t } = await sb.from('bobbin_transfer').select('*').eq('id', id).maybeSingle();
  if (!t) notFound();
  const [company, itemsRes, partiesRes] = await Promise.all([
    loadCompany(),
    sb.from('bobbin').select('id, code, description, ends_per_bobbin, bobbin_metre').in('id', [t.bobbin_id, t.to_bobbin_id]),
    sb.from('jobwork_party').select('id, name, billing_address, city, gstin').in('id', [t.from_party_id, t.to_party_id].filter((x: any) => x != null).concat([-1])),
  ]);
  const bob = ((itemsRes.data ?? []) as any[]).find((b) => b.id === t.bobbin_id) ?? null;
  const parties = new Map<number, any>(((partiesRes.data ?? []) as any[]).map((p) => [p.id, p]));
  const place = (kind: string, pid: number | null, title: string): { title: string; name: string; address: string; gstin: string } => {
    if (kind === 'in_house') return { title, name: company.name, address: company.address, gstin: company.gstin };
    const p = parties.get(pid ?? -1);
    return { title, name: `${p?.name ?? '?'} (${kind === 'outsource' ? 'Outsource weaver' : 'Job work'})`, address: [p?.billing_address, p?.city].filter(Boolean).join(', '), gstin: p?.gstin ?? '' };
  };
  const fromP = place(t.from_kind, t.from_party_id, 'Despatched from');
  const toP = place(t.to_kind, t.to_party_id, 'Destination (deliver to)');
  const filename = `${t.code} ${formatDay(t.transfer_date)} Bobbin transport copy`.replace(/[\\/:*?"<>|]/g, '-');

  return (
    <>
      <BobbinPrintActions id={id} filename={filename} />
      <style>{`
        @page { size: A4; margin: 10mm; }
        @media print { .no-print { display: none !important; } html, body { background: #fff !important; }
          .pt-page { box-shadow: none !important; border: none !important; margin: 0 !important; padding: 0 !important; width: auto !important; min-height: 0 !important; } }
        body { background: #f3f4f6; }
        .pt-page { width: 210mm; min-height: 297mm; margin: 16px auto; background: #fff; color: #111; padding: 12mm; box-sizing: border-box;
          font-family: 'Calibri', Arial, sans-serif; font-size: 12.5px; font-weight: 600; line-height: 1.45; border: 1px solid #d4d4d4; }
        .hd { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000; padding-bottom: 8px; }
        .hd .bw { display: flex; align-items: center; gap: 12px; } .hd .brand { font-size: 28px; font-weight: 900; line-height: 1; }
        .hd .co { font-size: 11px; margin-top: 4px; max-width: 95mm; } .hd .dt { text-align: right; font-size: 18px; font-weight: 800; }
        .hd .dt small { display: block; font-size: 11px; }
        .bn { margin: 10px 0; border: 2px solid #000; text-align: center; padding: 7px; font-size: 15px; font-weight: 900; letter-spacing: .8px; }
        .mt { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #000; } .mt > div { padding: 5px 9px; border-right: 1px solid #000; } .mt > div:last-child { border-right: none; }
        .lbl { font-size: 10px; font-weight: 700; color: #333; text-transform: uppercase; letter-spacing: .5px; } .val { font-size: 13.5px; font-weight: 800; }
        .pl { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #000; border-top: none; } .pl > div { padding: 7px 9px; min-height: 24mm; } .pl > div:first-child { border-right: 1px solid #000; }
        table.g { width: 100%; border-collapse: collapse; margin-top: 10px; } table.g th, table.g td { border: 1px solid #000; padding: 5px 8px; }
        table.g th { font-size: 11px; text-transform: uppercase; background: #f2f2f2; } .r { text-align: right; } .c { text-align: center; }
        .dc { margin-top: 12px; border: 1px dashed #000; padding: 8px 10px; font-size: 12px; }
        .sg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 24mm; text-align: center; font-size: 11.5px; } .sg > div { border-top: 1px solid #000; padding-top: 4px; }
      `}</style>
      <div className="pt-page">
        <div className="hd">
          <div className="bw"><BrandLogo variant="mark" height={48} />
            <div><div className="brand">{company.name}</div><div className="co">{company.address}<br />GSTIN: {company.gstin} &middot; Ph: {company.phones.join(', ')}</div></div></div>
          <div className="dt">DELIVERY NOTE<small>BOBBIN TRANSPORT COPY</small></div>
        </div>
        <div className="bn">NOT FOR SALE — BOBBINS FOR JOB WORK (WEAVING) PURPOSE ONLY</div>
        <div className="mt">
          <div><div className="lbl">Note No</div><div className="val">{t.code}</div></div>
          <div><div className="lbl">Moving date</div><div className="val">{formatDay(t.transfer_date)}</div></div>
          <div><div className="lbl">Vehicle no</div><div className="val">{t.vehicle_no || '—'}</div></div>
          <div><div className="lbl">Purpose</div><div className="val">Job work (weaving)</div></div>
        </div>
        <div className="pl">
          {[fromP, toP].map((p) => (
            <div key={p.title}><div className="lbl">{p.title}</div><div className="val">{p.name}</div>
              {p.address && <div>{p.address}</div>}{p.gstin && <div>GSTIN: {p.gstin}</div>}</div>
          ))}
        </div>
        <table className="g">
          <thead><tr><th className="c">S.No</th><th>Description of goods</th><th className="r">Ends</th><th className="r">m / bobbin</th><th className="r">No. of bobbins</th><th className="r">Total metres</th></tr></thead>
          <tbody>
            <tr><td className="c">1</td><td>Bobbins {bob?.code ?? ''}{bob?.description ? ` — ${bob.description}` : ''}</td><td className="r">{bob?.ends_per_bobbin ?? ''}</td>
              <td className="r">{t.metre_per_pc != null ? Number(t.metre_per_pc).toLocaleString('en-IN') : ''}</td>
              <td className="r">{Number(t.pieces).toLocaleString('en-IN')}</td><td className="r">{Number(t.metres).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>
          </tbody>
        </table>
        {t.notes && <div style={{ marginTop: 6 }}>Notes: {t.notes}</div>}
        <div className="dc"><b>Declaration:</b> The above bobbins are moved from {fromP.name} to {toP.name} for job work (weaving) purpose only. This is <b>not a sale</b> and no consideration is charged.</div>
        <div className="sg"><div>Driver signature</div><div>Received by (with seal)</div><div>For {company.name}<br />Authorised signatory</div></div>
      </div>
    </>
  );
}
