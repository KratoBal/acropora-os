/**
 * THE BRAND FROM THE PRODUCT'S NAME, FOR A PRODUCT WITH NONE (catalog action `brand-from-name`; acrobot 51093, 51095).
 *
 * Measured on the test OS (2026-11-14): 1236 of 1919 products have no brand, and the brand backfill from the stored UNAS
 * snapshot reaches only 2 of them (the UNAS `brand` parameter is empty there too). For 646 the name starts with exactly
 * one of the brands that exist; most of these products are UNAS-managed, where the product form answers 409, so the
 * brand goes in through this one action, one rule, one log (the run's output).
 *
 * THE RULE, the same the measurement used, from this one function: the brand is the name's first 1-4 WHOLE words,
 * joined with or without spaces, compared with a brand's name without accents, case, punctuation or spaces ("REDSEA - …"
 * and "Red Sea …" are RedSea; "ATI" is not "Atisonic"). Exactly one brand, or none: two brands that fit give no brand.
 * An active brand's ALIASES count like its name (acrobot 51098: "Jebao" and "Jecod" are aliases of one brand, and without
 * them 24 products stay out); a brand fits once however many of its names fit.
 */
export const BRAND_NAME_WORDS = 4;

export interface NameBrand {
  id: string;
  name: string;
  /** The brand's aliases, as written (`BrandAlias.alias`). */
  aliases?: readonly string[];
}

export type NameMatch =
  | { kind: "ONE"; brand: NameBrand }
  | { kind: "MANY"; brands: NameBrand[] }
  | { kind: "NONE" };

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function brandFromName(
  name: string,
  brands: readonly NameBrand[],
): NameMatch {
  const words = fold(name).split(" ").filter(Boolean);
  const heads = new Set(
    Array.from({ length: BRAND_NAME_WORDS }, (_, i) =>
      words.slice(0, i + 1).join(""),
    ).filter(Boolean),
  );
  const hits = brands.filter((brand) =>
    [brand.name, ...(brand.aliases ?? [])].some((written) => {
      const compact = fold(written).replace(/ /g, "");
      return compact !== "" && heads.has(compact);
    }),
  );
  if (hits.length === 1) return { kind: "ONE", brand: hits[0]! };
  return hits.length > 1 ? { kind: "MANY", brands: hits } : { kind: "NONE" };
}

export interface BrandFromNameRow {
  productId: string;
  name: string;
  brandId: string | null;
}

export interface BrandFromNamePlan {
  assign: {
    productId: string;
    name: string;
    brandId: string;
    brandName: string;
  }[];
  ambiguous: { productId: string; name: string; brands: string[] }[];
  noMatch: number;
  hasBrand: number;
}

/** Only a product with no brand gets one; a product with a brand is counted, never touched. */
export function planBrandFromName(
  rows: readonly BrandFromNameRow[],
  brands: readonly NameBrand[],
): BrandFromNamePlan {
  const plan: BrandFromNamePlan = {
    assign: [],
    ambiguous: [],
    noMatch: 0,
    hasBrand: 0,
  };
  for (const row of rows) {
    if (row.brandId !== null) {
      plan.hasBrand += 1;
      continue;
    }
    const match = brandFromName(row.name, brands);
    if (match.kind === "ONE")
      plan.assign.push({
        productId: row.productId,
        name: row.name,
        brandId: match.brand.id,
        brandName: match.brand.name,
      });
    else if (match.kind === "MANY")
      plan.ambiguous.push({
        productId: row.productId,
        name: row.name,
        brands: match.brands.map((b) => b.name),
      });
    else plan.noMatch += 1;
  }
  return plan;
}

const line = (value: string) => value.replace(/[\t\r\n]+/g, " ");

/** The plan as the run's output: the counts, the count per brand, and every product it would write, one per line. */
export function describeBrandFromNamePlan(plan: BrandFromNamePlan): string {
  const perBrand = new Map<string, number>();
  for (const a of plan.assign)
    perBrand.set(a.brandName, (perBrand.get(a.brandName) ?? 0) + 1);
  return [
    `Márka a névből (csak üres márkájú termékre, csak létező márkával):`,
    `  márkát kap: ${plan.assign.length}`,
    `  két márka is illik, nem kap: ${plan.ambiguous.length}`,
    `  a név elején nincs létező márka: ${plan.noMatch}`,
    `  már van márkája, nem érinti: ${plan.hasBrand}`,
    `Márkánként: ${
      [...perBrand]
        .sort((a, b) => b[1] - a[1])
        .map(([name, n]) => `${name}=${n}`)
        .join(", ") || "-"
    }`,
    "",
    ...plan.assign.map(
      (a) => `MÁRKA\t${a.productId}\t${line(a.brandName)}\t${line(a.name)}`,
    ),
    ...plan.ambiguous.map(
      (a) =>
        `KÉT MÁRKA\t${a.productId}\t${line(a.brands.join(" | "))}\t${line(a.name)}`,
    ),
    "",
  ].join("\n");
}
