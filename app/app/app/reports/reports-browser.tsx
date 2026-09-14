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

/**
 * A colour per group, so the row is scanned by colour before it is read.
 *
 * PPK, 2026-09-14: "make those icon more colourful and attractive". Seven
 * identical grey tiles meant reading every label; a colour each makes the
 * one you want findable at a glance, and the same hue carries into the
 * heading below so it is obvious which tile is open.
 *
 * Every class is written out in full. Tailwind scans source text for class
 * names, so a string built at runtime — `bg-${hue}-500` — is never emitted
 * into the stylesheet and the tile would render unstyled.
 */
interface GroupSkin {
  badge: string;      // icon chip, always solid
  tileIdle: string;   // resting tile, tinted on hover
  tileActive: string; // the open tile
  label: string;      // label colour when active
  count: string;      // count colour when active
  heading: string;    // section heading below the row
}

const GROUP_SKIN: Record<string, GroupSkin> = {
  money: {
    badge: 'bg-emerald-500 text-white',
    tileIdle: 'border-line bg-paper hover:border-emerald-300 hover:bg-emerald-50/50',
    tileActive: 'border-emerald-400 bg-emerald-50 shadow-sm',
    label: 'text-emerald-900', count: 'text-emerald-700', heading: 'text-emerald-700',
  },
  production: {
    badge: 'bg-indigo-500 text-white',
    tileIdle: 'border-line bg-paper hover:border-indigo-300 hover:bg-indigo-50/50',
    tileActive: 'border-indigo-400 bg-indigo-50 shadow-sm',
    label: 'text-indigo-900', count: 'text-indigo-700', heading: 'text-indigo-700',
  },
  stock: {
    badge: 'bg-amber-500 text-white',
    tileIdle: 'border-line bg-paper hover:border-amber-300 hover:bg-amber-50/50',
    tileActive: 'border-amber-400 bg-amber-50 shadow-sm',
    label: 'text-amber-900', count: 'text-amber-700', heading: 'text-amber-700',
  },
  sales: {
    badge: 'bg-sky-500 text-white',
    tileIdle: 'border-line bg-paper hover:border-sky-300 hover:bg-sky-50/50',
    tileActive: 'border-sky-400 bg-sky-50 shadow-sm',
    label: 'text-sky-900', count: 'text-sky-700', heading: 'text-sky-700',
  },
  gst: {
    badge: 'bg-rose-500 text-white',
    tileIdle: 'border-line bg-paper hover:border-rose-300 hover:bg-rose-50/50',
    tileActive: 'border-rose-400 bg-rose-50 shadow-sm',
    label: 'text-rose-900', count: 'text-rose-700', heading: 'text-rose-700',
  },
  costing: {
    badge: 'bg-teal-500 text-white',
    tileIdle: 'border-line bg-paper hover:border-teal-300 hover:bg-teal-50/50',
    tileActive: 'border-teal-400 bg-teal-50 shadow-sm',
    label: 'text-teal-900', count: 'text-teal-700', heading: 'text-teal-700',
  },
  people: {
    badge: 'bg-violet-500 text-white',
    tileIdle: 'border-line bg-paper hover:border-violet-300 hover:bg-violet-50/50',
    tileActive: 'border-violet-400 bg-violet-50 shadow-sm',
    label: 'text-violet-900', count: 'text-violet-700', heading: 'text-violet-700',
  },
};

const FALLBACK_SKIN: GroupSkin = {
  badge: 'bg-ink text-white',
  tileIdle: 'border-line bg-paper hover:bg-haze',
  tileActive: 'border-line bg-cloud/60 shadow-sm',
  label: 'text-ink', count: 'text-ink-soft', heading: 'text-ink',
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
          const skin = GROUP_SKIN[g.key] ?? FALLBACK_SKIN;
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
              className={`group flex flex-col items-center justify-center gap-1.5 rounded-2xl border px-3 py-3 min-w-[96px] min-h-[92px] transition-all duration-150 ${
                isActive ? `${skin.tileActive} -translate-y-0.5` : skin.tileIdle
              }`}
            >
              {/* The icon chip keeps its colour whether the tile is open or
                  not, so the row reads as seven colours even at rest. */}
              <span
                className={`flex items-center justify-center w-9 h-9 rounded-xl transition-transform duration-150 ${skin.badge} ${
                  isActive ? 'scale-110' : 'group-hover:scale-105'
                }`}
              >
                <Icon className="w-5 h-5" />
              </span>
              <span className={`text-[11px] font-semibold leading-tight text-center ${isActive ? skin.label : 'text-ink-soft'}`}>
                {g.label}
              </span>
              <span className={`text-[10px] leading-none font-semibold ${isActive ? skin.count : 'text-ink-mute'}`}>
                {g.reports.length}
              </span>
            </button>
          );
        })}
      </div>

      {active && (
        <div role="tabpanel" aria-label={active.label}>
          {/* The heading carries the same hue as the open tile, so the eye
              can follow the colour down from the row. */}
          <div className="flex items-baseline gap-2 mb-2">
            <h2 className={`text-base font-semibold ${(GROUP_SKIN[active.key] ?? FALLBACK_SKIN).heading}`}>
              {active.label}
            </h2>
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
