import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Combine class names with Tailwind conflict resolution. Used by every component. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Round to the precision about to be shown, and kill negative zero.
 *
 * PPK, 2026-09-14, on the Warehouse ledger: "why zero is negative?" — a
 * column whose total in and total out were both 593.05 kg closed at
 * "−0.00 kg".
 *
 * Nothing was wrong with the stock. Adding a few dozen decimal numbers in
 * binary floating point leaves dust: 593.05 − 593.05 came out as about
 * −6e−14, which is zero for every purpose except its sign bit.
 * toLocaleString rounds the digits and keeps the sign, so the dust is
 * invisible but the minus survives.
 *
 * Rounding first collapses the dust to 0 or -0, and Object.is picks off the
 * -0. Done here rather than at each call site because every screen that
 * subtracts two quantities can produce it, and a column that reads −0.00
 * looks like a stock error to whoever is holding the stock book.
 */
export function snapZero(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(n * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Format paise/rupee values for display: 12345.67 → "₹12,345.67" */
export function formatRupee(amount: number | string | null | undefined, opts?: { decimals?: number; compact?: boolean }) {
  if (amount === null || amount === undefined || amount === '') return '—';
  const raw = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (Number.isNaN(raw)) return '—';
  const n = snapZero(raw, opts?.decimals ?? 2);
  if (opts?.compact && Math.abs(n) >= 100000) {
    if (Math.abs(n) >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
    return `₹${(n / 100000).toFixed(2)} L`;
  }
  return n.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: opts?.decimals ?? 2,
    maximumFractionDigits: opts?.decimals ?? 2,
  });
}

/** Format metres: 1234.5 → "1,234.5 m" */
export function formatMetres(m: number | string | null | undefined, decimals = 1) {
  if (m === null || m === undefined || m === '') return '—';
  const raw = typeof m === 'string' ? parseFloat(m) : m;
  if (Number.isNaN(raw)) return '—';
  const n = snapZero(raw, decimals);
  return `${n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} m`;
}

/** Format kg: 1234.5 → "1,234.5 kg" */
export function formatKg(kg: number | string | null | undefined, decimals = 1) {
  if (kg === null || kg === undefined || kg === '') return '—';
  const raw = typeof kg === 'string' ? parseFloat(kg) : kg;
  if (Number.isNaN(raw)) return '—';
  const n = snapZero(raw, decimals);
  return `${n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} kg`;
}

/** Format date for display in Asia/Kolkata. */
export function formatDate(date: string | Date | null | undefined, fmt: 'short' | 'long' = 'short') {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (fmt === 'long') {
    return d.toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric', month: 'long', year: 'numeric',
    });
  }
  return d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

/** Convert Denier to NeC (English cotton count). Used for Porvai polyester yarn. */
export function denierToNeC(denier: number) {
  if (!denier || denier <= 0) return 0;
  return 5315 / denier;
}

/** Compute warp metres-per-gram for woven fabric. Constant 1848 from Costing Spec v1.1. */
export function warpMetresPerGram(args: { ne: number; reedCount: number; fabricWidthIn: number; shrinkagePct: number }) {
  const { ne, reedCount, fabricWidthIn, shrinkagePct } = args;
  if (!ne || !reedCount || !fabricWidthIn) return 0;
  return 1848 / (ne * reedCount * fabricWidthIn * (1 + shrinkagePct));
}

/** Compute weft metres-per-gram. Constant 1690 from Costing Spec v1.1. */
export function weftMetresPerGram(args: { ne: number; pickPpi: number; fabricWidthIn: number }) {
  const { ne, pickPpi, fabricWidthIn } = args;
  if (!ne || !pickPpi || !fabricWidthIn) return 0;
  return 1690 / (ne * pickPpi * fabricWidthIn);
}

/** Compute Porvai metres-per-gram. Section 2.6 of Costing Spec v1.1. */
export function porvaiMetresPerGram(args: { neC: number; pickPpi: number; slevageLengthM: number }) {
  const { neC, pickPpi, slevageLengthM } = args;
  if (!neC || !pickPpi || slevageLengthM === undefined || slevageLengthM === null) return 0;
  return (1690 * neC / pickPpi) / (slevageLengthM + 3);
}
