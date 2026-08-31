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
 * WHERE THE PARAMETERS COME FROM, AND WHY AN EMPTY BAND IS AN ANSWER.
 *
 * The parameters band was built from `unasSnapshot.parameters` for every
 * product, with no branch on ownership - three lines below a description that
 * has had that branch all along. For a product we have taken over, the snapshot
 * is FROZEN: the import no longer writes it, and what it holds is whatever the
 * shop said on the day we took the product. Feeding that into search as current
 * truth is the wrong direction, and it is the case the brief names.
 *
 * ACROPORA-owned therefore reads NOTHING here, and that is deliberate: there is
 * no Acropora-side parameter source to read. Measured 2026-08-31: 84 models in
 * the schema, none named Attribute or Parameter; `ProductExtension` holds
 * purchasing and stock data, not catalogue parameters; `ProductDatasheet` is
 * structured but has no write path, so it is empty everywhere.
 *
 * AND THE EMPTY MUST NOT BE SILENT, which is the whole point of the source. An
 * unmarked empty band says "this product has no parameters". The source says
 * "we have not built the place they would come from yet". A reader acts
 * differently on those two, and only one of them is true.
 */
export type AiParameterSource = "unas" | "none";

export interface ChosenParameters {
  source: AiParameterSource;
  /** The raw payload for a caller that shows it; null when there is no source. */
  value: unknown;
  /** The searchable text; empty when there is no source. */
  words: string;
}

export function chooseParameters(
  product: Pick<DescribableProduct, "catalogAuthority"> & {
    unasSnapshot: { parameters?: unknown } | null;
  },
): ChosenParameters {
  if (product.catalogAuthority === "ACROPORA") {
    return { source: "none", value: null, words: "" };
  }

  const value = product.unasSnapshot?.parameters ?? null;

  return { source: "unas", value, words: parameterWords(value) };
}

/**
 * The recipe that builds one search document.
 *
 * It travels with the row in `documentVersion`, so a rebuild in progress is
 * visible rather than guessed at: rows carrying the old number have not been
 * rebuilt yet. Change this when the bands below change, and not otherwise.
 */
export const AI_PRODUCT_SEARCH_DOCUMENT_VERSION = 2;

export interface DocumentSourceProduct extends DescribableProduct {
  id: string;
  name: string;
  isActive: boolean;
  mirrorState: string | null;
  brand: { name: string } | null;
  categories: Array<{ category: { name: string } }>;
  /**
   * Every article number a person might type. They live on the VARIANT, and
   * they are not interchangeable: our own SKU, the maker's part number, the
   * barcode on the box, and what each supplier calls the same thing on their
   * own invoice. A customer service call quotes whichever one the caller is
   * holding.
   */
  variants: Array<{
    sku: string;
    manufacturerPartNumber: string | null;
    barcodes: Array<{ code: string }>;
    supplierProducts: Array<{ supplierSku: string }>;
  }>;
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

/**
 * EVERY ARTICLE NUMBER IN ONE A-WEIGHT BAND, AND WHY THEY BELONG TOGETHER.
 *
 * The four kinds answer the same question - "which product is this?" - and a
 * caller quotes whichever one is in front of them: the barcode on the box, the
 * number on the maker's datasheet, the line on a supplier invoice, or our own
 * SKU. Splitting them across weights would rank one holder of the same fact
 * above another for no reason anyone could state.
 *
 * DEDUPLICATED, and not for tidiness: the same string legitimately appears as
 * both a supplier SKU and our own, and a repeat raises that product's rank for
 * a term without any new information. Order follows the variants, so a rebuild
 * of an unchanged product produces the same text.
 *
 * NOTHING HERE IS AUTHORITY-SENSITIVE. These are our own columns, written by
 * our own paths, and they say nothing about the UNAS snapshot - which is why
 * they are the identifiers that CAN be added today.
 */
export function collectArticleNumbers(
  variants: DocumentSourceProduct["variants"],
): string {
  const seen = new Set<string>();

  for (const variant of variants) {
    const candidates = [
      variant.sku,
      variant.manufacturerPartNumber,
      ...variant.barcodes.map((barcode) => barcode.code),
      ...variant.supplierProducts.map((entry) => entry.supplierSku),
    ];

    for (const candidate of candidates) {
      const value = candidate?.trim();
      if (value) seen.add(value);
    }
  }

  return [...seen].join(" ");
}

export function buildDocument(product: DocumentSourceProduct): BuiltDocument {
  const chosen = chooseDescription(product);
  const parameters = chooseParameters(product);

  return {
    productId: product.id,
    title: product.name,
    skus: collectArticleNumbers(product.variants),
    facets: [
      product.brand?.name ?? "",
      ...product.categories.map((entry) => entry.category.name),
    ]
      .filter((value) => value.length > 0)
      .join(" "),
    descriptionShort: chosen.short ?? "",
    descriptionLong: chosen.long ?? "",
    parameters: parameters.words,
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
