/**
 * E-way bill QR code — same content the NIC portal prints on the EWB:
 *
 *   <EWB no>/<generator GSTIN>/<M>/<D>/<YYYY> <h>:<mm>:<ss> <AM|PM>
 *   e.g. 552090316575/33CKBPP6334H1Z8/10/16/2026 9:13:00 AM
 *
 * (decoded from a real portal print). Scanning it in the officers'
 * app pulls up the e-way bill by number.
 */
import QRCode from 'qrcode';

/** dateISO = YYYY-MM-DD; timeHHMM = HH:MM[:SS] (24h, optional). */
export function ewbQrText(ewbNo: string, gstin: string, dateISO: string | null, timeHHMM: string | null): string {
  const no = ewbNo.replace(/\D/g, '');
  let stamp = '';
  const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateISO ?? '');
  if (dm) {
    const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(timeHHMM ?? '') ;
    const H = tm ? Number(tm[1]) : 0;
    const mi = tm ? tm[2] : '00';
    const ss = tm?.[3] ?? '00';
    const h12 = H % 12 === 0 ? 12 : H % 12;
    stamp = `/${Number(dm[2])}/${Number(dm[3])}/${dm[1]} ${h12}:${mi}:${ss} ${H < 12 ? 'AM' : 'PM'}`;
  }
  return `${no}/${gstin.trim().toUpperCase()}${stamp}`;
}

/** Inline SVG markup (server-side), or null when it can't be built. */
export async function ewbQrSvg(text: string): Promise<string | null> {
  try {
    return await QRCode.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
  } catch {
    return null;
  }
}
