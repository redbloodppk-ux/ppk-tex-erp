/**
 * Built-in textile HSN/SAC master for invoice auto-suggest.
 *
 * The GST portal has no free public HSN API (the site requires a logged-in
 * session + captcha and blocks direct calls), so instead of a live lookup we
 * ship a curated list covering the chapters a weaving / towel business uses:
 * yarn (52, 54, 55), woven fabrics (52, 54, 55, 58), made-ups incl. towels
 * (63), plus the common job-work / service SAC codes.
 *
 * Codes and descriptions follow the GST tariff. This is a convenience helper
 * for data entry only — always confirm the exact code for your product.
 */
export interface HsnEntry {
  /** HSN (goods) or SAC (services) code. */
  code: string;
  /** Short plain-language description shown in the suggestion list. */
  label: string;
}

export const HSN_TEXTILE: readonly HsnEntry[] = [
  // ── Cotton yarn (Chapter 52) ──────────────────────────────────────────
  { code: '5205', label: 'Cotton yarn (>=85% cotton), not for retail' },
  { code: '5206', label: 'Cotton yarn (<85% cotton), not for retail' },
  { code: '5207', label: 'Cotton yarn put up for retail sale' },
  { code: '5204', label: 'Cotton sewing thread' },

  // ── Woven cotton fabrics (Chapter 52) ─────────────────────────────────
  { code: '5208', label: 'Woven cotton fabric (>=85%), <=200 g/m2' },
  { code: '5209', label: 'Woven cotton fabric (>=85%), >200 g/m2' },
  { code: '5210', label: 'Woven cotton fabric (<85% mixed), <=200 g/m2' },
  { code: '5211', label: 'Woven cotton fabric (<85% mixed), >200 g/m2' },
  { code: '5212', label: 'Other woven cotton fabrics' },

  // ── Man-made / synthetic yarn & fabric (Chapters 54, 55) ──────────────
  { code: '5402', label: 'Synthetic filament yarn (nylon/polyester)' },
  { code: '5407', label: 'Woven fabric of synthetic filament yarn' },
  { code: '5509', label: 'Yarn of synthetic staple fibres, not for retail' },
  { code: '5510', label: 'Yarn of artificial staple fibres' },
  { code: '5512', label: 'Woven fabric (>=85% synthetic staple)' },
  { code: '5513', label: 'Woven fabric (<85% synthetic), <=170 g/m2' },
  { code: '5514', label: 'Woven fabric (<85% synthetic), >170 g/m2' },
  { code: '5515', label: 'Other woven fabric of synthetic staple fibres' },
  { code: '5516', label: 'Woven fabric of artificial staple fibres' },

  // ── Special / pile / terry woven fabrics (Chapter 58) ─────────────────
  { code: '5801', label: 'Woven pile fabrics & chenille' },
  { code: '5802', label: 'Terry towelling & similar woven terry fabrics' },
  { code: '5806', label: 'Narrow woven fabrics (tapes, niwar)' },

  // ── Made-up textile articles incl. towels (Chapter 63) ────────────────
  { code: '6301', label: 'Blankets and travelling rugs' },
  { code: '6302', label: 'Bed, table, toilet & kitchen linen' },
  { code: '63026000', label: 'Toilet / kitchen linen of terry towelling (towels)' },
  { code: '6303', label: 'Curtains, blinds & valances' },
  { code: '6304', label: 'Other furnishing articles (bed/cushion covers)' },
  { code: '6305', label: 'Sacks and bags for packing goods' },
  { code: '6307', label: 'Other made-up textile articles (dusters, etc.)' },

  // ── Other inputs / packing ────────────────────────────────────────────
  { code: '5601', label: 'Wadding; flock & textile dust' },
  { code: '5607', label: 'Twine, cordage, ropes & cables' },
  { code: '3923', label: 'Plastic packing covers / poly bags' },

  // ── Services / job-work SAC ───────────────────────────────────────────
  { code: '9988', label: 'Manufacturing services (job work) on goods' },
  { code: '998821', label: 'Textile manufacturing services (job work)' },
  { code: '998822', label: 'Wearing apparel manufacturing services' },
  { code: '997212', label: 'Rental / leasing of own property' },
  { code: '9965', label: 'Goods transport services (freight)' },
];

/** Lowercased, code+label haystack for quick client-side filtering. */
export function matchHsn(query: string): HsnEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...HSN_TEXTILE];
  return HSN_TEXTILE.filter(
    (e) => e.code.toLowerCase().includes(q) || e.label.toLowerCase().includes(q),
  );
}
