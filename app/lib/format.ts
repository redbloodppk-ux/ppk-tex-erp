/** Format a number as Indian-locale rupees with 2 decimal places, e.g. "₹1,23,456.78". */
export function fmtRupees(n: number): string {
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
