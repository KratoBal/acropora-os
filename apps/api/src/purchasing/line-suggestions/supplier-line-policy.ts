/**
 * A BESZÁLLÍTÓI SZÁMLASOR -> TERMÉK JAVASLAT RÖGZÍTETT KERETE (#1199 P-026,
 * PD-010 revised, ACD-019). Semmi nem hangolható itt: minden érték a mért
 * állapot, és ha bármelyik változik, az új policy-verzió és új mérés.
 *
 *   - policy: a Stage B `p3-final` (`agents/nautilus/a008/stage-b/policies/
 *     p3-final.json`, sha256 eba04bb2...), SZÖVEGRE; a kérdés kulcsa "match",
 *     mert azzal mértük (V0 HOLDOUT, P-023 120)
 *   - modell: jev-1.13.0, rögzítve; eltűnésekor a javaslat leáll, nincs csere
 *   - jelöltek: a Stage A (`stage-a-v3`) legfeljebb 30 jelöltje
 *   - LÁTHATÓ javaslat csak 0,9 bizonyosság felett (PD-010); a policy saját
 *     0,7-es küszöbe a MATCH/AMBIGUOUS határ, az auditban ez is rögzül
 *   - NONE és AMBIGUOUS nem cselekszik
 */
export const SUPPLIER_LINE_JEV_POLICY = {
  key: "supplier-line-jev",
  version: 1,
  name: "hertlein-line-match-p3-final",
  model: "jev-1.13.0",
  questionKey: "match",
  stateTemplate:
    "Supplier invoice line from Hertlein Aquaristik (German wording): {line}",
  instructions:
    "An aquarium shop receives this supplier invoice line and must find the catalogue product (Hungarian names) that this supplier article is received as. The right product has the same brand, the same product line and the same type. The catalogue may name it in Hungarian or under the distributor's brand. A product sold weighed out ('kimért', per kg or per 100 g) is not the supplier's pack: do not choose it when the pack itself is a candidate. When several candidates are the same product in different pack sizes, choose the one with the same pack size. Choose NONE only if no candidate is the same product at all.",
  noneDescription: "None of the catalogue products is this supplier article",
  minConfidence: 0.7,
  minMargin: 0,
} as const;

/** PD-010: a javaslat CSAK ennél a bizonyosságnál jelenik meg. */
export const SUPPLIER_LINE_SHOWN_CONFIDENCE = 0.9;

export const NONE_KEY = "NONE";

/** A determinisztikus források: saját policy-kulcs, hogy az auditban külön álljanak. */
export const SUPPLIER_LINE_MAPPING_POLICY = {
  key: "supplier-line-mapping",
  version: 1,
} as const;
export const SUPPLIER_LINE_EAN_POLICY = {
  key: "supplier-line-ean",
  version: 1,
} as const;
/** The supplier's code is our SKU or MPN (see `supplier-code-match.ts`). */
export const SUPPLIER_LINE_CODE_POLICY = {
  key: "supplier-line-code",
  version: 1,
} as const;
export const DETERMINISTIC_MODEL = "deterministic";

/**
 * A Stage B személyesadat-őre, szövegre (`stage_b.py` `_PERSONAL`): e-mail,
 * nemzetközi telefonszám, IBAN-alak. A teljes kérésre fut, mielőtt bármi
 * kimegy; ha illeszkedik, NINCS hívás. Ismert téves riasztása egy csavar
 * mérete ("38/40+40/60", ACD-018): a szűkebb, sémára szabott őr (P-027)
 * külön döntés, ez a pilot nem lazít.
 */
export const PERSONAL_DATA_PATTERN =
  /[\w.+-]+@[\w-]+\.[\w.]+|\+\d{2}[\s/-]?\d{2,}|\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,}/;

/** A p3-final döntése egy válaszból (a Stage B `decide`, szóról szóra). */
export function decideSupplierLine(answer: {
  choice: string;
  confidence: number;
  probabilities: Readonly<Record<string, number>>;
}): "MATCH" | "NONE" | "AMBIGUOUS" {
  if (answer.choice === NONE_KEY) return "NONE";
  if (answer.confidence < SUPPLIER_LINE_JEV_POLICY.minConfidence)
    return "AMBIGUOUS";
  const probabilities = Object.values(answer.probabilities).sort(
    (a, b) => b - a,
  );
  if (
    probabilities.length > 1 &&
    probabilities[0]! - probabilities[1]! < SUPPLIER_LINE_JEV_POLICY.minMargin
  )
    return "AMBIGUOUS";
  return "MATCH";
}
