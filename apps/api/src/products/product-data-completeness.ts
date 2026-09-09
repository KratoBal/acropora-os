/**
 * Read-only product-data completeness analysis for an AI agent.
 *
 * The policy deliberately produces an explicit `unrecognizable` state where
 * the reliability map requires a fact that cannot be established from one
 * catalogue row. Silence would otherwise look like a clean result.
 */

export type NameLevel =
  "SPECIES" | "GENUS" | "NON_SCIENTIFIC" | "INVALID_RECORD";

export type ForbiddenClaimStatus = "clear" | "detected" | "unrecognizable";

export type ForbiddenClaimPattern =
  | "BEGINNER_DIFFICULTY_FROM_GENUS"
  | "PAIRWISE_COMPATIBILITY"
  | "AZOOXANTHELLATE_FEEDING"
  | "GENUS_DERIVED_WATER_PARAMETERS"
  | "UNAPPROVED_LIVE_DELIVERY_PROMISE"
  | "SPS_SPECIES_SPECIFIC_HUSBANDRY"
  | "SPS_SPECIES_SPECIFIC_GROWTH_OR_COMPATIBILITY";

export interface ForbiddenClaimResult {
  pattern: ForbiddenClaimPattern;
  status: ForbiddenClaimStatus;
  reason: string;
}

export interface CatalogProduct {
  Id?: string | number;
  Sku?: string;
  Name?: string;
  Prices?: {
    Price?: { Gross?: string | number } | Array<{ Gross?: string | number }>;
  };
  Categories?: {
    Category?:
      | { Type?: string; Name?: string }
      | Array<{ Type?: string; Name?: string }>;
  };
  Description?: { Short?: string; Long?: string };
}

export interface ProductCompletenessResult {
  id: string | number | null;
  sku: string | null;
  missingRequiredFields: string[];
  forbiddenClaims: ForbiddenClaimResult[];
  nameLevel: NameLevel | null;
}

const LIVESTOCK_ROOTS = new Set(["Halak", "Gerinctelenek", "Korallok"]);

/**
 * Section 1/A of 1-termekadat-terkep.md names these as directly quotable
 * catalogue facts. Brand is deliberately absent: the same section marks it
 * as exceptional, so treating it as mandatory would manufacture failures.
 */
export const REQUIRED_FIELDS_FROM_RELIABILITY_MAP = [
  "sku",
  "name",
  "price.gross",
  "baseCategory",
] as const;

function nonBlank(value: unknown): boolean {
  return typeof value === "string"
    ? value.trim().length > 0
    : typeof value === "number";
}

function categoriesOf(
  product: CatalogProduct,
): Array<{ Type?: string; Name?: string }> {
  const category = product.Categories?.Category;
  return Array.isArray(category) ? category : category ? [category] : [];
}

export function baseCategory(product: CatalogProduct): string | null {
  const category = categoriesOf(product).find((item) => item.Type === "base");
  return category?.Name?.split("|")[0]?.trim() || null;
}

function hasGrossPrice(product: CatalogProduct): boolean {
  const price = product.Prices?.Price;
  const prices = Array.isArray(price) ? price : price ? [price] : [];
  return prices.some((item) => nonBlank(item.Gross));
}

export function missingRequiredFields(product: CatalogProduct): string[] {
  const missing: string[] = [];
  if (!nonBlank(product.Sku)) missing.push("sku");
  if (!nonBlank(product.Name)) missing.push("name");
  if (!hasGrossPrice(product)) missing.push("price.gross");
  if (!baseCategory(product)) missing.push("baseCategory");
  return missing;
}

export function isLivestock(product: CatalogProduct): boolean {
  const root = baseCategory(product);
  return root !== null && LIVESTOCK_ROOTS.has(root);
}

