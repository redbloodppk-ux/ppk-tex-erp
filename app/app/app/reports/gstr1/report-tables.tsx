'use client';

import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { fmtRupees } from '@/lib/format';
import type { ReportTable } from '@/lib/gstr1';

/** Tables where the source data still has per-invoice/note detail to drill into. */
const EXPANDABLE_TABLES = new Set(['4A', '5', '9B']);

interface ReportTablesProps {
  tables: ReportTable[];
}

/** Tables 4A/9B show a derived "gross value" column (taxable + all tax) alongside the
 *  taxable/tax breakdown — this is the actual invoice/note total, which is what most
 *  owners actually think of as "the amount on the bill". */
const GROSS_VALUE_LABEL: Record<string, string> = {
  '4A': 'Total Invoice Value',
  '9B': 'Total Notes Value',
};

function grossValue(r: { taxableValue: number; igst: number; cgst: number; sgst: number }): number {
  return r.taxableValue + r.igst + r.cgst + r.sgst;
}

export function ReportTables({ tables }: ReportTablesProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (tables.length === 0) return null;

  const toggle = (rowKey: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  const grandTotal = tables.reduce(
    (a, t) => ({
      taxableValue: a.taxableValue + t.totals.taxableValue,
      igst: a.igst + t.totals.igst,
      cgst: a.cgst + t.totals.cgst,
      sgst: a.sgst + t.totals.sgst,
    }),
    { taxableValue: 0, igst: 0, cgst: 0, sgst: 0 },
  );

  return (
    <div className="space-y-4">
      {tables.map((table) => {
        const canExpand = EXPANDABLE_TABLES.has(table.tableNo);
        const grossLabel = GROSS_VALUE_LABEL[table.tableNo];
        const showQty = table.tableNo === '12';
        return (
          <div key={table.tableNo} className="card p-0 overflow-x-auto">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 bg-cloud/40 border-b border-line/40">
              <div className="text-sm font-medium">
                {table.tableNo} — {table.title}
              </div>
              <div className="text-xs text-ink-mute">
                {table.totals.count} record{table.totals.count === 1 ? '' : 's'} · Taxable{' '}
                {fmtRupees(table.totals.taxableValue)} · IGST {fmtRupees(table.totals.igst)} · CGST{' '}
                {fmtRupees(table.totals.cgst)} · SGST {fmtRupees(table.totals.sgst)}
                {grossLabel && (
                  <>
                    {' '}
                    · {grossLabel} {fmtRupees(grossValue(table.totals))}
                  </>
                )}
                {showQty && <> · Qty {table.totals.qty.toLocaleString('en-IN')}</>}
              </div>
            </div>
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-mute">
                <tr>
                  {canExpand && <th className="w-8" />}
                  <th className="text-left px-4 py-2">Description</th>
                  <th className="text-right px-4 py-2">Records</th>
                  <th className="text-right px-4 py-2">Taxable value</th>
                  <th className="text-right px-4 py-2">IGST</th>
                  <th className="text-right px-4 py-2">CGST</th>
                  <th className="text-right px-4 py-2">SGST</th>
                  {grossLabel && <th className="text-right px-4 py-2">{grossLabel}</th>}
                  {showQty && <th className="text-right px-4 py-2">Qty</th>}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row) => {
                  const rowKey = `${table.tableNo}-${row.key}`;
                  const isOpen = expanded.has(rowKey);
                  return (
                    <Fragment key={rowKey}>
                      <tr className="border-t border-line/40">
                        {canExpand && (
                          <td className="px-2 py-2">
                            {row.detail.length > 0 && (
                              <button
                                type="button"
                                onClick={() => toggle(rowKey)}
                                className="text-ink-mute hover:text-ink"
                                aria-label="Toggle details"
                              >
                                {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                              </button>
                            )}
                          </td>
                        )}
                        <td className="px-4 py-2">{row.label}</td>
                        <td className="px-4 py-2 text-right num">{row.count}</td>
                        <td className="px-4 py-2 text-right num">{fmtRupees(row.taxableValue)}</td>
                        <td className="px-4 py-2 text-right num">{fmtRupees(row.igst)}</td>
                        <td className="px-4 py-2 text-right num">{fmtRupees(row.cgst)}</td>
                        <td className="px-4 py-2 text-right num">{fmtRupees(row.sgst)}</td>
                        {grossLabel && <td className="px-4 py-2 text-right num">{fmtRupees(grossValue(row))}</td>}
                        {showQty && (
                          <td className="px-4 py-2 text-right num">{(row.qty ?? 0).toLocaleString('en-IN')}</td>
                        )}
                      </tr>
                      {canExpand && isOpen && (
                        <tr className="bg-cloud/20">
                          <td />
                          <td colSpan={grossLabel ? 7 : 6} className="px-4 py-2">
                            <table className="w-full text-xs">
                              <thead className="text-ink-mute">
                                <tr>
                                  <th className="text-left py-1">Doc no.</th>
                                  <th className="text-left py-1">Date</th>
                                  <th className="text-right py-1">Rate</th>
                                  <th className="text-right py-1">Taxable value</th>
                                  <th className="text-right py-1">IGST</th>
                                  <th className="text-right py-1">CGST</th>
                                  <th className="text-right py-1">SGST</th>
                                  {grossLabel && <th className="text-right py-1">{grossLabel}</th>}
                                </tr>
                              </thead>
                              <tbody>
                                {row.detail.map((d, i) => (
                                  <tr key={`${d.docNo}-${i}`} className="border-t border-line/20">
                                    <td className="py-1">{d.docNo}</td>
                                    <td className="py-1">{d.date}</td>
                                    <td className="py-1 text-right num">{d.rate}%</td>
                                    <td className="py-1 text-right num">{fmtRupees(d.taxableValue)}</td>
                                    <td className="py-1 text-right num">{fmtRupees(d.igst)}</td>
                                    <td className="py-1 text-right num">{fmtRupees(d.cgst)}</td>
                                    <td className="py-1 text-right num">{fmtRupees(d.sgst)}</td>
                                    {grossLabel && (
                                      <td className="py-1 text-right num">{fmtRupees(grossValue(d))}</td>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      <div className="card p-4 flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-semibold">Total Liability</div>
        <div className="text-sm font-semibold">
          Taxable {fmtRupees(grandTotal.taxableValue)} · IGST {fmtRupees(grandTotal.igst)} · CGST{' '}
          {fmtRupees(grandTotal.cgst)} · SGST {fmtRupees(grandTotal.sgst)} · Total tax{' '}
          {fmtRupees(grandTotal.igst + grandTotal.cgst + grandTotal.sgst)}
        </div>
      </div>
    </div>
  );
}
