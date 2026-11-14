import { normalizeBrandName } from "../brands/brands.repository.js";

/**
 * THE BRAND FROM AN EXPLICIT LIST (catalog action `brand-from-list`; card 16d06aea, acrobot 52178).
 *
 * `brand-from-name` only sees a name prefix or an alias. A product family (Radion = Ecotech) or an SKU-prefix suggestion
 * needs the brand to come from someone's decision, so this action takes the decision as INPUT: a list of
 * `{ productId, brandId }` (an existing brand) or `{ productId, newBrandName }` (a brand to create, or to find if it
 * already exists under that name or alias). The action never guesses: what is not on the list is not touched.
 *
 * THE RULES, each one a thing that went wrong or could:
 *  - A product that already has a brand is counted and named, never written (the same rule as `brand-from-name`).
 *  - The plan is the dry run: an apply is accepted only after a plan of the SAME list, and it writes that list, not a
 *    list sent with the apply.
 *  - A bad item (unknown product, unknown or inactive brand, the shop's own brand, a product twice) makes the plan FAIL,
 *    so an apply cannot be confirmed from it: a wrong line in a hand-made list is more likely a mistake than a choice.
 *  - "Acropora" is the shop's own brand and a decision of the owner (acrobot 52178): this action refuses it, by id and by
 *    name, whatever the list says.
 */
export const BRAND_LIST_MAX_ITEMS = 1000;

/** The shop's own brand, by its normalized name. A brand that normalizes to this is never assigned by a list. */
export const OWN_BRAND_NORMALIZED = normalizeBrandName("Acropora");

export type BrandListItem =
  | { productId: string; brandId: string; newBrandName?: undefined }
  | { productId: string; newBrandName: string; brandId?: undefined };

export interface BrandListInput {
  items: BrandListItem[];
}

/** A list the request body cannot be turned into; the message is for the person who wrote the list. */
export class BrandListInputError extends Error {}

const MAX_NAME_LENGTH = 120;
const MAX_ID_LENGTH = 64;

function text(value: unknown, what: string, index: number, max: number) {
  if (typeof value !== "string" || value.trim() === "")
    throw new BrandListInputError(
      `A(z) ${index + 1}. tételnél hiányzik: ${what}.`,
    );
  const trimmed = value.trim();
  if (trimmed.length > max)
    throw new BrandListInputError(
      `A(z) ${index + 1}. tételnél túl hosszú: ${what} (legfeljebb ${max} karakter).`,
    );
  return trimmed;
}

/**
 * The request body as a list. Strict on purpose: an unknown field, a missing or a doubled choice, a product twice and
 * a list that is empty or too long all stop here, before a run starts.
 */
export function parseBrandListInput(body: unknown): BrandListInput {
  const items =
    body && typeof body === "object"
      ? (body as { items?: unknown }).items
      : undefined;
  if (!Array.isArray(items) || items.length === 0)
    throw new BrandListInputError(
      "A bemenet: { items: [ { productId, brandId } vagy { productId, newBrandName }, ... ] }, legalább egy tétellel.",
    );
  if (items.length > BRAND_LIST_MAX_ITEMS)
    throw new BrandListInputError(
      `A lista legfeljebb ${BRAND_LIST_MAX_ITEMS} tételes (ennyi van: ${items.length}). Bontsd több futásra.`,
    );
  const seen = new Set<string>();
  const parsed: BrandListItem[] = items.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new BrandListInputError(`A(z) ${index + 1}. tétel nem objektum.`);
    const record = raw as Record<string, unknown>;
    const unknown = Object.keys(record).filter(
      (key) => !["productId", "brandId", "newBrandName"].includes(key),
    );
    if (unknown.length)
      throw new BrandListInputError(
        `A(z) ${index + 1}. tételben ismeretlen mező van: ${unknown.join(", ")}.`,
      );
    const productId = text(record.productId, "productId", index, MAX_ID_LENGTH);
    const hasBrandId = record.brandId !== undefined && record.brandId !== null;
    const hasNewName =
      record.newBrandName !== undefined && record.newBrandName !== null;
    if (hasBrandId === hasNewName)
      throw new BrandListInputError(
        `A(z) ${index + 1}. tételnél pontosan az egyik kell: brandId (létező márka) vagy newBrandName (új márka neve).`,
      );
    if (seen.has(productId))
      throw new BrandListInputError(
        `A(z) ${index + 1}. tétel terméke (${productId}) már szerepel a listán. Egy terméknek egy márkája lehet.`,
      );
    seen.add(productId);
    return hasBrandId
      ? {
          productId,
          brandId: text(record.brandId, "brandId", index, MAX_ID_LENGTH),
        }
      : {
          productId,
          newBrandName: text(
            record.newBrandName,
            "newBrandName",
            index,
            MAX_NAME_LENGTH,
          ),
        };
  });
  return { items: parsed };
}

