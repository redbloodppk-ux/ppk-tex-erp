/**
 * BrandLogo — the official PPK TEX logo as an inline SVG React component.
 *
 * Use this anywhere the brand should appear: sidebar, app shell, DC print
 * templates, invoice print templates, error pages, etc.
 *
 * Three layouts:
 *   - "horizontal" (default) — square mark + wordmark side-by-side. Best for
 *     letterheads, top-of-page in DC / invoice prints, app navbar.
 *   - "mark" — just the square monogram. Best for favicons, watermarks,
 *     avatars, tight nav corners.
 *   - "stacked" — mark on top, wordmark centred below. Best for cover pages
 *     and large branded surfaces.
 *
 * Pass `mono` for black-and-white printing (fax, photocopy, basic laser
 * printers) — the colour bleeds out and the mark stays legible at 100 DPI.
 */
import * as React from 'react';

export type BrandLogoVariant = 'horizontal' | 'mark' | 'stacked';

export interface BrandLogoProps {
  /** Layout variant. Default: "horizontal". */
  variant?: BrandLogoVariant;
  /** Render in black-and-white instead of indigo + gold. */
  mono?: boolean;
  /** Height in pixels (width scales to maintain aspect ratio). */
  height?: number;
  /** Extra Tailwind classes for the wrapper svg. */
  className?: string;
  /** Tagline under the wordmark. Defaults to "EST 1988 · ERODE". Pass "" to hide. */
  tagline?: string;
}

const COLOR = {
  bg: '#1F2057',
  thread: '#E8B040',
  white: '#FFFFFF',
  ink: '#1F2057',
  mute: '#888888',
};

const MONO = {
  bg: '#000000',
  thread: '#FFFFFF',
  white: '#FFFFFF',
  ink: '#000000',
  mute: '#000000',
};

export function BrandLogo({
  variant = 'horizontal',
  mono = false,
  height = 40,
  className,
  tagline = 'EST 1988 \u00b7 ERODE',
}: BrandLogoProps): React.ReactElement {
  const c = mono ? MONO : COLOR;

  // ───── Just the square monogram ─────
  if (variant === 'mark') {
    return (
      <svg
        viewBox="0 0 110 110"
        height={height}
        width={height}
        role="img"
        aria-label="PPK TEX"
        className={className}
      >
        <rect x={6} y={6} width={98} height={98} rx={10} fill={c.bg} />
        {!mono && (
          <g stroke={c.thread} strokeWidth={2} opacity={0.35}>
            <line x1={20} y1={14} x2={20} y2={96} />
            <line x1={32} y1={14} x2={32} y2={96} />
            <line x1={80} y1={14} x2={80} y2={96} />
            <line x1={90} y1={14} x2={90} y2={96} />
          </g>
        )}
        <path
          d="M 28 30 L 28 84 M 28 30 L 52 30 Q 70 30 70 44 Q 70 58 52 58 L 28 58"
          stroke={c.white}
          strokeWidth={9}
          fill="none"
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
        <path
          d="M 42 44 L 84 44 M 64 44 L 64 86"
          stroke={c.thread}
          strokeWidth={9}
          fill="none"
          strokeLinecap="square"
          opacity={mono ? 0.55 : 1}
        />
      </svg>
    );
  }

  // ───── Stacked layout (mark on top, wordmark below) ─────
  if (variant === 'stacked') {
    const hasTag = tagline.trim().length > 0;
    const viewH = hasTag ? 200 : 180;
    return (
      <svg
        viewBox={`0 0 220 ${viewH}`}
        height={height}
        width={(height * 220) / viewH}
        role="img"
        aria-label="PPK TEX"
        className={className}
      >
        {/* Centred mark */}
        <g transform="translate(60, 6)">
          <rect x={0} y={0} width={100} height={100} rx={10} fill={c.bg} />
          {!mono && (
            <g stroke={c.thread} strokeWidth={2} opacity={0.35}>
              <line x1={14} y1={8} x2={14} y2={92} />
              <line x1={26} y1={8} x2={26} y2={92} />
              <line x1={74} y1={8} x2={74} y2={92} />
              <line x1={84} y1={8} x2={84} y2={92} />
            </g>
          )}
          <path
            d="M 22 26 L 22 80 M 22 26 L 46 26 Q 64 26 64 40 Q 64 54 46 54 L 22 54"
            stroke={c.white}
            strokeWidth={9}
            fill="none"
            strokeLinecap="square"
            strokeLinejoin="miter"
          />
          <path
            d="M 36 40 L 78 40 M 58 40 L 58 82"
            stroke={c.thread}
            strokeWidth={9}
            fill="none"
            strokeLinecap="square"
            opacity={mono ? 0.55 : 1}
          />
        </g>
        <text
          x={110}
          y={140}
          textAnchor="middle"
          fontFamily="Georgia, 'Times New Roman', serif"
          fontSize={28}
          fontWeight={700}
          fill={c.ink}
          letterSpacing={4}
        >
          PPK TEX
        </text>
        {hasTag && (
          <text
            x={110}
            y={166}
            textAnchor="middle"
            fontFamily="Helvetica, Arial, sans-serif"
            fontSize={10}
            fill={c.mute}
            letterSpacing={5}
          >
            {tagline}
          </text>
        )}
      </svg>
    );
  }

  // ───── Horizontal layout (default) ─────
  const hasTag = tagline.trim().length > 0;
  const viewH = hasTag ? 110 : 92;
  return (
    <svg
      viewBox={`0 0 240 ${viewH}`}
      height={height}
      width={(height * 240) / viewH}
      role="img"
      aria-label="PPK TEX"
      className={className}
    >
      <rect x={6} y={6} width={98} height={98} rx={10} fill={c.bg} />
      {!mono && (
        <g stroke={c.thread} strokeWidth={2} opacity={0.35}>
          <line x1={20} y1={14} x2={20} y2={96} />
          <line x1={32} y1={14} x2={32} y2={96} />
          <line x1={80} y1={14} x2={80} y2={96} />
          <line x1={90} y1={14} x2={90} y2={96} />
        </g>
      )}
      <path
        d="M 28 30 L 28 84 M 28 30 L 52 30 Q 70 30 70 44 Q 70 58 52 58 L 28 58"
        stroke={c.white}
        strokeWidth={9}
        fill="none"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <path
        d="M 42 44 L 84 44 M 64 44 L 64 86"
        stroke={c.thread}
        strokeWidth={9}
        fill="none"
        strokeLinecap="square"
        opacity={mono ? 0.55 : 1}
      />
      <text
        x={118}
        y={hasTag ? 60 : 65}
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize={26}
        fontWeight={700}
        fill={c.ink}
        letterSpacing={3}
      >
        PPK TEX
      </text>
      {hasTag && (
        <text
          x={118}
          y={80}
          fontFamily="Helvetica, Arial, sans-serif"
          fontSize={9}
          fill={c.mute}
          letterSpacing={4}
        >
          {tagline}
        </text>
      )}
    </svg>
  );
}
