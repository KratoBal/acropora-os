import {
  listOperationsColleagues,
  listOperationsTemplatesForAsset,
  type OperationsColleague,
  type OperationsTemplate,
} from "@/lib/api/operations-log";
import { ApiError } from "@/lib/api/client";
import {
  readCachedOperationsColleagues,
  readCachedOperationsTemplates,
  rememberOperationsColleagues,
  rememberOperationsTemplates,
} from "@/lib/offline/operations-cache";

/**
 * A SABLONOK ÉS A KOLLÉGÁK BETÖLTÉSE: HÁLÓZATRÓL, ÉS HA AZ NEM MEGY, A KÉSZÜLÉKEN MENTETTBŐL (task os-uzemeltetesi-naplo, S2c).
 *
 * `fromCache: true` jelzi a képernyőnek, hogy a lista a legutóbbi sikeres betöltésé: a szerelő tudja, hogy egy időközben módosított
 * sablon még a régi alakjában látszik (a rögzítés a szerveren ettől még érvényes: a kötelező-ellenőrzés a telefon által LÁTOTT
 * mezőkre szól, a kivezetett mező értéke is elfogadott). Ha nincs hálózat ÉS nincs másolat, a hiba az eredeti marad. A MENTETT LISTÁRA HÁLÓZATI HIBÁNÁL ÉS SZERVER-KIESÉSNÉL (5xx) esünk vissza: egy válaszolt 4xx (például elvett jog) nem takarható el az elavult listával.
 */
export interface Loaded<T> {
  items: T[];
  fromCache: boolean;
}

export async function loadOperationsTemplates(
  assetId: string,
): Promise<Loaded<OperationsTemplate>> {
  try {
    const { items } = await listOperationsTemplatesForAsset(assetId);
    await rememberOperationsTemplates(assetId, items);
    return { items, fromCache: false };
  } catch (cause) {
    // a szerver VÁLASZOLT a kérésre (jogosultság, hiányzó eszköz): azt a mentett lista nem takarhatja el; az 5xx viszont a szerver
    // (vagy az átjáró) kiesése, nem válasz a kérdésre, és a térerős helyszínen is a másolat a helyes
    if (cause instanceof ApiError && cause.status < 500) throw cause;
    const cached = await readCachedOperationsTemplates(assetId);
    if (cached.syncedAt === null) throw cause;
    return { items: cached.items, fromCache: true };
  }
}

export async function loadOperationsColleagues(): Promise<
  Loaded<OperationsColleague>
> {
  try {
    const { items } = await listOperationsColleagues();
    await rememberOperationsColleagues(items);
    return { items, fromCache: false };
  } catch (cause) {
    // a szerver VÁLASZOLT a kérésre (jogosultság, hiányzó eszköz): azt a mentett lista nem takarhatja el; az 5xx viszont a szerver
    // (vagy az átjáró) kiesése, nem válasz a kérdésre, és a térerős helyszínen is a másolat a helyes
    if (cause instanceof ApiError && cause.status < 500) throw cause;
    const cached = await readCachedOperationsColleagues();
    if (cached.syncedAt === null) throw cause;
    return { items: cached.items, fromCache: true };
  }
}
