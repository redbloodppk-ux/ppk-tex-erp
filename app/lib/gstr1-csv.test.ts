import { describe, it, expect } from 'vitest';
import {
  toB2bCsv,
  toB2clCsv,
  toB2csCsv,
  toCdnrCsv,
  toCdnurCsv,
  toHsnCsv,
  toDocsCsv,
} from './gstr1-csv';
import type {
  B2bGroup,
  B2clGroup,
  B2csEntry,
  CdnrGroup,
  CdnurNote,
  HsnRow,
  DocDet,
} from './gstr1';

describe('toB2bCsv', () => {
  it('returns null when there is nothing to export', () => {
    expect(toB2bCsv([])).toBeNull();
  });

  it('emits one row per tax-rate item, repeating invoice-level fields', () => {
    const b2b: B2bGroup[] = [
      {
        ctin: '33AAAAA0000A1Z5',
        inv: [
          {
            inum: 'INV-1',
            idt: '05-07-2026',
            val: 1180,
            pos: '33',
            rchrg: 'N',
            inv_typ: 'R',
            itms: [
              { num: 1, itm_det: { txval: 1000, rt: 18, iamt: 0, camt: 90, samt: 90, csamt: 0 } },
            ],
          },
        ],
      },
    ];
    const csv = toB2bCsv(b2b);
    expect(csv).toBe(
      [
        'GSTIN/UIN of Recipient,Receiver Name,Invoice Number,Invoice date,Invoice Value,Place Of Supply,Reverse Charge,Applicable % of Tax Rate,Invoice Type,E-Commerce GSTIN,Rate,Taxable Value,Cess Amount',
        '33AAAAA0000A1Z5,,INV-1,05-Jul-2026,1180,33,N,,Regular,,18,1000,0',
      ].join('\r\n'),
    );
  });

  it('emits multiple rows for an invoice with multiple tax rates', () => {
    const b2b: B2bGroup[] = [
      {
        ctin: '33AAAAA0000A1Z5',
        inv: [
          {
            inum: 'INV-2',
            idt: '06-07-2026',
            val: 2000,
            pos: '33',
            rchrg: 'N',
            inv_typ: 'R',
            itms: [
              { num: 1, itm_det: { txval: 1000, rt: 5, iamt: 0, camt: 25, samt: 25, csamt: 0 } },
              { num: 2, itm_det: { txval: 500, rt: 12, iamt: 0, camt: 30, samt: 30, csamt: 0 } },
            ],
          },
        ],
      },
    ];
    const rows = (toB2bCsv(b2b) ?? '').split('\r\n');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toBe('33AAAAA0000A1Z5,,INV-2,06-Jul-2026,2000,33,N,,Regular,,5,1000,0');
    expect(rows[2]).toBe('33AAAAA0000A1Z5,,INV-2,06-Jul-2026,2000,33,N,,Regular,,12,500,0');
  });
});

describe('toB2clCsv', () => {
  it('returns null when there is nothing to export', () => {
    expect(toB2clCsv([])).toBeNull();
  });

  it('builds a row per item', () => {
    const b2cl: B2clGroup[] = [
      {
        pos: '27',
        inv: [
          {
            inum: 'INV-3',
            idt: '07-07-2026',
            val: 150000,
            itms: [
              { num: 1, itm_det: { txval: 125000, rt: 18, iamt: 22500, camt: 0, samt: 0, csamt: 0 } },
            ],
          },
        ],
      },
    ];
    expect(toB2clCsv(b2cl)).toBe(
      [
        'Invoice Number,Invoice date,Invoice Value,Place Of Supply,Applicable % of Tax Rate,Rate,Taxable Value,Cess Amount,E-Commerce GSTIN',
        'INV-3,07-Jul-2026,150000,27,,18,125000,0,',
      ].join('\r\n'),
    );
  });
});

describe('toB2csCsv', () => {
  it('returns null when there is nothing to export', () => {
    expect(toB2csCsv([])).toBeNull();
  });

  it('builds one row per consolidated entry', () => {
    const b2cs: B2csEntry[] = [
      { sply_ty: 'INTRA', typ: 'OE', pos: '33', rt: 5, txval: 4000, iamt: 0, camt: 100, samt: 100, csamt: 0 },
    ];
    expect(toB2csCsv(b2cs)).toBe(
      [
        'Type,Place Of Supply,Applicable % of Tax Rate,Rate,Taxable Value,Cess Amount,E-Commerce GSTIN',
        'OE,33,,5,4000,0,',
      ].join('\r\n'),
    );
  });
});

