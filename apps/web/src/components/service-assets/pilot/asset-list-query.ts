/**
 * AZ ESZKÖZLISTA KÉRÉSE AZ URL-BŐL, EGY HELYEN. A lista és az adatlap
 * Előző/Következő gombja ugyanebből kérdez: a szomszéd csak akkor jó, ha
 * pontosan azt a halmazt lépkedi végig, amit a lista mutatott, tehát az
 * alapértékek (a "Beépített" fül, a lap és a lapméret) sem térhetnek el.
 */
export const ASSET_LIST_PATH = "/szerviz/eszkozok";
export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = String(PAGE_SIZES[0]);

/**
 * A LISTA RENDEZHETŐ OSZLOPAI (Balázs kérése, kártya 2f6369a4): a táblázat oszlop-azonosítója -> a szerver rendezési mezeje
 * (`ASSET_LIST_SORTS`: név, állapot, elhelyezés). A "Hierarchia" és a "Gyártó és modell" nem egy adat, hanem több összerakva, a
 * "Kategória" és a "Helyszín" pedig nem szerepel a szerver fehér listáján: azok rendezése külön döntés. Az állapot a SÉMA
 * sorrendjében rendez (üzemel, tartalék, javítás alatt, üzemen kívül, kivezetve), nem a felirat betűrendjében.
 */
export const ASSET_SORT_COLUMNS = {
  asset: "name",
  partner: "placement",
  status: "status",
} as const;

export function assetListQuery(params: URLSearchParams): URLSearchParams {
  const value = new URLSearchParams(params.toString());
  // a rendezés CSAK ismert mezőre és érvényes irányra marad a kérésben: egy régi vagy kézzel írt link ne törje el a listát 400-zal.
  // A mező irány NÉLKÜL is érvényes (a szerver növekvőnek veszi, és a régi lista így is írta), ezért az irány külön dől el.
  const sort = params.get("sort");
  const direction = params.get("direction");
  value.delete("sort");
  value.delete("direction");
  if (sort && (Object.values(ASSET_SORT_COLUMNS) as string[]).includes(sort)) {
    value.set("sort", sort);
    if (direction === "asc" || direction === "desc")
      value.set("direction", direction);
  }
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
