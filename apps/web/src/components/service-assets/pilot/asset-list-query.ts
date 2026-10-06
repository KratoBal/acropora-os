/**
 * AZ ESZKÖZLISTA KÉRÉSE AZ URL-BŐL, EGY HELYEN. A lista és az adatlap
 * Előző/Következő gombja ugyanebből kérdez: a szomszéd csak akkor jó, ha
 * pontosan azt a halmazt lépkedi végig, amit a lista mutatott, tehát az
 * alapértékek (a "Beépített" fül, a lap és a lapméret) sem térhetnek el.
 */
export const ASSET_LIST_PATH = "/szerviz/eszkozok";
export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = String(PAGE_SIZES[0]);

export function assetListQuery(params: URLSearchParams): URLSearchParams {
  const value = new URLSearchParams(params.toString());
  if (!value.has("page")) value.set("page", "1");
  if (!value.has("pageSize")) value.set("pageSize", DEFAULT_PAGE_SIZE);
  if (!value.has("status")) value.set("status", "IN_PLACE");
  return value;
}

/** A lista címéből (a nyom legutóbbi lista-látogatásából) a lista kérése. */
export function assetListQueryFromHref(href: string): URLSearchParams {
  const cut = href.indexOf("?");
  return assetListQuery(
    new URLSearchParams(cut === -1 ? "" : href.slice(cut + 1)),
  );
}

/**
 * VAN-E KÉZIKÖNYVE (kártya 1277394e): a lista `document` és `documentType`
 * paramétere. A kettő együtt áll vagy együtt törlődik (egy magában maradt
 * `documentType` nem szűr, csak zavar), és a szűrés az első lapra visz.
 */
export function withManualFilter(
  params: URLSearchParams,
  value: string,
): URLSearchParams {
  const next = new URLSearchParams(params.toString());
  next.delete("document");
  next.delete("documentType");
  if (value === "with" || value === "without") {
    next.set("document", value);
    next.set("documentType", "MANUAL");
  }
  next.set("page", "1");
  return next;
}

/** A Kézikönyv-szűrő mai állása az URL-ből: "", "with" vagy "without". */
export function manualFilterOf(params: URLSearchParams): string {
  const document = params.get("document");
  return params.get("documentType") === "MANUAL" &&
    (document === "with" || document === "without")
    ? document
    : "";
}
