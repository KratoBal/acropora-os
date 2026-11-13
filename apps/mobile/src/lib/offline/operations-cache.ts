import type {
  OperationsColleague,
  OperationsTemplate,
} from "@/lib/api/operations-log";

import { inTransaction, offlineDatabase } from "./database";

/**
 * AZ ÜZEMELTETÉSI NAPLÓ KÉT LISTÁJA A KÉSZÜLÉKEN (task os-uzemeltetesi-naplo, S2c): az eszközhöz tartozó SABLONOK és a KOLLÉGÁK.
 *
 * MIÉRT KELL: a rögzítés a helyszínen történik, térerő nélkül is (a sor, az idempotencia és a kép mind megvan), de az ŰRLAP e két
 * listát hálózatról kérné, és nélkülük nincs mit kitölteni, és nincs kit résztvevőnek választani. Ugyanaz a szakadás, amit az
 * eszköz-felvitel `asset-form-cache.ts`-e zár.
 *
 * AMIT MENTÜNK: azt az eszközt, amelynek a sablonlistáját a szerelő térerővel megnyitotta (eszközönként egy teljes lista: ami
 * kikerült a kínálatból, nem maradhat a másolatban), és a kollégák teljes listáját (egy hívás, teljes csere). A HIBÁT ITT ELNYELJÜK,
 * mint az `asset-cache.ts`-ben: a másolat KÉNYELEM, egy elhasalt mentés nem ronthat el egy működő, online képernyőt.
 *
 * KIJELENTKEZÉSKOR MINDEN TÖRLŐDIK (`forgetOperationsLogCache`, a `forget-offline-data.ts` hívja): a lista kollégák neveit tartalmazza,
 * a készülék pedig a következő kollégához is kerülhet.
 */
const database = offlineDatabase;

function parse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export interface CachedOperationsTemplates {
  items: OperationsTemplate[];
  /** A mentés ideje, ISO alakban. `null`, ha ehhez az eszközhöz nincs másolat. */
  syncedAt: string | null;
}

export interface CachedOperationsColleagues {
  items: OperationsColleague[];
  syncedAt: string | null;
}

/**
 * EGY ESZKÖZ SABLON-LISTÁJA A MÁSOLATBA, A HIBÁVAL EGYÜTT: a helyszín-letöltő ezt hívja (neki tudnia kell, ha a mentés elhasalt, különben a
 * záró mondat „kész"-et mond egy üres másolatra: Balázs, 2026-09-30, Android). A képernyők a `remember` párt hívják, amelyik elnyeli a hibát.
 */
export async function storeOperationsTemplates(
  assetId: string,
  items: readonly OperationsTemplate[],
): Promise<void> {
  const db = await database();
  await db.runAsync(
    `INSERT INTO cached_operations_templates (asset_id, payload_json, synced_at)
     VALUES (?, ?, ?)
     ON CONFLICT(asset_id) DO UPDATE SET
       payload_json = excluded.payload_json,
       synced_at = excluded.synced_at`,
    [assetId, JSON.stringify(items), new Date().toISOString()],
  );
}

export async function rememberOperationsTemplates(
  assetId: string,
  items: readonly OperationsTemplate[],
): Promise<void> {
  try {
    await storeOperationsTemplates(assetId, items);
  } catch {
    // Lásd a modul fejlécét: a másolat kényelem, nem bizonyíték.
  }
}

export async function readCachedOperationsTemplates(
  assetId: string,
): Promise<CachedOperationsTemplates> {
  try {
    const db = await database();
    const row = await db.getFirstAsync<{
      payload_json: string;
      synced_at: string;
    }>(
      `SELECT payload_json, synced_at FROM cached_operations_templates WHERE asset_id = ?`,
      [assetId],
    );
    if (!row) return { items: [], syncedAt: null };
    const items = parse<OperationsTemplate[]>(row.payload_json);
    return items
      ? { items, syncedAt: row.synced_at }
      : { items: [], syncedAt: null };
  } catch {
    return { items: [], syncedAt: null };
  }
}

/** A kollégák TELJES CSERÉVEL frissülnek: egy időközben kilépett kolléga nem maradhat választható. */
export async function rememberOperationsColleagues(
  items: readonly OperationsColleague[],
): Promise<void> {
  const savedAt = new Date().toISOString();
  try {
    const db = await database();
    await inTransaction(db, async () => {
      await db.runAsync(`DELETE FROM cached_operations_colleagues`);
      for (const item of items) {
        await db.runAsync(
          `INSERT INTO cached_operations_colleagues (id, payload_json, synced_at)
           VALUES (?, ?, ?)`,
          [item.id, JSON.stringify(item), savedAt],
        );
      }
    });
  } catch {
    // Lásd a modul fejlécét.
  }
}

export async function readCachedOperationsColleagues(): Promise<CachedOperationsColleagues> {
  try {
    const db = await database();
    const rows = await db.getAllAsync<{
      payload_json: string;
      synced_at: string;
    }>(`SELECT payload_json, synced_at FROM cached_operations_colleagues`);
    const items = rows
      .map((row) => parse<OperationsColleague>(row.payload_json))
      .filter((item): item is OperationsColleague => item !== null)
      .sort((left, right) => left.name.localeCompare(right.name, "hu"));
    return {
      items,
      syncedAt:
        rows.map((row) => row.synced_at).sort()[rows.length - 1] ?? null,
    };
  } catch {
    return { items: [], syncedAt: null };
  }
}

export async function forgetOperationsLogCache(): Promise<void> {
  try {
    const db = await database();
    await db.execAsync(
      `DELETE FROM cached_operations_templates; DELETE FROM cached_operations_colleagues;`,
    );
  } catch {
    // Nem dobjuk tovább: a kijelentkezés akkor is fusson végig, ha a helyi adatbázis épp nem nyitható meg.
  }
}
