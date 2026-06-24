'use client';

/**
 * ThemeSettings — the Settings → Appearance panel.
 *
 * Lets each user recolour the sidebar, top bar and page background, pick
 * matching text/icon colours, and resize the whole app's text. Everything is
 * saved per-device (localStorage) and applied live as the user tweaks — no
 * database, no reload. A row of one-tap presets and a Reset button keep it
 * approachable.
 */
import { useEffect, useState } from 'react';
import { RotateCcw, Check } from 'lucide-react';
import {
  ThemeConfig,
  DEFAULT_THEME,
  THEME_PRESETS,
  FONT_MIN,
  FONT_MAX,
  loadTheme,
  saveTheme,
} from '@/lib/theme';

/** One labelled colour swatch + native colour picker. */
function ColorField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-2">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        <span className="block text-xs text-ink-mute">{hint}</span>
      </span>
      <span className="flex items-center gap-2 shrink-0">
        <span className="text-xs font-mono uppercase text-ink-soft">{value}</span>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 rounded-lg border border-line cursor-pointer bg-paper p-0.5"
          aria-label={label}
        />
      </span>
    </label>
  );
}

export function ThemeSettings() {
  // Start from defaults for a stable first render, then load the saved theme
  // on mount (localStorage isn't available during SSR).
  const [theme, setTheme] = useState<ThemeConfig>(DEFAULT_THEME);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  useEffect(() => {
    setTheme(loadTheme());
  }, []);

  function update(patch: Partial<ThemeConfig>) {
    const next: ThemeConfig = { ...theme, ...patch };
    setTheme(next);
    setActivePreset(null);
    saveTheme(next);
  }

  function applyPreset(id: string) {
    const preset = THEME_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    const next: ThemeConfig = { ...preset.theme };
    setTheme(next);
    setActivePreset(id);
    saveTheme(next);
  }

  function reset() {
    const next: ThemeConfig = { ...DEFAULT_THEME };
    setTheme(next);
    setActivePreset(THEME_PRESETS[0]?.id ?? null);
    saveTheme(next);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display font-bold text-base">Appearance</h2>
        <button onClick={reset} className="btn-ghost btn-sm gap-1.5" title="Reset to default look">
          <RotateCcw className="w-3.5 h-3.5" />
          Reset
        </button>
      </div>
      <p className="text-xs text-ink-mute mb-4">
        Changes apply instantly and are saved on this device only — each phone or computer keeps its own look.
      </p>

      {/* One-tap palettes */}
      <div className="mb-5">
        <span className="label">Quick themes</span>
        <div className="flex flex-wrap gap-2">
          {THEME_PRESETS.map((p) => {
            const selected = activePreset === p.id;
            return (
              <button
                key={p.id}
                onClick={() => applyPreset(p.id)}
                className={`relative flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  selected ? 'border-indigo ring-2 ring-indigo/30' : 'border-line hover:bg-cloud'
                }`}
                title={p.name}
              >
                <span className="flex -space-x-1">
                  <span className="w-4 h-4 rounded-full border border-white" style={{ backgroundColor: p.theme.sidebarBg }} />
                  <span className="w-4 h-4 rounded-full border border-white" style={{ backgroundColor: p.theme.topbarBg }} />
                  <span className="w-4 h-4 rounded-full border border-white" style={{ backgroundColor: p.theme.pageBg }} />
                </span>
                {p.name}
                {selected && <Check className="w-3.5 h-3.5 text-indigo" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Individual colours */}
      <div className="divide-y divide-line/60 border-y border-line/60 mb-5">
        <ColorField
          label="Sidebar background"
          hint="The left navigation rail"
          value={theme.sidebarBg}
          onChange={(hex) => update({ sidebarBg: hex })}
        />
        <ColorField
          label="Sidebar text & icons"
          hint="Links and icons on the rail"
          value={theme.sidebarFg}
          onChange={(hex) => update({ sidebarFg: hex })}
        />
        <ColorField
          label="Top bar background"
          hint="The bar across the top"
          value={theme.topbarBg}
          onChange={(hex) => update({ topbarBg: hex })}
        />
        <ColorField
          label="Top bar text & icons"
          hint="Name, search and icons up top"
          value={theme.topbarFg}
          onChange={(hex) => update({ topbarFg: hex })}
        />
        <ColorField
          label="Page background"
          hint="Behind every page's content"
          value={theme.pageBg}
          onChange={(hex) => update({ pageBg: hex })}
        />
      </div>

      {/* Font-size slider */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="label mb-0">Text size</span>
          <span className="text-xs font-mono text-ink-soft">{theme.fontPx}px</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-mute">A</span>
          <input
            type="range"
            min={FONT_MIN}
            max={FONT_MAX}
            step={1}
            value={theme.fontPx}
            onChange={(e) => update({ fontPx: Number(e.target.value) })}
            className="flex-1 accent-indigo cursor-pointer"
            aria-label="App text size"
          />
          <span className="text-lg text-ink-mute">A</span>
        </div>
        <p className="text-xs text-ink-mute mt-1.5">Drag to make all text bigger or smaller across the whole app.</p>
      </div>
    </div>
  );
}
