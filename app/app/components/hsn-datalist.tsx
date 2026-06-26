import { HSN_TEXTILE } from '@/lib/hsn-textile';

/**
 * Shared <datalist> of textile HSN/SAC codes. Render it once on a form, then
 * point any HSN <input> at it with list="hsn-textile" to get native
 * type-ahead suggestions (code + description) with no extra wiring.
 */
export function HsnDatalist() {
  return (
    <datalist id="hsn-textile">
      {HSN_TEXTILE.map((e) => (
        <option key={e.code} value={e.code}>
          {e.code} — {e.label}
        </option>
      ))}
    </datalist>
  );
}
