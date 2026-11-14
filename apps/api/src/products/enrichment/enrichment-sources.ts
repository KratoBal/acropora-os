import type { ProductEvidenceSourceType } from "@acropora/types";

/**
 * THE FOUR SOURCE KINDS OF THE FIRST LIVE ROUND (PD-013, Balázs 2026-10-02
 * 20:24 UTC: "beszallitoi, gyártói oldal, bulk reef supply,
 * marine-aquatics.eu oldalakról első körben").
 *
 * A page is read only when its host belongs to its kind:
 *
 *   BULK_REEF_SUPPLY   bulkreefsupply.com (and its subdomains)
 *   MARINE_AQUATICS    marine-aquatics.eu (and its subdomains)
 *   OLIBETTA           olibetta.hu (and its subdomains); added 2026-10-03 for
 *                      its barcode and data, not its text (Balázs 14:09 UTC,
 *                      "Mehet"). It is a shop, not our supplier.
 *   MANUFACTURER       the brand's own site (`Brand.websiteUrl`) or the
 *                      manufacturer link UNAS holds for the product
 *                      (`UnasProductSnapshot.manufacturerUrl`)
 *   SUPPLIER           the named supplier's own site (`Supplier.websiteUrl`)
 *
 * Anything else is REFUSED and never requested. Our own data (OS, UNAS) is not
 * a source here: it is the current value, and it cannot verify itself.
 *
 * Provenance class (owner, 2026-10-02): the retailers count as supplier
 * pages, so like a supplier's own page they can verify a value; a
 * manufacturer's page is the manufacturer page of the V0 model.
 */
export const ENRICHMENT_SOURCE_KINDS = [
  "MANUFACTURER",
  "SUPPLIER",
  "BULK_REEF_SUPPLY",
  "MARINE_AQUATICS",
  "OLIBETTA",
] as const;
export type EnrichmentSourceKind = (typeof ENRICHMENT_SOURCE_KINDS)[number];

export function isEnrichmentSourceKind(
  value: unknown,
): value is EnrichmentSourceKind {
  return (ENRICHMENT_SOURCE_KINDS as readonly unknown[]).includes(value);
}

/** The retailers' own domains, fixed. */
export const RETAILER_DOMAINS: Readonly<
  Record<"BULK_REEF_SUPPLY" | "MARINE_AQUATICS" | "OLIBETTA", string>
> = {
  BULK_REEF_SUPPLY: "bulkreefsupply.com",
  MARINE_AQUATICS: "marine-aquatics.eu",
  OLIBETTA: "olibetta.hu",
};

export const SOURCE_EVIDENCE_TYPE: Readonly<
  Record<EnrichmentSourceKind, ProductEvidenceSourceType>
> = {
  MANUFACTURER: "MANUFACTURER_PAGE",
  SUPPLIER: "SUPPLIER_PAGE",
  BULK_REEF_SUPPLY: "SUPPLIER_PAGE",
  MARINE_AQUATICS: "SUPPLIER_PAGE",
  OLIBETTA: "SUPPLIER_PAGE",
};

/**
 * ONE PAGE, ONE KEY, for both page checks (barracuda, #1821): the run reads a
 * final page once per product, and the auto-accept rule sends a page another
 * product shares to a person. Without fragment, query, case and trailing
 * slash: a UNAS link with `?utm_source=` is the clean page (#1810). A wider
 * match is the safe side in both: one read fewer, or one more for a person.
 */
export function pageKey(url: string): string {
  return url.split("#")[0]!.split("?")[0]!.toLowerCase().replace(/\/+$/, "");
}

/**
 * A site's base domain from a URL or bare host: lower case, no `www.`.
 * `null` for anything that is not a plain public http(s) host.
 */