export interface ListProduct {
  id: string;
  name: string;
  brandId: string | null;
}

export interface ListBrand {
  id: string;
  name: string;
  normalizedName: string;
  isActive: boolean;
  /** Normalized aliases: a name that is an alias of a brand is that brand. */
  normalizedAliases: readonly string[];
}

export type BrandListRow =
  | {
      kind: "ASSIGN";
      productId: string;
      productName: string;
      brandId: string;
      brandName: string;
      /** `existing`: the list named the brand's id; `found`: a name that was already a brand; `new`: created first. */
      via: "existing" | "found";
    }
  | {
      kind: "ASSIGN_NEW";
      productId: string;
      productName: string;
      newBrandName: string;
      normalizedName: string;
    }
  | {
      kind: "HAS_BRAND";
      productId: string;
      productName: string;
      brandName: string;
    }
  | { kind: "ERROR"; productId: string; productName: string; reason: string };

export interface BrandListPlan {
  rows: BrandListRow[];
  /** The brands to create: one per distinct normalized name, named as it was first written. */
  newBrands: { name: string; normalizedName: string }[];
}

/**
 * The list against what exists. Pure: the products and brands come in as rows. A product the list names but the
 * database does not have is an ERROR row (its name is empty), not a skipped line.
 */
export function planBrandList(
  input: BrandListInput,
  products: readonly ListProduct[],
  brands: readonly ListBrand[],
): BrandListPlan {
  const productById = new Map(products.map((p) => [p.id, p]));
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const brandByName = new Map<string, ListBrand[]>();
  for (const brand of brands)
    for (const key of [brand.normalizedName, ...brand.normalizedAliases]) {
      const list = brandByName.get(key) ?? [];
      if (!list.includes(brand)) list.push(brand);
      brandByName.set(key, list);
    }
  const rows: BrandListRow[] = [];
  const newBrands = new Map<string, { name: string; normalizedName: string }>();
  for (const item of input.items) {
    const product = productById.get(item.productId);
    if (!product) {
      rows.push({
        kind: "ERROR",
        productId: item.productId,
        productName: "",
        reason: "nincs ilyen termék",
      });
      continue;
    }
    const base = { productId: product.id, productName: product.name };
    if (product.brandId !== null) {
      rows.push({
        ...base,
        kind: "HAS_BRAND",
        brandName: brandById.get(product.brandId)?.name ?? product.brandId,
      });
      continue;
    }
    if (item.brandId !== undefined) {
      const brand = brandById.get(item.brandId);
      if (!brand)
        rows.push({
          ...base,
          kind: "ERROR",
          reason: `nincs ilyen márka: ${item.brandId}`,
        });
      else if (!brand.isActive)
        rows.push({
          ...base,
          kind: "ERROR",
          reason: `a márka nem aktív: ${brand.name}`,
        });
      else if (brand.normalizedName === OWN_BRAND_NORMALIZED)
        rows.push({
          ...base,
          kind: "ERROR",
          reason:
            "az Acropora a bolt saját márkája: tulajdonosi döntés, ez a művelet nem írja",
        });
      else
        rows.push({
          ...base,
          kind: "ASSIGN",
          brandId: brand.id,
          brandName: brand.name,
          via: "existing",
        });
      continue;
    }
    const normalized = normalizeBrandName(item.newBrandName);
    if (normalized === "") {
      rows.push({
        ...base,
        kind: "ERROR",
        reason: "a márka neve nem tartalmaz betűt vagy számot",
      });
      continue;
    }
    if (normalized === OWN_BRAND_NORMALIZED) {
      rows.push({
        ...base,
        kind: "ERROR",
        reason:
          "az Acropora a bolt saját márkája: tulajdonosi döntés, ez a művelet nem írja",
      });
      continue;
    }
    const found = brandByName.get(normalized) ?? [];
    if (found.length > 1) {
      rows.push({
        ...base,
        kind: "ERROR",
        reason: `a név két márkához illik: ${found.map((b) => b.name).join(" | ")}`,
      });
      continue;
    }
    const only = found[0];
    if (only) {
      if (!only.isActive)
        rows.push({
          ...base,
          kind: "ERROR",
          reason: `a névhez tartozó márka nem aktív: ${only.name}`,
        });
      else if (only.normalizedName === OWN_BRAND_NORMALIZED)
        rows.push({
          ...base,
          kind: "ERROR",
          reason:
            "az Acropora a bolt saját márkája: tulajdonosi döntés, ez a művelet nem írja",
        });
      else
        rows.push({
          ...base,
          kind: "ASSIGN",
          brandId: only.id,
          brandName: only.name,
          via: "found",
        });
      continue;
    }
    if (!newBrands.has(normalized))
      newBrands.set(normalized, {
        name: item.newBrandName,
        normalizedName: normalized,
      });
    rows.push({
      ...base,
      kind: "ASSIGN_NEW",
      newBrandName: newBrands.get(normalized)!.name,
      normalizedName: normalized,
    });
  }
  return { rows, newBrands: [...newBrands.values()] };
}

