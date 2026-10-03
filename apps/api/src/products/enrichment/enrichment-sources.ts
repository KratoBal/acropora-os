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
 * The manufacturer's base domains for a product: the brand's website and the
 * UNAS manufacturer link. A link that points at one of the retailers is not a
 * manufacturer site, so it is left out.
 */
export function manufacturerSites(
  brandWebsiteUrl: string | null | undefined,
  unasManufacturerUrl: string | null | undefined,
): string[] {
  const retailers = Object.values(RETAILER_DOMAINS);
  return [
    ...new Set(
      [baseDomainOf(brandWebsiteUrl), baseDomainOf(unasManufacturerUrl)]
        .filter((base): base is string => base !== null)
        .filter((base) => !retailers.some((r) => hostBelongsTo(base, r))),
    ),
  ];
}