export function baseDomainOf(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const text = value.trim();
  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`,
    );
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || isIpLiteral(host)) return null;
  return host.replace(/^www\./, "");
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");
}

/** `host` is `base` itself or one of its subdomains. */
export function hostBelongsTo(host: string, base: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return h === base || h.endsWith(`.${base}`);
}

export type SourceRefusal =
  | "BAD_URL"
  | "NOT_HTTPS"
  | "HOST_NOT_ALLOWED"
  | "NO_MANUFACTURER_SITE"
  | "NO_SUPPLIER_SITE";

/** What a product's manufacturer and supplier sites are, for the host rule. */
export interface SourceSites {
  /** Base domains of the manufacturer (brand website, UNAS link). */
  manufacturer: readonly string[];
  /** Base domain of the named supplier's website, if it has one. */
  supplier: string | null;
}

/**
 * May this URL be read as this kind of source? Only https, no credentials, no
 * non-default port, and the host must belong to the kind (see the header).
 */
export function sourceUrlProblem(
  kind: EnrichmentSourceKind,
  raw: string,
  sites: SourceSites,
): SourceRefusal | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "BAD_URL";
  }
  if (url.protocol !== "https:") return "NOT_HTTPS";
  if (url.username || url.password || url.port) return "BAD_URL";
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || isIpLiteral(host)) return "BAD_URL";
  switch (kind) {
    case "BULK_REEF_SUPPLY":
    case "MARINE_AQUATICS":
    case "OLIBETTA":
      return hostBelongsTo(host, RETAILER_DOMAINS[kind])
        ? null
        : "HOST_NOT_ALLOWED";
    case "MANUFACTURER":
      if (sites.manufacturer.length === 0) return "NO_MANUFACTURER_SITE";
      return sites.manufacturer.some((base) => hostBelongsTo(host, base))
        ? null
        : "HOST_NOT_ALLOWED";
    case "SUPPLIER":
      if (!sites.supplier) return "NO_SUPPLIER_SITE";
      return hostBelongsTo(host, sites.supplier) ? null : "HOST_NOT_ALLOWED";
  }
}

/**
 * THE MANUFACTURER'S SITES BY BRAND CATEGORY (Product Knowledge, acrobot
 * 35067): `Product.brandId` was empty across the catalogue, and the brand lived
 * in a UNAS category named after it; the brand field is filled since, and its
 * name is the second key (see below). The brand's own domains, taken from the
 * links the manufacturer's dosing pages are on (reeftrak, 2026-10-22). A
 * short list here, not the product master: the JEV does not write that.
 */
export const BRAND_CATEGORY_SITES: Readonly<Record<string, readonly string[]>> =
  {
    // Each line is a TRUST ANCHOR (barracuda, #1813): a page on it becomes a
    // MANUFACTURER_PAGE, which the AUTO_V1 rule accepts without a person, and
    // a reseller's page carries the product's EAN too. A domain goes here only
    // as the brand's own; the basis is written beside it.
    // Left out until verified: triton-reagents.de (linked from UNAS and
    // reeftrak, which shows someone linked there, not whose it is; its
    // Impressum was not reachable from here, 2026-10-22; on 2026-11-14 the
    // site served an expired certificate, so a run could not read it either).
    // A page there stays NO_MANUFACTURER_SITE unless UNAS links that product.
    "fauna marin": [
      "faunamarin.de", // the brand's own site, widely known; reeftrak links, 2026-10-22
      // the brand's own shop, where its product pages and doses stand: faunamarin.de's home page lists it
      // as "faunamarincorals.de", its end-customer shop, and the shop's footer names Fauna Marin GmbH as
      // its operator (both read through the fleet's quarantine reader, 2026-11-13; card 85c38ab1)
      "faunamarincorals.de",
    ],
    triton: ["triton.de"], // the brand's own site, widely known; reeftrak links, 2026-10-22
    "red sea": ["redseafish.com"], // the brand's own site, widely known; reeftrak links, 2026-10-22
    aquaforest: ["aquaforest.eu"], // the brand's own site, widely known; reeftrak links, 2026-10-22
    // the brand's own shop and site, as far as the page itself says (quarantine reader, 2026-11-14, read by
    // nautilus and again by barracuda): the footer reads "Modern Reef by Euro Corals"; the Impressum names
    // Euro Corals (Passauer Straße 12, Simbach am Inn, with its managing director) as the operator and gives
    // www.eurocorals.com as plain text; the word brand/Marke is not on it; not measured from eurocorals.com
    // back (not readable from here), so the tie is the page's own statement; its home page sells the brand's
    // own products. The brand is in the catalogue as a category ("Nyomelemek / Modern Reef") and a brand name.
    "modern reef": ["modernreef.eu"],
    // T4.4 pilot-20 (card 8639ac2a, task t-20261114-jev-megbizhato-domainek): the four brands whose products the run
    // left out as NO_MANUFACTURER_SITE. Each one's Impressum read through the fleet's quarantine reader, 2026-11-14:
    // Korallenzucht.de Vertriebs GmbH (Thomas and Regina Pohl, Ebersdorf b. Coburg), the maker of the Korallen-Zucht and
    // Pohl's line, runs the shop
    "korallen-zucht": ["korallen-zucht.de"],
    // Grotech GmbH (Ahorn, info@grotech.de) runs its own shop; it sells other brands too, which this line does not
    // reach: a domain here counts only for a product whose brand is Grotech
    grotech: ["grotech-shop.de"],
    // Blue Life USA, LLC (Woodland Hills, CA), its own site with its own product line
    "blue life": ["bluelifeusa.com"],
    // Tropic Marin AG (Hünenberg, CH) is responsible for the site; Dr. Biener GmbH (Wartenberg) makes the products
    "tropic marin": ["tropic-marin.com"],
    // Left out: Microbe-Lift. The pages the pilot used are on arka-biotech.de, the brand's European partner, not its
    // maker (Ecological Laboratories); a distributor's page is not a MANUFACTURER_PAGE.
  };

/**
 * The brand domains a product's category chains name: a category whose WHOLE
 * name is a listed brand. Two different brands give none: a product under
 * both cannot tell whose site is the manufacturer's.
 *
 * THE PRODUCT'S OWN BRAND COUNTS TOO (card 85c38ab1, 2026-11-14): the brand
 * field is filled on the test catalogue now, and a product whose category
 * chain names no brand (Fauna Marin Dino M under "Termékek") got
 * NO_MANUFACTURER_SITE. Its whole name, with the same "exactly one brand" rule:
 * a brand field naming one brand and a category naming another give none.
 */
export function brandSitesFromCategories(
  chains: readonly (readonly string[])[],
  brandName?: string | null,
): string[] {
  const brands = new Set<string>();
  for (const name of [...chains.flat(), brandName ?? ""]) {
    const key = name.trim().toLowerCase();
    if (Object.hasOwn(BRAND_CATEGORY_SITES, key)) brands.add(key);
  }
  return brands.size === 1 ? [...BRAND_CATEGORY_SITES[[...brands][0]!]!] : [];
}

/**
 * The manufacturer's base domains for a product: the brand's website, the
 * UNAS manufacturer link, and the brand category's listed domains. A link
 * that points at one of the retailers is not a manufacturer site, so it is
 * left out.
 */
export function manufacturerSites(
  brandWebsiteUrl: string | null | undefined,
  unasManufacturerUrl: string | null | undefined,
  categorySites: readonly string[] = [],
): string[] {
  const retailers = Object.values(RETAILER_DOMAINS);
  return [
    ...new Set(
      [
        baseDomainOf(brandWebsiteUrl),
        baseDomainOf(unasManufacturerUrl),
        ...categorySites.map((site) => baseDomainOf(site)),
      ]
        .filter((base): base is string => base !== null)
        .filter((base) => !retailers.some((r) => hostBelongsTo(base, r))),
    ),
  ];
}
