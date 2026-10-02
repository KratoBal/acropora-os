/**
 * THE SYSTEM'S NUMBER FORMAT, ONCE (owner decision, 2026-10-02, JEV
 * discovery Q5): exactly what the product pages already write,
 * `toLocaleString("hu-HU", …)`, so every page writes numbers the same way.
 *
 * Known and accepted: this format does not group four-digit numbers ("3000",
 * while "12 500" gets a no-break space). The Figma's "3 000 l/h" therefore
 * renders "3000 l/h". Changing that is a system-wide decision, not this
 * helper's. Decimals take the comma ("1,00").
 *
 * Used by the JEV views and the Anyagigény V2 quantities; no other page's
 * output changes.
 */
export function formatHuNumber(
  value: number | string,
  options: Intl.NumberFormatOptions = { maximumFractionDigits: 3 },
): string {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return String(value);
  return number.toLocaleString("hu-HU", options);
}
