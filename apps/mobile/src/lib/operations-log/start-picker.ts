/**
 * AZ ÜZEMELTETÉSI NAPLÓ KEZDŐKÉPERNYŐJE: PARTNER, HELYSZÍN, ESZKÖZ (task os-uzemeltetesi-naplo, kártya f6694b49).
 *
 * Balázs kérése (2026-11-15): „az üzemeltetési naplónak egy külön kezdő képernyő a mobil appban. Ki lehessen választani a partnert, a
 * helyszínt, és ott azokat az eszközöket, amikhez van sablon, és akkor lehet bejegyzést csinálni az eszközhöz.”
 *
 * MINDEN DÖNTÉS ITT ÁLL, a képernyő csak kirajzolja. A teszt-fordítás nem ismeri az `@/` aliast, ezért a típusok szerkezeti alakok:
 * az `AssetListItem` (a hálózati és a mentett eszköz-lista sora) ezeknek megfelel, és a hívó oldalon találkozik velük a fordító.
 *
 * KÉT ADATFORRÁS, EGY SZABÁLY. Térerővel a partner- és a helyszín-lista a szerverről jön, az eszközöket a szerver eszköz-listája adja
 * (a saját láthatósági hatókörén át), és a SABLONNAL RENDELKEZŐ azonosítók metszik. Térerő nélkül ugyanezt a kérdést a készülék
 * másolata válaszolja meg: a helyszín-letöltés eszközei és az eszközönként mentett sablon-listák. Az UTÓBBI CSAK AZT TUDJA, AMI
 * LEJÖTT: aki a helyszínt nem töltötte le, annak ott offline nincs eszköze. A képernyő ezt kimondja (`cacheNotice`), nem hallgatja el.
 */

/** Az eszköz-lista sorának az a része, amit a kezdőképernyő olvas. */
export interface StartAsset {
  id: string;
  assetNumber: string;
  name: string;
  category?: string;
  owner: { id: string; displayName: string };
  /** A helyszín (partner alegysége), ahol az eszköz áll; a `path` a gyökértől idáig tartó nevek sora. */
  unit?: { id: string; path: string[] };
}

export interface PartnerChoice {
  id: string;
  name: string;
}

export interface LocationChoice {
  /** A partner alegységének azonosítója. */
  id: string;
  /** A TELJES ÚT: a név csak testvérek között egyedi (lásd `partners/site-tree.ts`). */
  label: string;
}

const collator = new Intl.Collator("hu");

/** Csak azok az eszközök, amelyekhez van aktív sablon. A halmaz üres: nincs sablon, tehát nincs egy eszköz sem. */
export function templatedOnly<T extends { id: string }>(
  assets: readonly T[],
  templatedIds: ReadonlySet<string>,
): T[] {
  return assets.filter((asset) => templatedIds.has(asset.id));
}

/** A partnerek, akiknek van a listában helyszínnel rendelkező eszköze, név szerint, ismétlés nélkül. */
export function partnersFromAssets(
  assets: readonly StartAsset[],
): PartnerChoice[] {
  const byId = new Map<string, PartnerChoice>();
  for (const asset of assets)
    // helyszín nélküli eszköz nem választható (nincs hová tenni a listában), tehát a partnerét sem mutatja: egy partner csak akkor
    // szerepel, ha van legalább egy helyszíne, ahol rögzíthető eszköz áll
    if (asset.unit && !byId.has(asset.owner.id))
      byId.set(asset.owner.id, {
        id: asset.owner.id,
        name: asset.owner.displayName,
      });
  return [...byId.values()].sort((left, right) =>
    collator.compare(left.name, right.name),
  );
}

/**
 * A PARTNER HELYSZÍNEI A MÁSOLATBÓL: azok az alegységek, ahol a listában eszköz áll, teljes úttal, út szerint rendezve.
 *
 * CSAK A LEVÉL-HELYSZÍNEK (ahol az eszköz ténylegesen áll): a másolat az ősök azonosítóját nem hordozza, csak az út neveit, és egy
 * kitalált azonosítóval felkínált szülő-helyszín nem választható helyesen. A szülő alatti eszközök a levelen át elérhetők.
 */
export function locationsFromAssets(
  assets: readonly StartAsset[],
  partnerId: string,
): LocationChoice[] {
  const byId = new Map<string, LocationChoice>();
  for (const asset of assets) {
    if (asset.owner.id !== partnerId || !asset.unit) continue;
    if (!byId.has(asset.unit.id))
      byId.set(asset.unit.id, {
        id: asset.unit.id,
        label: pathLabel(asset.unit.path),
      });
  }
  return [...byId.values()].sort((left, right) =>
    collator.compare(left.label, right.label),
  );
}

function pathLabel(path: readonly string[]): string {
  const parts = path.filter((part) => part.trim());
  return parts.length > 0 ? parts.join(" / ") : "Név nélküli helyszín";
}

function startsWith(
  path: readonly string[] | undefined,
  prefix: readonly string[],
): boolean {
  if (!path || path.length < prefix.length) return false;
  return prefix.every((part, index) => path[index] === part);
}

