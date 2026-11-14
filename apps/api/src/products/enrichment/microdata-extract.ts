import type {
  EnrichedField,
  ExtractedValue,
  PageStatement,
} from "./page-extract.js";

/**
 * THE PRODUCT'S IDENTITY FROM SCHEMA.ORG MICRODATA, WHEN THE PAGE HAS NO
 * JSON-LD PRODUCT (Product Knowledge, card 85c38ab1). The Fauna Marin shop
 * (faunamarincorals.de) states its product as `itemscope
 * itemtype="https://schema.org/Product"` with `<meta itemprop="gtin13"
 * content>`, and no JSON-LD: the run read NO_STRUCTURED_DATA, the EAN was never
 * proven on the manufacturer's page, so the AUTO_V1 rule could take no dose
 * from it, not even a verified one (third Fauna Marin run, AMIN).
 *
 * Read like the JSON-LD path, and no more: the EAN (`gtin13`, `gtin`, `gtin14`,
 * `gtin12`, `gtin8`), the manufacturer part number (`mpn`, not the shop's own
 * `sku`), the name and the brand's name. A property counts only for the item
 * scope it stands in: a navigation list's 115 `name` spans are not the
 * product's. Several different products on one page give nothing.
 */
const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

interface Scope {
  type: string;
  props: Map<string, (string | Scope)[]>;
}

const attr = (attrs: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(
    attrs,
  );
  return m ? (m[1] ?? m[2] ?? "") : null;
};

const decode = (value: string) =>
  value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** Every item scope of the page, with the properties that stand directly in it. */
function scopesOf(html: string): Scope[] {
  const body = html.replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, " ");
  const all: Scope[] = [];
  const open: { tag: string; scope: Scope | null }[] = [];
  const current = () => {
    for (let i = open.length - 1; i >= 0; i--)
      if (open[i]!.scope) return open[i]!.scope;
    return null;
  };
  for (const m of body.matchAll(/<(\/?)([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const [whole, close, rawTag, attrs] = m;
    const tag = rawTag!.toLowerCase();
    if (close) {
      const at = open.map((e) => e.tag).lastIndexOf(tag);
      if (at >= 0) open.splice(at);
      continue;
    }
    const owner = current();
    const prop = attr(attrs!, "itemprop");
    let scope: Scope | null = null;
    if (/\bitemscope\b/i.test(attrs!)) {
      scope = {
        type: (attr(attrs!, "itemtype") ?? "")
          .replace(/^https?:\/\/schema\.org\//i, "")
          .trim(),
        props: new Map(),
      };
      all.push(scope);
    }
    if (prop && owner)
      for (const name of prop.split(/\s+/).filter(Boolean)) {
        const value =
          scope ??
          decode(
            attr(attrs!, "content") ??
              body.slice(m.index + whole.length).split("<", 1)[0]!,
          );
        if (value === "") continue;
        owner.props.set(name, [...(owner.props.get(name) ?? []), value]);
      }
    if (!VOID.has(tag) && !whole.endsWith("/>")) open.push({ tag, scope });
  }
  return all;
}

const first = (scope: Scope, name: string): string | null => {
  const value = scope.props.get(name)?.find((v) => typeof v === "string");
  return typeof value === "string" ? value : null;
};

const identity = (product: Scope) =>
  [
    first(product, "gtin13") ?? first(product, "gtin") ?? "",
    first(product, "mpn") ?? "",
    first(product, "sku") ?? "",
  ].join("|");

/** `null`: no microdata Product on the page, the JSON-LD path's note stands. */
export function extractMicrodataStatement(html: string): PageStatement | null {
  const products = scopesOf(html).filter((s) => s.type === "Product");
  if (products.length === 0) return null;
  if (new Set(products.map(identity)).size > 1)
    return { values: [], note: "AMBIGUOUS_PRODUCT" };
  const product = products[0]!;

  const values = new Map<EnrichedField, ExtractedValue>();
  const put = (field: EnrichedField, raw: string | null, where: string) => {
    if (!raw || values.has(field)) return;
    values.set(field, {
      field,
      raw: raw.slice(0, 200),
      excerpt: `microdata Product.${where} = ${JSON.stringify(raw.slice(0, 120))}`,
    });
  };
  for (const key of ["gtin13", "gtin", "gtin14", "gtin12", "gtin8"])
    put("ean", first(product, key), key);
  put("manufacturerSku", first(product, "mpn"), "mpn");
  put("title", first(product, "name"), "name");
  const brand = product.props.get("brand")?.[0];
  put(
    "brand",
    typeof brand === "string" ? brand : brand ? first(brand, "name") : null,
    "brand",
  );
  return {
    values: [...values.values()],
    note: values.size ? null : "NO_VALUES",
  };
}
