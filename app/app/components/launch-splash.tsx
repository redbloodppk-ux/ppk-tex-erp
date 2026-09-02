'use client';
/**
 * Animated in-app launch splash.
 *
 * Plays a short branded animation (PT mark pops in, "PPK TEX" rises, a gold
 * progress bar fills) over the navy brand colour, then fades out. Because it
 * renders inside the app it works the same on every platform — iPhone, Android
 * and desktop — unlike the static iOS apple-touch-startup-image set.
 *
 * Shown once per launch: a sessionStorage flag suppresses replay on in-session
 * client navigations, while a fresh launch (new PWA/browser session) clears it.
 * Honours prefers-reduced-motion by skipping the motion and shortening the hold.
 */
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

type Phase = 'show' | 'leaving' | 'done';
const SESSION_KEY = 'ppk_splash_shown';

export function LaunchSplash(): React.ReactElement | null {
  const [phase, setPhase] = useState<Phase>('show');
  const pathname = usePathname();
  // Never on a print page.
  //
  // This lives in the root layout, so it covered the invoice print page
  // too — a fixed, full-bleed navy panel at z-index 9999. On screen nobody
  // noticed, because you always arrive at a print page from inside the app
  // and the sessionStorage flag has already suppressed it.
  //
  // Headless Chrome is a fresh session every time, so the flag is unset and
  // the splash plays. It clears itself after ~2s; page.pdf() fired before
  // that and captured the splash sitting on top of the invoice. PPK,
  // 2026-09-02: "LOGO overlapped whole page" — the invoice text was all
  // present underneath, which is why the PDF's text still read correctly.
  //
  // The same trap exists for a human who opens a print URL directly in a
  // new tab and hits Ctrl+P straight away, so this is worth fixing here
  // rather than only in the renderer.
  const onPrintPage = (pathname ?? '').includes('/print');

  useEffect(() => {
    if (onPrintPage) {
      setPhase('done');
      return;
    }
    let alreadyShown = false;
    try {
      alreadyShown = sessionStorage.getItem(SESSION_KEY) === '1';
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      // sessionStorage may be unavailable (private mode) — just play it.
    }
    if (alreadyShown) {
      setPhase('done');
      return;
    }

    const reduce =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const holdMs = reduce ? 650 : 1550;
    const fadeMs = 450;
    const t1 = setTimeout(() => setPhase('leaving'), holdMs);
    const t2 = setTimeout(() => setPhase('done'), holdMs + fadeMs);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [onPrintPage]);

  if (onPrintPage || phase === 'done') return null;

  return (
    <div
      aria-hidden="true"
      className={`ppk-splash${phase === 'leaving' ? ' ppk-splash--leaving' : ''}`}
    >
      <style>{`
        .ppk-splash {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1.25rem;
          background: #1F2057;
          opacity: 1;
          transition: opacity 450ms ease;
          /* sit above the iOS notch / Android nav areas */
          padding: env(safe-area-inset-top) env(safe-area-inset-right)
                   env(safe-area-inset-bottom) env(safe-area-inset-left);
        }
        .ppk-splash--leaving { opacity: 0; }
        /* Belt and braces: even if this somehow renders on a printable
           page, it must never reach paper or a PDF. */
        @media print { .ppk-splash { display: none !important; } }
        .ppk-splash__mark {
          width: clamp(96px, 26vw, 168px);
          height: auto;
          animation: ppkPop 700ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .ppk-splash__word {
          font-family: Georgia, 'Times New Roman', serif;
          font-weight: 700;
          letter-spacing: 0.18em;
          font-size: clamp(20px, 5vw, 30px);
          color: #ffffff;
          margin-left: 0.18em; /* optical centring for the tracked caps */
          animation: ppkRise 600ms ease 280ms both;
        }
        .ppk-splash__bar {
          width: clamp(120px, 34vw, 200px);
          height: 3px;
          border-radius: 999px;
          background: rgba(232, 176, 64, 0.22);
          overflow: hidden;
        }
        .ppk-splash__bar > span {
          display: block;
          height: 100%;
          width: 100%;
          background: #E8B040;
          transform-origin: left center;
          animation: ppkFill 1500ms ease both;
        }
        .ppk-splash__warp { animation: ppkShimmer 1600ms ease-in-out both; }
        @keyframes ppkPop {
          0%   { opacity: 0; transform: scale(0.82); }
          60%  { opacity: 1; transform: scale(1.04); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes ppkRise {
          0%   { opacity: 0; transform: translateY(10px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes ppkFill {
          0%   { transform: scaleX(0); }
          100% { transform: scaleX(1); }
        }
        @keyframes ppkShimmer {
          0%   { opacity: 0.15; }
          50%  { opacity: 0.5; }
          100% { opacity: 0.3; }
        }
        @media (prefers-reduced-motion: reduce) {
          .ppk-splash__mark,
          .ppk-splash__word,
          .ppk-splash__bar > span,
          .ppk-splash__warp { animation: none; }
        }
      `}</style>

      <svg className="ppk-splash__mark" viewBox="0 0 110 110" role="img" aria-label="PPK TEX">
        <rect x="6" y="6" width="98" height="98" rx="16" fill="#23265f" stroke="#E8B040" strokeWidth="2" />
        <g className="ppk-splash__warp" stroke="#E8B040" strokeWidth="2" opacity="0.3">
          <line x1="20" y1="14" x2="20" y2="96" />
          <line x1="32" y1="14" x2="32" y2="96" />
          <line x1="80" y1="14" x2="80" y2="96" />
          <line x1="90" y1="14" x2="90" y2="96" />
        </g>
        <path
          d="M 28 30 L 28 84 M 28 30 L 52 30 Q 70 30 70 44 Q 70 58 52 58 L 28 58"
          stroke="#ffffff"
          strokeWidth="9"
          fill="none"
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
        <path
          d="M 42 44 L 84 44 M 64 44 L 64 86"
          stroke="#E8B040"
          strokeWidth="9"
          fill="none"
          strokeLinecap="square"
        />
      </svg>

      <div className="ppk-splash__word">PPK TEX</div>

      <div className="ppk-splash__bar">
        <span />
      </div>
    </div>
  );
}
