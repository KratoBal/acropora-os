/**
 * THE USAGE GUIDE SECTION OF THE SHIPPED MAIL, ITS WORDS AND ITS DOSE LINE (V3.3, card 69b5f2ef, korall's spec
 * `exchange/otletek-2026-11-04/v3-3-level-spec.md`).
 *
 * Hungarian only: the first version has no English text (spec points 1 and 7), so an English order gets no section at
 * all, never these words. The texts are korall's, word for word; they are not adjustable per mail.
 */
export const WEBSHOP_USAGE_GUIDE_TEXT = {
  title: "Használati útmutató a rendelt termékeidhez",
  intro:
    "Röviden összefoglaltuk, hogyan használd a megrendelt termékeket. A teljes útmutató a termék oldalán van.",
  /** Before every dose line; the dose always comes from the manufacturer's source (T5.3). */
  dosePrefix: "Adagolás (a gyártó szerint):",
  link: "Teljes útmutató a termék oldalán",
  /** In place of the dose line (case B), or alone under a treatment's name (case D). A fixed sentence, not data. */
  fallback:
    "Kövesd a csomagoláson található gyártói utasítást. Kérdés esetén keress minket.",
  /** After the shown products, when there are more. */
  rest: "A többi termék útmutatója a termék oldalán van.",
  /** Once, at the end of the section. */
  closing:
    "A pontos adagolás és a biztonsági tudnivalók a termék oldalán és a csomagoláson vannak. Ha kérdésed van, keress minket.",
} as const;

/**
 * THE DOSE, READ FROM THE OS CANONICAL FORM AND ONLY FROM IT: the `dosing` fact is stored as the JEV `parseDose`
 * output's `canonical` (`packages/jev/src/product-enrichment/units.ts`), one spelling:
 *
 *   "5 ml/100 L/day"            -> "5 ml / 100 liter, naponta"
 *   "1 drop/100 L, 1-2/week"    -> "1 csepp / 100 liter, hetente 1-2 alkalommal"
 *   "0.5 ml/100 L, 3/day"       -> "0,5 ml / 100 liter, naponta 3 alkalommal"
 *
 * Anything else is `null`, on purpose: a second, more lenient reader of the same form would read something else out of
 * it silently, and a wrong dose can kill a living animal (the storefront's `adagolas.ts` reads it the same strict way,
 * and its wording is the one here, so the product page and the mail say the same thing).
 */
const NUMBER = "(\\d+(?:\\.\\d+)?)";
const CANONICAL_DOSE = new RegExp(
  `^${NUMBER} (drop|ml)/${NUMBER} L(?:/(day|week)|, (\\d+)(?:-(\\d+))?/(day|week))$`,
);

/**
 * A canonical decimal in Hungarian, EXACTLY: the integer part grouped (four digits too, "1 000", as the shop writes its
 * amounts; the hu locale data groups only from five digits), the decimal point a comma, the fraction as it stands. No
 * rounding: the line says "a gyártó szerint", and 0.125 rounded to "0,13" would be more than the manufacturer's dose, 0.004
 * rounded to "0" no dose at all (barracuda, #2527 review).
 */
const HU_INTEGER = new Intl.NumberFormat("hu-HU", {
  maximumFractionDigits: 0,
  // "always" is ES2023; this lib types useGrouping as a boolean
  ...({ useGrouping: "always" } as unknown as Intl.NumberFormatOptions),
});

const huDecimal = (canonical: string): string => {
  const [integer = "", fraction] = canonical.split(".");
  const grouped = HU_INTEGER.format(BigInt(integer));
  return fraction ? `${grouped},${fraction}` : grouped;
};

export function webshopDoseLine(canonical: unknown): string | null {
  if (typeof canonical !== "string") return null;
  const m = CANONICAL_DOSE.exec(canonical);
  if (!m) return null;
  const [, amountRaw, unit, litresRaw, plainPeriod, minRaw, maxRaw, period] = m;
  const amount = Number(amountRaw);
  const litres = Number(litresRaw);
  const min = minRaw === undefined ? 1 : Number(minRaw);
  const max = maxRaw === undefined ? min : Number(maxRaw);
  // the same bounds as parseDose: no zero dose, a frequency from 1, no reversed range, no fraction of a drop
  if (!(amount > 0) || !(litres > 0) || min < 1 || max < min) return null;
  if (unit === "drop" && !Number.isInteger(amount)) return null;
  const times = min === max ? String(min) : `${min}-${max}`;
  const every = (plainPeriod ?? period) === "day" ? "naponta" : "hetente";
  const frequency =
    min === 1 && max === 1 ? every : `${every} ${times} alkalommal`;
  return `${huDecimal(amountRaw!)} ${unit === "drop" ? "csepp" : "ml"} / ${huDecimal(litresRaw!)} liter, ${frequency}`;
}