describe('toCdnrCsv', () => {
  it('returns null when there is nothing to export', () => {
    expect(toCdnrCsv([])).toBeNull();
  });

  it('marks intra-state notes and builds a row per item', () => {
    const cdnr: CdnrGroup[] = [
      {
        ctin: '33AAAAA0000A1Z5',
        nt: [
          {
            ntty: 'C',
            nt_num: 'CN-1',
            nt_dt: '08-07-2026',
            val: 590,
            pos: '33',
            rchrg: 'N',
            inv_typ: 'R',
            itms: [
              { num: 1, itm_det: { txval: 500, rt: 18, iamt: 0, camt: 45, samt: 45, csamt: 0 } },
            ],
          },
        ],
      },
    ];
    expect(toCdnrCsv(cdnr)).toBe(
      [
        'GSTIN/UIN of Recipient,Receiver Name,Note Number,Note Date,Note Type,Place Of Supply,Reverse Charge,Note Supply Type,Note Value,Applicable % of Tax Rate,Rate,Taxable Value,Cess Amount',
        '33AAAAA0000A1Z5,,CN-1,08-Jul-2026,Credit Note,33,N,Intra-State,590,,18,500,0',
      ].join('\r\n'),
    );
  });

  it('marks inter-state notes when igst is present', () => {
    const cdnr: CdnrGroup[] = [
      {
        ctin: '27BBBBB0000B1Z1',
        nt: [
          {
            ntty: 'C',
            nt_num: 'CN-2',
            nt_dt: '09-07-2026',
            val: 1180,
            pos: '27',
            rchrg: 'N',
            inv_typ: 'R',
            itms: [
              { num: 1, itm_det: { txval: 1000, rt: 18, iamt: 180, camt: 0, samt: 0, csamt: 0 } },
            ],
          },
        ],
      },
    ];
    const rows = (toCdnrCsv(cdnr) ?? '').split('\r\n');
    expect(rows[1]).toContain('Inter-State');
  });
});

describe('toCdnurCsv', () => {
  it('returns null when there is nothing to export', () => {
    expect(toCdnurCsv([])).toBeNull();
  });

  it('builds a row per item', () => {
    const cdnur: CdnurNote[] = [
      {
        typ: 'B2CL',
        ntty: 'C',
        nt_num: 'CN-3',
        nt_dt: '10-07-2026',
        val: 590,
        pos: '33',
        itms: [
          { num: 1, itm_det: { txval: 500, rt: 18, iamt: 0, camt: 45, samt: 45, csamt: 0 } },
        ],
      },
    ];
    expect(toCdnurCsv(cdnur)).toBe(
      [
        'UR Type,Note Number,Note Date,Note Type,Place Of Supply,Note Value,Applicable % of Tax Rate,Rate,Taxable Value,Cess Amount',
        'B2CL,CN-3,10-Jul-2026,Credit Note,33,590,,18,500,0',
      ].join('\r\n'),
    );
  });
});

describe('toHsnCsv', () => {
  it('returns null when there is nothing to export', () => {
    expect(toHsnCsv([])).toBeNull();
  });

  it('sums the tax columns into Total Value', () => {
    const hsn: HsnRow[] = [
      {
        num: 1,
        hsn_sc: '5208',
        desc: 'Cotton fabric',
        uqc: 'MTR',
        qty: 100,
        rt: 5,
        txval: 10000,
        iamt: 0,
        camt: 250,
        samt: 250,
        csamt: 0,
      },
    ];
    expect(toHsnCsv(hsn)).toBe(
      [
        'HSN,Description,UQC,Total Quantity,Total Value,Rate,Taxable Value,Integrated Tax Amount,Central Tax Amount,State/UT Tax Amount,Cess Amount',
        '5208,Cotton fabric,MTR,100,10500,5,10000,0,250,250,0',
      ].join('\r\n'),
    );
  });

  it('quotes a description containing a comma', () => {
    const hsn: HsnRow[] = [
      {
        num: 1,
        hsn_sc: '5208',
        desc: 'Cotton fabric, dyed',
        uqc: 'MTR',
        qty: 10,
        rt: 5,
        txval: 1000,
        iamt: 0,
        camt: 25,
        samt: 25,
        csamt: 0,
      },
    ];
    const rows = (toHsnCsv(hsn) ?? '').split('\r\n');
    expect(rows[1]).toBe('5208,"Cotton fabric, dyed",MTR,10,1050,5,1000,0,25,25,0');
  });
});

describe('toDocsCsv', () => {
  it('returns null when there is nothing to export', () => {
    expect(toDocsCsv([])).toBeNull();
  });

  it('labels doc types 1 and 5, and passes through unknown types', () => {
    const docDet: DocDet[] = [
      { doc_num: 1, docs: [{ num: 1, from: 'INV-1', to: 'INV-10', totnum: 10, cancel: 0, net_issue: 10 }] },
      { doc_num: 5, docs: [{ num: 1, from: 'CN-1', to: 'CN-2', totnum: 2, cancel: 1, net_issue: 1 }] },
      { doc_num: 9, docs: [{ num: 1, from: 'X-1', to: 'X-1', totnum: 1, cancel: 0, net_issue: 1 }] },
    ];
    const rows = (toDocsCsv(docDet) ?? '').split('\r\n');
    expect(rows[0]).toBe('Nature of Document,Sr. No. From,Sr. No. To,Total Number,Cancelled');
    expect(rows[1]).toBe('Invoices for outward supply,INV-1,INV-10,10,0');
    expect(rows[2]).toBe('Credit Note,CN-1,CN-2,2,1');
    expect(rows[3]).toBe('Doc type 9,X-1,X-1,1,0');
  });
});
