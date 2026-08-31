/**
 * Tax withheld from a supplier's bill — computed in ONE place.
 *
 * WHY THIS MODULE EXISTS
 * The same deduction is needed by four screens: the party ledger, the
 * printed party statement, the dashboard payables card, and TDS PAYABLE.
 * They were written at different times and drifted, which is how PPK ended
 * up looking at three different figures for one mill on 2026-08-30 — the
 * ledger said Rs 8,742.86, the dashboard said Rs 10,264.00, and the TDS
 * page counted the withholding a second time on top.
 *
 * That is the same failure as the fitter wage the same morning: two
 * implementations of one rule, both plausible, silently disagreeing. A rule
 * about money belongs in one function that every screen calls.
 *
 * THE RULES
 *  - TDS is withheld on the TAXABLE value — charges BEFORE GST. Bill 57 is
 *    Rs 16,099 of sizing charges plus 5% GST = Rs 16,904, and 2% comes off
 *    the 16,099, giving Rs 321.98. Never off the 16,904.
 *  - The rate lives on the party (party.tds_pct, migration 271). NULL means
 *    no TDS and is the default, so a new party never inherits a rate.
 *  - Rounded to paisa. Every caller must round identically or the same
 *    withholding appears to leak a few paise between screens.
 */

/** Rate is a percent: 2 means 2%. Returns 0 when no tax is withheld. */
export function tdsOnTaxable(
  taxable: number,
  pct: number | string | null | undefined,
): number {
  const rate = Number(pct ?? 0);
  const base = Number(taxable ?? 0);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  if (!Number.isFinite(base) || base <= 0) return 0;
  // x100 / round / /100 — two decimal places, done the same way everywhere.
  return Math.round(base * rate) / 100;
}

/**
 * Back out the pre-GST value from a GST-inclusive total.
 *
 * Used for yarn and fabric purchases, which store only the total and a
 * gst_pct. Sizing bills need none of this — sizing_job carries
 * charges_amount outright, and that figure should be preferred wherever it
 * exists, because a stored number beats a derived one.
 */
export function taxableFromTotal(
  total: number,
  gstPct: number | string | null | undefined,
): number {
  const t = Number(total ?? 0);
  const g = Number(gstPct ?? 0);
  if (!Number.isFinite(t)) return 0;
  return Number.isFinite(g) && g > 0 ? t / (1 + g / 100) : t;
}

/**
 * TDS on a bill whose taxable value must be derived from its total.
 * Convenience wrapper so callers do not re-pair the two functions
 * differently from one another.
 */
export function tdsOnGrossBill(
  total: number,
  gstPct: number | string | null | undefined,
  pct: number | string | null | undefined,
): number {
  return tdsOnTaxable(taxableFromTotal(total, gstPct), pct);
}
