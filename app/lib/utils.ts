import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Combine class names with Tailwind conflict resolution. Used by every component. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format paise/rupee values for display: 12345.67 → "₹12,345.67" */
export function formatRupee(amount: number | string | null | undefined, opts?: { decimals?: number; compact?: boolean }) {
  if (amount === null || amount === undefined || amount === '') return '—';
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (Number.isNaN(n)) return '—';
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
  const n = typeof m === 'string' ? parseFloat(m) : m;
  if (Number.isNaN(n)) return '—';
  return `${n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} m`;
}

/** Format kg: 1234.5 → "1,234.5 kg" */
export function formatKg(kg: number | string | null | undefined, decimals = 1) {
  if (kg === null || kg === undefined || kg === '') return '—';
  const n = typeof kg === 'string' ? parseFloat(kg) : kg;
  if (Number.isNaN(n)) return '—';
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
