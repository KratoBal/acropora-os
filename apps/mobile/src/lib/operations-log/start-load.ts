import { ApiError } from "@/lib/api/client";
import { listAssets } from "@/lib/api/assets";
import { listAssetIdsWithOperationsTemplates } from "@/lib/api/operations-log";
import { listPartnerUnits, listServicePartners } from "@/lib/api/partners";
import { readCachedAssets } from "@/lib/offline/asset-cache";
import { readAssetIdsWithCachedTemplates } from "@/lib/offline/operations-cache";
import { buildUnitOptions } from "@/lib/partners/site-tree";

import {
  assetsInLocation,
  locationsFromAssets,
  partnersFromAssets,
  templatedOnly,
  type LocationChoice,
  type PartnerChoice,
  type StartAsset,
} from "./start-picker";

/**
 * A KEZDŐKÉPERNYŐ HÁROM LISTÁJA: HÁLÓZATRÓL, ÉS HA AZ NEM MEGY, A KÉSZÜLÉKEN MENTETTBŐL (kártya f6694b49).
 *
 * UGYANAZ A VISSZAESÉSI SZABÁLY, mint az `operations-load.ts`-ben: a mentett másolatra a HÁLÓZATI HIBA és a szerver-kiesés (5xx) esik
 * vissza, a válaszolt 4xx (például elvett jog) nem takarható el az elavult listával. Ha nincs hálózat ÉS nincs másolat, a hiba az
 * eredeti marad.
 *
 * TÉRERŐVEL a partner- és a helyszín-lista a szerverről jön (minden szerviz partner, a helyszíneivel), az eszközöket a szerver
 * eszköz-listája adja, a sablonnal rendelkezőkre metszve. A MÁSOLATBÓL csak az épül, ami lejött: a partner és a helyszín is csak
 * akkor szerepel, ha a helyszín-letöltés hozott hozzá sablonnal rendelkező eszközt. A két ág eltérő listát adhat, és ez nem hiba:
 * a `fromCache` jelzi a képernyőnek, hogy a másolatot látjuk.
 */
export interface StartLoaded<T> {
  items: T[];
  fromCache: boolean;
}

const PAGE_SIZE = 500;

/** A másolatból épített eszköz-halmaz: a letöltött eszközök, a sablonnal rendelkezőkre szűrve. `null`: nincs másolat. */
async function cachedTemplatedAssets(): Promise<StartAsset[] | null> {
  const [assets, templated] = await Promise.all([
    readCachedAssets(),
    readAssetIdsWithCachedTemplates(),
  ]);
  if (assets.syncedAt === null) return null;
  return templatedOnly(assets.items, new Set(templated.assetIds));
}

/** A hálózati hibán és az 5xx-en kívül minden hiba tovább megy (lásd a modul fejlécét). */
function mayUseCopy(cause: unknown): boolean {
  return !(cause instanceof ApiError && cause.status < 500);
}

export async function loadStartPartners(): Promise<StartLoaded<PartnerChoice>> {
  try {
    const items: PartnerChoice[] = [];
    for (let page = 1; ; page += 1) {
      const response = await listServicePartners(page, 100);
      for (const partner of response.items)
        items.push({ id: partner.id, name: partner.name });
      if (page >= response.pagination.totalPages) break;
    }
    return { items, fromCache: false };
  } catch (cause) {
    if (!mayUseCopy(cause)) throw cause;
    const cached = await cachedTemplatedAssets();
    if (cached === null) throw cause;
    return { items: partnersFromAssets(cached), fromCache: true };
  }
}

export async function loadStartLocations(
  partnerId: string,
): Promise<StartLoaded<LocationChoice>> {
  try {
    const { items } = await listPartnerUnits(partnerId);
    return {
      items: buildUnitOptions(items).map((option) => ({
        id: option.id,
        label: option.label,
      })),
      fromCache: false,
    };
  } catch (cause) {
    if (!mayUseCopy(cause)) throw cause;
    const cached = await cachedTemplatedAssets();
    if (cached === null) throw cause;
    return { items: locationsFromAssets(cached, partnerId), fromCache: true };
  }
}

export async function loadStartDevices(
  partnerId: string,
  locationId: string,
): Promise<StartLoaded<StartAsset>> {
  try {
    const assets: StartAsset[] = [];
    for (let page = 1; ; page += 1) {
      const response = await listAssets(
        page,
        PAGE_SIZE,
        "",
        locationId,
        "ACTIVE",
      );
      assets.push(...response.items);
      if (page >= response.pagination.totalPages) break;
    }
    const { assetIds } = await listAssetIdsWithOperationsTemplates();
    return {
      items: templatedOnly(assets, new Set(assetIds)).sort((left, right) =>
        left.name.localeCompare(right.name, "hu"),
      ),
      fromCache: false,
    };
  } catch (cause) {
    if (!mayUseCopy(cause)) throw cause;
    const cached = await cachedTemplatedAssets();
    if (cached === null) throw cause;
    return {
      items: assetsInLocation(cached, partnerId, locationId),
      fromCache: true,
    };
  }
}