function plainText(product: CatalogProduct): string {
  return [product.Name, product.Description?.Short, product.Description?.Long]
    .filter(nonBlank)
    .join(" ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * This is intentionally a catalogue-name classifier, not a taxonomy lookup.
 * It accepts a Latin genus followed by a lower-case epithet; `sp.`/`spp.` and
 * a genus on its own stay genus-level. The known placeholder is not biology.
 */
export function classifyLivestockName(name: string | undefined): NameLevel {
  if (!name?.trim()) return "INVALID_RECORD";
  if (name.trim() === "Aalap_Hal") return "INVALID_RECORD";

  const normalized = name.replace(/[()/,]/g, " ").replace(/\s+/g, " ");
  const tokens = normalized.match(/[A-Za-z][A-Za-z.-]*/g) ?? [];
  for (let index = 0; index < tokens.length; index += 1) {
    const genus = tokens[index]!;
    if (!/^[A-Z][a-z]{2,}$/.test(genus)) continue;
    const next = tokens[index + 1];
    if (next && /^spp?\.?$/i.test(next)) return "GENUS";
    // These are catalogue descriptors, not Latin epithets. The measured
    // controls explicitly include Zoanthus mix and Acropora/Favites frag.
    if (next && /^(mix|frag)$/i.test(next)) return "GENUS";
    // `spec.` is the catalogue's spelling in the Pachycerianthus rows. It is
    // not the `sp.`/`spp.` abbreviation that marks an unspecified genus.
    if (next && /^spec\.?$/i.test(next)) return "SPECIES";
    if (next && /^[a-z][a-z-]{1,}$/.test(next)) return "SPECIES";
    return "GENUS";
  }
  return "NON_SCIENTIFIC";
}

function result(
  pattern: ForbiddenClaimPattern,
  status: ForbiddenClaimStatus,
  reason: string,
): ForbiddenClaimResult {
  return { pattern, status, reason };
}

/**
 * Each check below corresponds to a named prohibition in sections 4–5 of the
 * map. It does not use a generic "bad words" search: a match must satisfy the
 * complete condition of that named claim. Rules without row-local evidence
 * remain explicit as unrecognizable.
 */
export function analyzeForbiddenClaims(
  product: CatalogProduct,
  nameLevel: NameLevel | null,
): ForbiddenClaimResult[] {
  const text = plainText(product).toLocaleLowerCase("hu-HU");
  const livestock = isLivestock(product);
  if (!livestock) return [];

  const results: ForbiddenClaimResult[] = [];
  const beginnerRecommendation =
    /(?:kezd[őo]k?(?:nek|nek is)?|kezd[őo] akvarist)/.test(text) &&
    /(?:ajánl|könny[űu]|egyszer[űu])/.test(text);
  results.push(
    result(
      "BEGINNER_DIFFICULTY_FROM_GENUS",
      nameLevel === "GENUS" && beginnerRecommendation ? "detected" : "clear",
      nameLevel === "GENUS" && beginnerRecommendation
        ? "A genus-level name mellett kezdőknek szóló nehézségi ajánlás szerepel."
        : "Nincs genus-szinthez kötött, kezdőknek szóló nehézségi ajánlás.",
    ),
  );

  const azooxanthellate = /\b(?:tubastrea|napkorall)\b/.test(text);
  const feedingClaim =
    /(?:nem szükséges etetni|nem kell etetni|fényből él|fény táplálja)/.test(
      text,
    );
  results.push(
    result(
      "AZOOXANTHELLATE_FEEDING",
      azooxanthellate && feedingClaim ? "detected" : "clear",
      azooxanthellate && feedingClaim
        ? "Napkorall/Tubastrea mellett etetésről állít a szöveg."
        : "Nincs felismerhető, azooxanthellate fajhoz kötött etetési állítás.",
    ),
  );

  const sps = /\bacropora\b|\bsps\b/.test(text);
  const husbandry = /\b(?:par|áramlás|világítás|fényigény)\b/.test(text);
  results.push(
    result(
      "SPS_SPECIES_SPECIFIC_HUSBANDRY",
      sps && nameLevel === "SPECIES" && husbandry ? "detected" : "clear",
      sps && nameLevel === "SPECIES" && husbandry
        ? "SPS fajnév mellett fajspecifikusnak látszó tartási adat szerepel."
        : "Nincs felismerhető, SPS fajnévhez kötött tartási állítás.",
    ),
  );

  results.push(
    result(
      "PAIRWISE_COMPATIBILITY",
      "unrecognizable",
      "Egy terméksorból nem állapítható meg megbízhatóan két konkrét faj párkapcsolata.",
    ),
    result(
      "GENUS_DERIVED_WATER_PARAMETERS",
      "unrecognizable",
      "A terméksor nem hordozza a vízparaméter-állítás faj- vagy nemzetségszintű forrását.",
    ),
    result(
      "UNAPPROVED_LIVE_DELIVERY_PROMISE",
      "unrecognizable",
      "A terméksor nem tartalmazza Balázs jóváhagyási állapotát a szállítási ígérethez.",
    ),
    result(
      "SPS_SPECIES_SPECIFIC_GROWTH_OR_COMPATIBILITY",
      "unrecognizable",
      "A terméksor alapján nem dönthető el megbízhatóan, hogy növekedési vagy társíthatósági állítás fajspecifikus-e.",
    ),
  );
  return results;
}

export function analyzeProduct(
  product: CatalogProduct,
): ProductCompletenessResult {
  const nameLevel = isLivestock(product)
    ? classifyLivestockName(product.Name)
    : null;
  return {
    id: product.Id ?? null,
    sku: product.Sku?.trim() || null,
    missingRequiredFields: missingRequiredFields(product),
    forbiddenClaims: analyzeForbiddenClaims(product, nameLevel),
    nameLevel,
  };
}

export function summarizeLivestockNameLevels(
  results: ProductCompletenessResult[],
) {
  return results.reduce(
    (summary, item) => {
      if (item.nameLevel === "SPECIES") summary.species += 1;
      if (item.nameLevel === "GENUS") summary.genus += 1;
      if (item.nameLevel === "NON_SCIENTIFIC") summary.nonScientific += 1;
      if (item.nameLevel === "INVALID_RECORD") summary.invalidRecord += 1;
      return summary;
    },
    { species: 0, genus: 0, nonScientific: 0, invalidRecord: 0 },
  );
}
