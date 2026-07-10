import { describe, it, expect } from 'vitest';
import { buildReportTables } from './gstr1';
import type { Gstr1Return } from './gstr1';

describe('buildReportTables', () => {
  it('builds table 4A from b2b groups with per-invoice detail', () => {
    const ret: Gstr1Return = {
      gstin: '33CKBPP6334H1Z8',
      fp: '062026',
      version: 'GST3.2.4',
      hash: 'hash',
      b2b: [
        {
          ctin: '33AYTPN1798B1Z4',
          inv: [
            {
              inum: 'INV/26-27/0037',
              idt: '01-06-2026',
              val: 62235,
              pos: '33',
              rchrg: 'N',
              inv_typ: 'R',
              itms: [{ num: 1, itm_det: { txval: 59271, rt: 5, iamt: 0, camt: 1481.78, samt: 1481.78, csamt: 0 } }],
            },
            {
              inum: 'INV/26-27/0041',
              idt: '06-06-2026',
              val: 78029,
              pos: '33',
              rchrg: 'N',
              inv_typ: 'R',
              itms: [{ num: 1, itm_det: { txval: 74313, rt: 5, iamt: 0, camt: 1857.83, samt: 1857.83, csamt: 0 } }],
            },
          ],
        },
      ],
    };

    const tables = buildReportTables(ret);
    const t4a = tables.find((t) => t.tableNo === '4A');
    expect(t4a).toBeDefined();
    expect(t4a?.rows).toHaveLength(1);
    expect(t4a?.rows[0]?.count).toBe(2);
    expect(t4a?.rows[0]?.taxableValue).toBeCloseTo(133584, 2);
    expect(t4a?.rows[0]?.detail).toHaveLength(2);
    expect(t4a?.rows[0]?.detail[0]?.docNo).toBe('INV/26-27/0037');
    expect(t4a?.totals.taxableValue).toBeCloseTo(133584, 2);
  });

  it('builds table 9B from cdnr with correct per-note detail', () => {
    const ret: Gstr1Return = {
      gstin: '33CKBPP6334H1Z8',
      fp: '062026',
      version: 'GST3.2.4',
      hash: 'hash',
      cdnr: [
        {
          ctin: '33AABHB4561N2ZB',
          nt: [
            {
              ntty: 'C',
              nt_num: 'CN/26-27/0003',
              nt_dt: '15-06-2026',
              val: 7326,
              pos: '33',
              rchrg: 'N',
              inv_typ: 'R',
              itms: [{ num: 1, itm_det: { txval: 6977.48, rt: 5, iamt: 0, camt: 174.44, samt: 174.44, csamt: 0 } }],
            },
          ],
        },
      ],
    };

    const tables = buildReportTables(ret);
    const t9b = tables.find((t) => t.tableNo === '9B');
    expect(t9b).toBeDefined();
    expect(t9b?.rows).toHaveLength(1);
    expect(t9b?.rows[0]?.label).toBe('33AABHB4561N2ZB');
    expect(t9b?.rows[0]?.taxableValue).toBeCloseTo(6977.48, 2);
  });

  it('builds table 12 from HSN rows with no expandable detail', () => {
    const ret: Gstr1Return = {
      gstin: '33CKBPP6334H1Z8',
      fp: '062026',
      version: 'GST3.2.4',
      hash: 'hash',
      hsn: {
        data: [
          {
            num: 1,
            hsn_sc: '5208',
            desc: 'Woven fabrics of cotton',
            uqc: 'PCS',
            qty: 21226.24,
            rt: 5,
            txval: 750900.3,
            iamt: 0,
            camt: 18772.5,
            samt: 18772.5,
            csamt: 0,
          },
        ],
      },
    };

    const tables = buildReportTables(ret);
    const t12 = tables.find((t) => t.tableNo === '12');
    expect(t12).toBeDefined();
    expect(t12?.rows[0]?.label).toBe('5208 — Woven fabrics of cotton');
    expect(t12?.rows[0]?.detail).toHaveLength(0);
    expect(t12?.rows[0]?.taxableValue).toBeCloseTo(750900.3, 2);
  });

  it('omits a table entirely when its source section is absent', () => {
    const ret: Gstr1Return = {
      gstin: '33CKBPP6334H1Z8',
      fp: '062026',
      version: 'GST3.2.4',
      hash: 'hash',
      b2b: [
        {
          ctin: '33AYTPN1798B1Z4',
          inv: [
            {
              inum: 'INV/26-27/0037',
              idt: '01-06-2026',
              val: 62235,
              pos: '33',
              rchrg: 'N',
              inv_typ: 'R',
              itms: [{ num: 1, itm_det: { txval: 59271, rt: 5, iamt: 0, camt: 1481.78, samt: 1481.78, csamt: 0 } }],
            },
          ],
        },
      ],
    };

    const tables = buildReportTables(ret);
    expect(tables.find((t) => t.tableNo === '5')).toBeUndefined();
    expect(tables.find((t) => t.tableNo === '7')).toBeUndefined();
    expect(tables.find((t) => t.tableNo === '9B')).toBeUndefined();
    expect(tables.find((t) => t.tableNo === '12')).toBeUndefined();
    expect(tables.find((t) => t.tableNo === '13')).toBeUndefined();
  });
});
