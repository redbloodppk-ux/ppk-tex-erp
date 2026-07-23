'use client';

/**
 * Charts for the Loom Efficiency & Cost report. Pure presentation — all
 * numbers are computed server-side in page.tsx and passed in as props.
 */

import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, CartesianGrid,
  XAxis, YAxis, Tooltip, ReferenceLine, Cell,
} from 'recharts';

const INDIGO  = '#4f46e5';
const AMBER   = '#f59e0b';
const EMERALD = '#10b981';
const ROSE    = '#e11d48';

export interface TrendPoint {
  key: string;
  label: string;
  metres: number;
  actualCostPerM: number | null;
  targetCostPerM: number | null;
  actualEfficiencyPct: number | null;
  targetEfficiencyPct: number | null;
}

export interface ShedPoint {
  name: string;
  metres: number;
  actualEfficiencyPct: number | null;
}

interface TooltipEntry { value?: number | string; payload?: TrendPoint | ShedPoint }

function ChartTip({
  active, payload, label, formatter,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  formatter: (entry: TooltipEntry) => string;
}) {
  const first = payload?.[0];
  if (!active || !first) return null;
  return (
    <div className="rounded-lg border border-line/60 bg-paper px-3 py-2 shadow-lg text-xs">
      <div className="font-semibold text-ink mb-0.5">{label}</div>
      <div className="text-ink-soft">{formatter(first)}</div>
    </div>
  );
}

export function EfficiencyCharts({
  trend, shedTotals, hasTarget,
}: {
  trend: TrendPoint[];
  shedTotals: ShedPoint[];
  hasTarget: boolean;
}) {
  const targetCost = trend.find((t) => t.targetCostPerM != null)?.targetCostPerM ?? null;
  const targetEff = trend.find((t) => t.targetEfficiencyPct != null)?.targetEfficiencyPct ?? null;

  return (
    <div className="grid lg:grid-cols-2 gap-4 mb-4">
      {/* Cost per metre trend */}
      <div className="card p-4">
        <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide mb-2">
          Cost / metre — actual vs target
        </h3>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={14} />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip
                content={
                  <ChartTip
                    formatter={(e) => {
                      const p = e.payload as TrendPoint;
                      return `Actual ₹${(p.actualCostPerM ?? 0).toFixed(2)}/m${p.targetCostPerM != null ? ` · Target ₹${p.targetCostPerM.toFixed(2)}/m` : ''}`;
                    }}
                  />
                }
              />
              {hasTarget && targetCost != null && (
                <ReferenceLine y={targetCost} stroke={AMBER} strokeDasharray="5 3" strokeWidth={1.5} />
              )}
              <Line
                type="monotone" dataKey="actualCostPerM" stroke={INDIGO} strokeWidth={2.5}
                dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[11px] text-ink-mute mt-1">
          Solid line = actual (wages + factory expenses ÷ metres). Dashed = target from Settings.
        </p>
      </div>

      {/* Efficiency % trend */}
      <div className="card p-4">
        <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide mb-2">
          Loom efficiency % — actual vs target
        </h3>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trend} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={14} />
              <YAxis domain={[0, (max: number) => Math.max(100, Math.ceil(max / 10) * 10)]} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ fill: 'rgba(79,70,229,0.06)' }}
                content={
                  <ChartTip
                    formatter={(e) => {
                      const p = e.payload as TrendPoint;
                      return `${(p.actualEfficiencyPct ?? 0).toFixed(1)}% actual${p.targetEfficiencyPct != null ? ` · target ${p.targetEfficiencyPct.toFixed(0)}%` : ''} · ${p.metres.toLocaleString('en-IN')} m`;
                    }}
                  />
                }
              />
              {hasTarget && targetEff != null && (
                <ReferenceLine y={targetEff} stroke={AMBER} strokeDasharray="5 3" strokeWidth={1.5} />
              )}
              <Bar dataKey="actualEfficiencyPct" radius={[5, 5, 0, 0]} maxBarSize={28}>
                {trend.map((t) => (
                  <Cell
                    key={t.key}
                    fill={
                      t.actualEfficiencyPct == null
                        ? '#e5e7eb'
                        : targetEff != null && t.actualEfficiencyPct >= targetEff
                          ? EMERALD
                          : targetEff != null && t.actualEfficiencyPct >= targetEff * 0.85
                            ? AMBER
                            : ROSE
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[11px] text-ink-mute mt-1">
          Green = at/above target, amber = within 15% of target, red = below that.
        </p>
      </div>

      {/* By-shed efficiency (only meaningful across multiple sheds) */}
      {shedTotals.length > 1 && (
        <div className="card p-4 lg:col-span-2">
          <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide mb-2">
            Efficiency % by shed (whole period)
          </h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={shedTotals} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis domain={[0, (max: number) => Math.max(100, Math.ceil(max / 10) * 10)]} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: 'rgba(139,92,246,0.08)' }}
                  content={
                    <ChartTip
                      formatter={(e) => {
                        const p = e.payload as ShedPoint;
                        return `${(p.actualEfficiencyPct ?? 0).toFixed(1)}% · ${p.metres.toLocaleString('en-IN')} m`;
                      }}
                    />
                  }
                />
                <Bar dataKey="actualEfficiencyPct" radius={[5, 5, 0, 0]} maxBarSize={44} label={{ position: 'top', fontSize: 10, formatter: (v: number) => `${v.toFixed(0)}%` }}>
                  {shedTotals.map((s, i) => (
                    <Cell key={s.name} fill="#8b5cf6" fillOpacity={1 - i * 0.15} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
