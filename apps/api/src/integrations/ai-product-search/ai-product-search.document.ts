import {
  plainText,
  AI_PRODUCT_SEARCH_TEXT_VERSION,
} from "./ai-product-search.text.js";

/**
 * WHICH DESCRIPTION COUNTS, AND WHO SAYS SO.
 *
 * A product can carry two descriptions: our own, on `Product.description`, and
 * the mirrored one in the UNAS snapshot. The rule is ownership, not recency:
 *
 *     catalogAuthority = ACROPORA and our description is not empty -> "acropora"
 *     otherwise                                                    -> "unas"
 *
 * The answer SAYS which one it used. Without that a stored judgement about an
 * answer cannot be read back - "the description was wrong" means one thing if
 * it came from the shop and another if somebody edited it here - and a local
 * edit would have no visible effect at all.
 */
export type AiDescriptionSource = "acropora" | "unas";

export interface DescribableProduct {
  catalogAuthority: string | null;
  description: string | null;
  unasSnapshot: {
    descriptionShort: string | null;
    descriptionLong: string | null;
  } | null;
}

export interface ChosenDescription {
  source: AiDescriptionSource;
  short: string | null;
  long: string | null;
}

export function chooseDescription(
  product: DescribableProduct,
): ChosenDescription {
  const own = product.description?.trim();

  if (product.catalogAuthority === "ACROPORA" && own) {
    /**
     * Our own description is one text, not two. It goes into the SHORT slot
     * because that is the one every surface reads first, and leaving the long
     * one empty is a truthful answer to "is there a long description" - a copy
     * would claim two independent texts where one exists.
     */
    return { source: "acropora", short: plainText(own), long: null };
  }

  return {
    source: "unas",
    short: plainText(product.unasSnapshot?.descriptionShort),
    long: plainText(product.unasSnapshot?.descriptionLong),
  };
}

/**
 * The recipe that builds one search document.
 *
 * It travels with the row in `documentVersion`, so a rebuild in progress is
 * visible rather than guessed at: rows carrying the old number have not been
 * rebuilt yet. Change this when the bands below change, and not otherwise.
 */
export const AI_PRODUCT_SEARCH_DOCUMENT_VERSION = 1;

export interface DocumentSourceProduct extends DescribableProduct {
  id: string;
  name: string;
  isActive: boolean;
  mirrorState: string | null;
  brand: { name: string } | null;
  categories: Array<{ category: { name: string } }>;
  variants: Array<{ sku: string }>;
  unasSnapshot:
    (DescribableProduct["unasSnapshot"] & { parameters: unknown }) | null;
}

export interface BuiltDocument {
  productId: string;
  title: string;
  skus: string;
  facets: string;
  descriptionShort: string;
  descriptionLong: string;
  parameters: string;
  isSearchable: boolean;
  documentVersion: number;
}

/**
 * Flattens the structured parameter block into searchable words.
 *
 * Kept deliberately dumb: it takes names and values and drops the structure.
 * The parameters sit in the LOWEST weight band, so what matters here is that
 * the words exist at all, not that their shape survives.
 */
function parameterWords(value: unknown): string {
  if (value === null || value === undefined) return "";

  const seen: string[] = [];

  const walk = (node: unknown): void => {
    if (node === null || node === undefined) return;
    if (typeof node === "string" || typeof node === "number") {
      seen.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === "object") {
      Object.entries(node as Record<string, unknown>).forEach(([key, item]) => {
        seen.push(key);
        walk(item);
      });
    }
  };

  walk(value);

  return seen.join(" ").slice(0, 20000);
}

export function buildDocument(product: DocumentSourceProduct): BuiltDocument {
  const chosen = chooseDescription(product);

  return {
    productId: product.id,
    title: product.name,
    skus: product.variants.map((variant) => variant.sku).join(" "),
    facets: [
      product.brand?.name ?? "",
      ...product.categories.map((entry) => entry.category.name),
    ]
      .filter((value) => value.length > 0)
      .join(" "),
    descriptionShort: chosen.short ?? "",
    descriptionLong: chosen.long ?? "",
    parameters: parameterWords(product.unasSnapshot?.parameters),
    /**
     * The row survives a product going away; only this flag drops.
     *
     * Two separate statements have to hold: the product is active FOR US, and
     * it has not gone missing from the source it is mirrored from. A search
     * hit is an implicit "we have this", so both are required - and a deleted
     * product keeps its row, because "we used to sell this" is knowledge
     * worth keeping.
     *
     * THE TEST IS "NOT MISSING", NOT "IS ACTIVE", and the difference is a
     * whole class of products. `mirrorState` is NULL for anything created
     * here (`origin = LOCAL`), because there is no source to mirror. Written
     * as `=== "ACTIVE"` this flag would be false for every locally created
     * product, and the search would silently answer only about the mirrored
     * catalogue - with every test green. CONFLICT stays searchable on
     * purpose: the data is disputed, but "we have this" is still true.
     */
    isSearchable: product.isActive && product.mirrorState !== "MISSING",
    documentVersion: AI_PRODUCT_SEARCH_DOCUMENT_VERSION,
  };
}

/** What the document was built from, for the answer to declare. */
export const AI_PRODUCT_SEARCH_RECIPE = {
  document: AI_PRODUCT_SEARCH_DOCUMENT_VERSION,
  text: AI_PRODUCT_SEARCH_TEXT_VERSION,
} as const;
