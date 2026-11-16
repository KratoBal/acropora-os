import { ApiError } from "@/lib/api/client";
import { listOperationsStartCatalogue } from "@/lib/api/operations-log";
import { readCachedAssets } from "@/lib/offline/asset-cache";
import { readAssetIdsWithCachedTemplates } from "@/lib/offline/operations-cache";

import { templatedOnly, type StartAsset } from "./start-picker";

/**
 * A KEZDŐKÉPERNYŐ KATALÓGUSA: HÁLÓZATRÓL, ÉS HA AZ NEM MEGY, A KÉSZÜLÉKEN MENTETTBŐL (kártya f6694b49).
 *
 * EGY KATALÓGUS, HÁROM LISTA. A partner-, a helyszín- és az eszköz-lista UGYANABBÓL az egy eszköz-halmazból épül (`start-picker.ts`), tehát
 * egy partner és egy helyszín csak akkor szerepel, ha van ott sablonnal rendelkező eszköz. Eddig a partner- és a helyszín-lista a szerver
 * teljes listájából jött, és Balázs a partner kiválasztása után MINDEN helyszínt látott (TestFlight 22, 2026-11-15).
 *
 * TÉRERŐVEL a szerver katalógusa adja a halmazt (`GET /operations-log/assets-with-templates`, `assets`). TÉRERŐ NÉLKÜL a készülék másolata: a
 * helyszín-letöltés eszközei és az eszközönként mentett, nem üres sablon-listák metszete. A másolatból csak az épül, ami lejött.
 *
 * UGYANAZ A VISSZAESÉSI SZABÁLY, mint az `operations-load.ts`-ben: a mentett másolatra a HÁLÓZATI HIBA és a szerver-kiesés (5xx) esik
 * vissza, a válaszolt 4xx (például elvett jog) nem takarható el az elavult listával. Ha nincs hálózat ÉS nincs másolat, a hiba az eredeti
 * marad. Egy régebbi kiszolgáló, amelyik még nem ad `assets` mezőt, nem 4xx, hanem hiányzó válasz: azt hálózati hibaként kezeljük (a
 * másolatra esünk vissza), mert a katalógus nélkül a lista nem épülhet.
 */
export interface StartCatalogue {
  assets: StartAsset[];
  fromCache: boolean;
}

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

export async function loadStartCatalogue(): Promise<StartCatalogue> {
  try {
    const response = await listOperationsStartCatalogue();
    if (!response.assets)
      throw new Error("A kiszolgáló még nem adja a kezdőképernyő katalógusát.");
    return { assets: response.assets, fromCache: false };
  } catch (cause) {
    if (!mayUseCopy(cause)) throw cause;
    const cached = await cachedTemplatedAssets();
    if (cached === null) throw cause;
    return { assets: cached, fromCache: true };
  }
}