const line = (value: string) => value.replace(/[\t\r\n]+/g, " ");

export function brandListErrors(plan: BrandListPlan): number {
  return plan.rows.filter((row) => row.kind === "ERROR").length;
}

/** The plan as the run's output: the counts, then every item, one per line (tab-separated). */
export function describeBrandListPlan(plan: BrandListPlan): string {
  const count = (kind: BrandListRow["kind"]) =>
    plan.rows.filter((row) => row.kind === kind).length;
  return [
    "Márka a listából (csak üres márkájú termékre, csak a listán szereplőre):",
    `  tétel a listán: ${plan.rows.length}`,
    `  márkát kap (létező márka): ${count("ASSIGN")}`,
    `  márkát kap (új márka, előbb létrejön): ${count("ASSIGN_NEW")}`,
    `  létrejön új márka: ${plan.newBrands.length}`,
    `  már van márkája, nem érinti: ${count("HAS_BRAND")}`,
    `  HIBÁS tétel: ${count("ERROR")}`,
    "",
    ...plan.newBrands.map((b) => `ÚJ MÁRKA\t${line(b.name)}`),
    ...plan.rows.map((row) => {
      const head = `${row.productId}\t${line(row.productName)}`;
      switch (row.kind) {
        case "ASSIGN":
          return `MÁRKA\t${head}\t${line(row.brandName)}\t${row.via === "found" ? "névből megtalált" : "azonosítóval"}`;
        case "ASSIGN_NEW":
          return `ÚJ MÁRKÁVAL\t${head}\t${line(row.newBrandName)}`;
        case "HAS_BRAND":
          return `KIHAGYVA (van márkája)\t${head}\t${line(row.brandName)}`;
        case "ERROR":
          return `HIBA\t${head}\t${line(row.reason)}`;
      }
    }),
    "",
  ].join("\n");
}
