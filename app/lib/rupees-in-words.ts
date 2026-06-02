/**
 * Convert a numeric rupee amount into the Indian-system long-form words
 * used at the foot of every invoice ("Rupees forty eight thousand three
 * hundred thirty seven only"). Supports up to 99 crore which is plenty
 * for an SME textile mill.
 *
 * Examples:
 *   rupeesInWords(48337)    -> "Rupees Forty Eight Thousand Three Hundred Thirty Seven Only"
 *   rupeesInWords(1024.50)  -> "Rupees One Thousand Twenty Four and Fifty Paise Only"
 *   rupeesInWords(0)        -> "Rupees Zero Only"
 */

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen',
  'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n] ?? '';
  const t = Math.floor(n / 10);
  const o = n % 10;
  return TENS[t] + (o > 0 ? ' ' + ONES[o] : '');
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h > 0) parts.push(ONES[h] + ' Hundred');
  if (rest > 0) parts.push(twoDigits(rest));
  return parts.join(' ');
}

/** @returns "Forty Eight Thousand Three Hundred Thirty Seven" - no Rupees / Only. */
function indianWholeWords(n: number): string {
  if (n === 0) return 'Zero';
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const hundreds = n % 1000;

  const parts: string[] = [];
  if (crore > 0)   parts.push(twoDigits(crore)   + ' Crore');
  if (lakh > 0)    parts.push(twoDigits(lakh)    + ' Lakh');
  if (thousand > 0) parts.push(twoDigits(thousand) + ' Thousand');
  if (hundreds > 0) parts.push(threeDigits(hundreds));
  return parts.join(' ');
}

export function rupeesInWords(amount: number | string | null | undefined): string {
  const n = Number(amount ?? 0);
  if (!Number.isFinite(n)) return 'Rupees Zero Only';
  const rounded = Math.round(n * 100) / 100;
  const whole = Math.floor(Math.abs(rounded));
  const paise = Math.round((Math.abs(rounded) - whole) * 100);
  const sign = rounded < 0 ? 'Minus ' : '';

  const wholeWords = indianWholeWords(whole);
  if (paise === 0) return `${sign}Rupees ${wholeWords} Only`;
  return `${sign}Rupees ${wholeWords} and ${twoDigits(paise)} Paise Only`;
}
