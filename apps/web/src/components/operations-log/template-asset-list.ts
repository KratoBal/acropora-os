import { OPERATIONS_TEMPLATE_LIMITS } from "@acropora/types";

/**
 * A SABLON ESZKÖZLISTÁJA A SZERKESZTŐBEN (task t-20261117-sablon-eszkozlista, kártya 42bc1c67, PR b; Balázs, 2026-11-17: „a weben:
 * helyszín kiválasztása, ott az eszközök kijelölése, hozzáadás a sablonhoz”). Tiszta döntések, komponens nélkül: mi kerül a listába, mi
 * marad ki, és mondja-e meg, miért.
 *
 * A lista a SZERVER korlátját viseli (`assetsMax`): a határon túli hozzáadás nem történik meg, és az eredmény megmondja, hány maradt ki,
 * hogy a képernyő ne hallgassa el (egy csendben levágott lista a legrosszabb hiba: a hiányzó eszköz úgy néz ki, mintha nem létezne).
 */
export interface ListedAsset {
  id: string;
  /** A sorban látszó felirat: „V2196 · Homokszűrő”. */
  label: string;
}

export const ASSETS_MAX = OPERATIONS_TEMPLATE_LIMITS.assetsMax;

/** Egy eszköz felirata a listában: a leltári szám és a név (a szám egyedi, a név beszél). */
export function assetLabel(asset: {
  assetNumber: string;
  name: string;
}): string {
  return `${asset.assetNumber} · ${asset.name}`;
}

export interface AddResult {
  list: ListedAsset[];
  /** Hány eszköz került be most. */
  added: number;
  /** Hány volt már a listában (ismétlés, nem hiba). */
  alreadyListed: number;
  /** Hány maradt ki, mert a lista elérte a határt. */
  overLimit: number;
}

/** Hozzáadás: a sorrend a hozzáadás sorrendje, egy eszköz egyszer, és legfeljebb `max` elem. A bemenetet nem módosítja. */
export function addAssets(
  current: readonly ListedAsset[],
  incoming: readonly ListedAsset[],
  max: number = ASSETS_MAX,
): AddResult {
  const list = [...current];
  const seen = new Set(list.map((item) => item.id));
  let added = 0;
  let alreadyListed = 0;
  let overLimit = 0;
  for (const item of incoming) {
    if (seen.has(item.id)) {
      alreadyListed += 1;
      continue;
    }
    if (list.length >= max) {
      overLimit += 1;
      continue;
    }
    seen.add(item.id);
    list.push(item);
    added += 1;
  }
  return { list, added, alreadyListed, overLimit };
}

export function removeAsset(
  current: readonly ListedAsset[],
  id: string,
): ListedAsset[] {
  return current.filter((item) => item.id !== id);
}

/** A hozzáadás után a felhasználónak szóló egy mondat; üres szöveg, ha nincs mit mondani. */
export function addSummary(result: AddResult): string {
  const parts: string[] = [];
  if (result.added > 0)
    parts.push(`${result.added} eszköz bekerült a listába.`);
  if (result.alreadyListed > 0)
    parts.push(`${result.alreadyListed} már a listában volt.`);
  if (result.overLimit > 0)
    parts.push(
      `${result.overLimit} eszköz nem fért be: egy sablonban legfeljebb ${ASSETS_MAX} eszköz lehet.`,
    );
  return parts.join(" ");
}
