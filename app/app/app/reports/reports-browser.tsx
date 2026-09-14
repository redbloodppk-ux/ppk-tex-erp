'use client';
/**
 * Reports browser — a row of group icons, one group's reports shown below.
 *
 * PPK, 2026-09-14: "make group as icon and when mouse over only show the
 * respective reports below in report page".
 *
 * HOVER PREVIEWS, CLICK PINS
 * Hover alone would mean the list changes under the cursor and snaps back
 * the moment the mouse leaves the row — you could never move down to the
 * card you just revealed. So hovering previews a group, clicking fixes it,
 * and leaving the row returns to whatever is pinned. On a phone, where
 * there is no hover at all, the tap is the click and it behaves as plain
 * tabs. Keyboard focus previews the same way hover does.
 *
 * Icons are mapped here rather than passed in: a React component is not
 * serialisable across the server/client boundary, so the page hands over
 * plain data and this file turns the group key into an icon.
 */
import { useState } from 'react';
import Link from 'next/link';
import {
  FileText, ArrowRight, Wallet, Factory, Boxes, Truck, Receipt, Calculator, Users,
} from 'lucide-react';

export interface BrowserReport {
  href: string;
  title: string;
  description: string;
  ready: boolean;
}

export interface BrowserGroup {
  key: string;
  label: string;
  blurb: string;
  reports: BrowserReport[];
}

const GROUP_ICON: Record<string, typeof FileText> = {
  money: Wallet,
  production: Factory,
  stock: Boxes,
  sales: Truck,
  gst: Receipt,
  costing: Calculator,
  people: Users,
};

export function ReportsBrowser({ groups }: { groups: BrowserGroup[] }): React.ReactElement {
  const [pinned, setPinned] = useState<string>(groups[0]?.key ?? '');
  const [hovered, setHovered] = useState<string | null>(null);
  const activeKey = hovered ?? pinned;
  const active = groups.find((g) => g.key === activeKey) ?? groups[0];

  return (
    <div>
      <div
        role="tablist"
        aria-label="Report groups"
        className="flex flex-wrap gap-2 mb-5"
        onMouseLeave={() => setHovered(null)}
      >
        {groups.map((g) => {
          const Icon = GROUP_ICON[g.key] ?? FileText;
          const isActive = g.key === activeKey;
          const isPinned = g.key === pinned;
          return (
            <button
              key={g.key}
              type="button"
              role="tab"
              aria-selected={isPinned}
              title={`${g.label} — ${g.blurb}`}
              onMouseEnter={() => setHovered(g.key)}
              onFocus={() => setHovered(g.key)}
              onBlur={() => setHovered(null)}
              onClick={() => { setPinned(g.key); setHovered(null); }}
              className={`flex flex-col items-center justify-center gap-1 rounded-xl border px-3 py-2 min-w-[84px] min-h-[64px] transition-colors ${
                isActive
                  ? 'bg-indigo text-white border-indigo shadow-sm'
                  : 'bg-paper text-ink-soft border-line hover:bg-haze hover:text-ink'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[11px] font-semibold leading-none">{g.label}</span>
              <span className={`text-[10px] leading-none ${isActive ? 'text-white/70' : 'text-ink-mute'}`}>
                {g.reports.length}
              </span>
            </button>
          );
        })}
      </div>

      {active && (
        <div role="tabpanel" aria-label={active.label}>
          <div className="flex items-baseline gap-2 mb-2">
            <h2 className="text-base font-semibold">{active.label}</h2>
            <span className="text-xs text-ink-mute">{active.blurb}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {active.reports.map((r) => (
              <ReportCard key={r.title} report={r} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReportCard({ report }: { report: BrowserReport }): React.ReactElement {
  const inner = (
    <div className="card p-4 flex items-start gap-3 h-full">
      <span className="text-ink-mute mt-0.5">
        <FileText className="w-4 h-4" />
      </span>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">{report.title}</h3>
          {!report.ready && (
            <span className="text-xs text-ink-mute bg-cloud/60 px-2 py-0.5 rounded">
              Soon
            </span>
          )}
        </div>
        <p className="text-sm text-ink-soft mt-1">{report.description}</p>
      </div>
      {report.ready && (
        <span className="text-ink-mute mt-0.5">
          <ArrowRight className="w-4 h-4" />
        </span>
      )}
    </div>
  );

  if (!report.ready) return <div className="opacity-60">{inner}</div>;
  return (
    <Link href={report.href} className="block hover:opacity-90">
      {inner}
    </Link>
  );
}
