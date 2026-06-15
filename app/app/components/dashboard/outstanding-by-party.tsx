'use client';
/**
 * OutstandingByParty — accordion list of unpaid bills grouped by party.
 *
 * Top level: one row per party showing their name + total outstanding
 * across every unpaid / part-paid bill + days since their oldest open
 * bill. Click the row to expand and see the actual bills (invoice
 * number, date, days due, balance).
 *
 * Used twice on the dashboard:
 *   - Outstanding Customer Payments (sale invoices we issue)
 *   - Outstanding Jobwork Payments  (jobwork bills we receive)
 *
 * Server-side groups the bills and passes them in already sorted by
 * total outstanding (highest first). This component is just the UI +
 * expand-collapse state.
 */
import { useState } from 'react';
import Link from 'next/link';
import { formatRupee } from '@/lib/utils';
import { ChevronRight, FileDown } from 'lucide-react';

export interface OutstandingBill {
  id: number;
  invoice_no: string;
  invoice_date: string;
  balance: number;
}

export interface PartyGroup {
  /** Stable key — party.id when known, else `name:${name}`. */
  key: string;
  party_label: string;
  /** Party id from the unified party master, used for the action link. */
  party_id: number | null;
  total: number;
  /** Days since the OLDEST open bill — drives the tone colour. */
  oldest_due: number;
  bills: OutstandingBill[];
}

interface Props {
  groups:      PartyGroup[];
  emptyText:   string;
  footnote:    string;
  actionLabel: string;
  /** /app/payments?direction=... — direction toggle for the deep link. */
  direction:   'in' | 'out';
}

function fmtDate(s: string): string {
  if (!s) return '-';
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + d.getFullYear();
}

function daysBetween(iso: string, now: number): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

function toneFor(due: number): string {
  return due > 30 ? 'text-rose-600' : due > 14 ? 'text-amber-600' : 'text-emerald-700';
}

export function OutstandingByParty({
  groups, emptyText, footnote, actionLabel, direction,
}: Props): React.ReactElement {
  // The accordion state is intentionally local + multi-open: the
  // operator can fan out several parties at once to compare.
  const [open, setOpen] = useState<Set<string>>(new Set());

  function toggle(key: string): void {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (groups.length === 0) {
    return <p className="text-sm text-ink-soft py-4">{emptyText}</p>;
  }

  const now = Date.now();

  return (
    <>
      <ul className="divide-y divide-line/40">
        {groups.map((g) => {
          const isOpen = open.has(g.key);
          const tone   = toneFor(g.oldest_due);
          const actionHref = g.party_id != null
            ? `/app/payments?party=${g.party_id}&direction=${direction}`
            : null;
          return (
            <li key={g.key}>
              {/* Top-level party row — click anywhere to expand. */}
              <button
                type="button"
                onClick={() => toggle(g.key)}
                className="w-full text-left flex items-center gap-3 py-2.5 px-1 hover:bg-haze/50 transition-colors"
                aria-expanded={isOpen}
              >
                <ChevronRight
                  className={'w-4 h-4 text-ink-mute shrink-0 transition-transform ' + (isOpen ? 'rotate-90' : '')}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-ink truncate">{g.party_label}</div>
                  <div className="text-[11px] text-ink-mute">
                    {g.bills.length} bill{g.bills.length === 1 ? '' : 's'} ·{' '}
                    <span className={tone}>oldest {g.oldest_due}d</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="num font-bold">{formatRupee(g.total)}</div>
                  <div className="flex items-center justify-end gap-2 mt-0.5">
                    {g.party_id != null && (
                      <Link
                        href={`/app/parties/${g.party_id}/statement/print`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[11px] text-ink-soft hover:text-indigo inline-flex items-center gap-1"
                        title="Open statement of outstanding (print / PDF)"
                      >
                        <FileDown className="w-3 h-3" /> PDF
                      </Link>
                    )}
                    {actionHref != null && (
                      <Link
                        href={actionHref}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[11px] text-indigo font-semibold hover:underline"
                      >
                        {actionLabel} &rarr;
                      </Link>
                    )}
                  </div>
                </div>
              </button>

              {/* Expanded detail — bills table for this party. */}
              {isOpen && (
                <div className="pl-7 pr-1 pb-3 pt-1">
                  <div className="overflow-x-auto rounded-md border border-line/50">
                    <table className="w-full text-xs">
                      <thead className="bg-cloud/40 text-[10px] uppercase tracking-wide text-ink-soft">
                        <tr>
                          <th className="text-left  px-3 py-2">Invoice no</th>
                          <th className="text-left  px-3 py-2">Date</th>
                          <th className="text-right px-3 py-2">Days due</th>
                          <th className="text-right px-3 py-2">Balance (₹)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.bills.map((b) => {
                          const due  = daysBetween(b.invoice_date, now);
                          const bTone = toneFor(due);
                          return (
                            <tr key={b.id} className="border-t border-line/30 hover:bg-haze/40">
                              <td className="px-3 py-2 font-mono">
                                <Link href={`/app/invoices/${b.id}`} className="text-indigo hover:underline">
                                  {b.invoice_no}
                                </Link>
                              </td>
                              <td className="px-3 py-2 text-ink-soft">{fmtDate(b.invoice_date)}</td>
                              <td className={'px-3 py-2 text-right num ' + bTone}>{due}d</td>
                              <td className="px-3 py-2 text-right num font-semibold">{formatRupee(b.balance)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-[10px] text-ink-mute mt-3">{footnote}</p>
    </>
  );
}