/**
 * A HELYSZÍN ESZKÖZEI A MÁSOLATBÓL, A RÉSZFÁVAL EGYÜTT (ugyanaz a szabály, mint a szerver szűrőjén: a „Biodóm” eszköze az is, ami a
 * Biodóm alatti medencén áll). A helyszín útját egy olyan eszköz adja, amelyik pontosan ott áll; ha nincs ilyen, a másolatban a
 * helyszínhez nincs eszköz, és az eredmény üres (nem találgatunk útvonalat).
 */
export function assetsInLocation(
  assets: readonly StartAsset[],
  partnerId: string,
  locationId: string,
): StartAsset[] {
  const ofPartner = assets.filter((asset) => asset.owner.id === partnerId);
  const anchor = ofPartner.find((asset) => asset.unit?.id === locationId);
  if (!anchor?.unit) return [];
  const path = anchor.unit.path;
  return ofPartner
    .filter((asset) => startsWith(asset.unit?.path, path))
    .sort((left, right) => collator.compare(left.name, right.name));
}

/** Az eszköz második sora a listán: eszközszám és kategória. */
export function assetMeta(asset: {
  assetNumber: string;
  category?: string;
}): string {
  return [asset.assetNumber, asset.category]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" · ");
}

export type StartStep = "partners" | "locations" | "devices" | "templates";

/**
 * MELYIK LÉPÉSEN ÁLLUNK, A ROUTE PARAMÉTEREIBŐL. A mélyebb lépés mindig a felette állók paramétereit is kéri: egy hiányos
 * paraméter-készlet nem ugorhat át egy szintet (a hiányzó partner után a helyszín-lista kérdése nem értelmezhető), hanem a legutolsó
 * teljes szintre esik vissza.
 */
export function startStep(params: {
  partnerId?: string;
  locationId?: string;
  assetId?: string;
}): StartStep {
  if (!params.partnerId) return "partners";
  if (!params.locationId) return "locations";
  if (!params.assetId) return "devices";
  return "templates";
}

export type TemplateDecision =
  | { kind: "none" }
  | { kind: "record"; templateId: string }
  | { kind: "choose" };

/** Egy sablon: nincs mit kérdezni, megnyílik a rögzítés; több: a szerelő választ; nincs: kimondjuk. */
export function templateDecision(
  templates: readonly { id: string }[],
): TemplateDecision {
  if (templates.length === 0) return { kind: "none" };
  if (templates.length === 1)
    return { kind: "record", templateId: templates[0]!.id };
  return { kind: "choose" };
}

/** A mentett másolatból épített lista felirata: mit jelent, hogy „mentett”. */
export const cacheNotice =
  "Mentett másolat: csak az jelenik meg, amit a helyszín letöltésekor a készülékre mentettél.";

export type StartEmptyKind = "partners" | "locations" | "devices" | "templates";

/**
 * AZ ÜRES LISTA MONDATA, AZ OK SZERINT. Az üres találat ugyanúgy néz ki, ha nincs mit mutatni és ha nem töltöttük le: a két eset teendője
 * más (az első: nincs ilyen sablonos eszköz; a második: térerővel le kell tölteni a helyszínt), ezért a mondat a forrást is megmondja.
 */
export function emptyText(kind: StartEmptyKind, fromCache: boolean): string {
  if (fromCache) {
    switch (kind) {
      case "partners":
        return "A készüléken nincs mentett eszköz sablonnal. Térerővel töltsd le a helyszínt a kezdőképernyőn.";
      case "locations":
        return "Ennek a partnernek nincs a készüléken mentett, sablonos eszköze. Térerővel töltsd le a helyszínt.";
      case "devices":
        return "Ezen a helyszínen nincs a készüléken mentett, sablonos eszköz. Térerővel töltsd le a helyszínt.";
      case "templates":
        return "Ehhez az eszközhöz nincs a készüléken mentett sablon.";
    }
  }
  switch (kind) {
    case "partners":
      return "Nincs szerviz partner a listában.";
    case "locations":
      return "Ennek a partnernek nincs helyszíne.";
    case "devices":
      return "Ezen a helyszínen nincs olyan eszköz, amelyhez van üzemeltetési sablon.";
    case "templates":
      return "Ehhez az eszközhöz nincs aktív üzemeltetési sablon.";
  }
}

/**
 * A CSOPORTOS RÖGZÍTÉSHEZ KIJELÖLT ESZKÖZÖK (kártya 1a35e8f3): az eszközlistán kipipálható; a sorrend a kijelölés sorrendje, egy eszköz
 * egyszer, és legfeljebb `max` (a csoportos űrlap eszközönként egy kártya). A határon túli jelölés nem történik meg (a lista változatlan).
 */
export function toggleGroupSelection(
  selected: readonly string[],
  id: string,
  max: number,
): string[] {
  if (selected.includes(id)) return selected.filter((item) => item !== id);
  return selected.length >= max ? [...selected] : [...selected, id];
}

/** A csoportos gomb felirata a kijelölés darabszámával; `null`, amíg kevesebb mint két eszköz van kijelölve (egy eszköz a sima rögzítés). */
export function groupButtonLabel(count: number): string | null {
  return count >= 2 ? `Csoportos rögzítés (${count} eszköz)` : null;
}
