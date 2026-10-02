import type { ProductEnrichmentFieldKey } from "@acropora/types";

/**
 * WHAT A PAGE STATES ABOUT A PRODUCT, FROM ITS STRUCTURED DATA ONLY.
 *
 * The first round reads the schema.org `Product` a page publishes as JSON-LD
 * (`<script type="application/ld+json">`): the machine-readable statement the
 * shop itself makes. Free text, tables and prose are not read, so nothing is
 * inferred: a value is either stated in that block or not taken. Deterministic
 * parsing only (docs/jev/product-enrichment-v0.md, the Jev / deterministic
 * boundary).
 *
 * Each value keeps its raw text (the V0 reconciler normalises it) and an
 * excerpt saying exactly where it was, which is stored as evidence.
 */
export const ENRICHED_FIELDS = [
  "ean",
  "manufacturerSku",
  "brand",
  "title",
  "weight",
  "lengthMm",
  "widthMm",
  "heightMm",
  "volume",
  "capacity",
  "flowRate",
  "power",
  "voltage",
] as const satisfies readonly ProductEnrichmentFieldKey[];
export type EnrichedField = (typeof ENRICHED_FIELDS)[number];

export interface ExtractedValue {
  field: EnrichedField;
  raw: string;
  /** Where on the page: e.g. `ld+json Product.gtin13`. */
  excerpt: string;
}

export interface PageStatement {
  /** Values per field; at most one per field. */
  values: ExtractedValue[];
  /** Why nothing was taken, when nothing was. */
  note:
    | "NO_STRUCTURED_DATA"
    | "NO_PRODUCT"
    | "AMBIGUOUS_PRODUCT"
    | "NO_VALUES"
    | null;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const SCRIPT =
  /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** UN/CEFACT unit codes schema.org pages use, to the units the V0 parser reads. */
const UNIT_CODE: Readonly<Record<string, string>> = {
  KGM: "kg",
  GRM: "g",
  MMT: "mm",
  CMT: "cm",
  MTR: "m",
  LTR: "l",
  MLT: "ml",
  WTT: "W",
  KWT: "kW",
  VLT: "V",
};

/** Named properties (`additionalProperty`) we read, by name. */
const PROPERTY_FIELD: readonly [RegExp, EnrichedField][] = [
  [/flow|durchfluss|átfolyás|szállítóteljesítmény|förderleistung/i, "flowRate"],
  [
    /^(power|wattage|power consumption|teljesítmény|leistung|teljesítményfelvétel)$/i,
    "power",
  ],
  [/voltage|feszültség|spannung/i, "voltage"],
  [/^(volume|content|tartalom|inhalt|térfogat)$/i, "volume"],
  [/^(capacity|kapazität|űrtartalom|kapacitás)$/i, "capacity"],
];

function isObject(value: Json): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function types(node: { [key: string]: Json }): string[] {
  const t = node["@type"];
  return (Array.isArray(t) ? t : [t]).filter(
    (x): x is string => typeof x === "string",
  );
}

function collectProducts(value: Json, into: { [key: string]: Json }[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectProducts(item, into);
    return;
  }
  if (!isObject(value)) return;
  if (types(value).includes("Product")) into.push(value);
  if (value["@graph"] !== undefined) collectProducts(value["@graph"], into);
}

function text(value: Json | undefined): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** A schema.org QuantitativeValue (or a plain "1.2 kg" string) as raw text. */
function quantity(value: Json | undefined): string | null {
  const plain = text(value);
  if (plain) return plain;
  if (!isObject(value as Json)) return null;
  const node = value as { [key: string]: Json };
  const amount = text(node.value);
  if (!amount) return null;
  const code = text(node.unitCode);
  const unit = (code && UNIT_CODE[code.toUpperCase()]) ?? text(node.unitText);
  return unit ? `${amount} ${unit}` : amount;
}

function brandName(value: Json | undefined): string | null {
  if (Array.isArray(value)) return null;
  return (
    text(value) ??
    (isObject(value as Json)
      ? text((value as { [k: string]: Json }).name)
      : null)
  );
}

function identity(product: { [key: string]: Json }): string {
  return [
    text(product.gtin13) ?? text(product.gtin) ?? text(product.gtin14) ?? "",
    text(product.mpn) ?? "",
    text(product.sku) ?? "",
  ].join("|");
}

export function extractPageStatement(html: string): PageStatement {
  const blocks: Json[] = [];
  for (const match of html.matchAll(SCRIPT)) {
    try {
      blocks.push(JSON.parse(match[1]!.trim()) as Json);
    } catch {
      // a broken block states nothing
    }
  }
  if (blocks.length === 0) return { values: [], note: "NO_STRUCTURED_DATA" };
  const products: { [key: string]: Json }[] = [];
  for (const block of blocks) collectProducts(block, products);
  if (products.length === 0) return { values: [], note: "NO_PRODUCT" };
  // Several different products on one page (a listing, a bundle): nothing is
  // taken, because we cannot tell which one is ours.
  if (new Set(products.map(identity)).size > 1)
    return { values: [], note: "AMBIGUOUS_PRODUCT" };
  const product = products[0]!;

  const values = new Map<EnrichedField, ExtractedValue>();
  const put = (field: EnrichedField, raw: string | null, where: string) => {
    if (!raw || values.has(field)) return;
    values.set(field, {
      field,
      raw: raw.slice(0, 200),
      excerpt: `ld+json Product.${where} = ${JSON.stringify(raw.slice(0, 120))}`,
    });
  };

  for (const key of ["gtin13", "gtin", "gtin14", "gtin12", "gtin8"])
    put("ean", text(product[key]), key);
  put("manufacturerSku", text(product.mpn), "mpn");
  put("brand", brandName(product.brand), "brand");
  put("title", text(product.name), "name");
  put("weight", quantity(product.weight), "weight");
  put("lengthMm", quantity(product.depth), "depth");
  put("widthMm", quantity(product.width), "width");
  put("heightMm", quantity(product.height), "height");

  const properties = Array.isArray(product.additionalProperty)
    ? product.additionalProperty
    : [];
  for (const property of properties) {
    if (!isObject(property)) continue;
    const name = text(property.name);
    if (!name) continue;
    const field = PROPERTY_FIELD.find(([pattern]) => pattern.test(name))?.[1];
    if (field)
      put(
        field,
        quantity(property),
        `additionalProperty[${JSON.stringify(name)}]`,
      );
  }
  return {
    values: [...values.values()],
    note: values.size ? null : "NO_VALUES",
  };
}
