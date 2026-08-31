import type { AssetDetail, AssetListItem } from "@/lib/api/assets";

import { initializeOfflineDatabase } from "./database";

/**
 * A HELYSZÍNI MÁSOLAT ÍRÁSA ÉS OLVASÁSA.
 *
 * Amit itt eldöntünk, az nem a megjelenítés (az az `offline-notice.ts`
 * dolga), hanem hogy MI KERÜL A KÉSZÜLÉKRE és mikor:
 *
 * - a lista minden sikeres oldala mentődik, tehát a végiggörgetett lista
 *   offline is megvan, és a QR-kód feloldható marad;
 * - a teljes adatlap csak arról az eszközről, amit valaki megnyitott
 *   térerővel;
 * - kijelentkezéskor MINDEN törlődik. Partner-eszközök adatai vannak benne,
 *   és a készülék a következő kollégához is kerülhet.
 *
 * A HIBA ITT NEM DOBÓDIK TOVÁBB. Egy elhasalt mentés nem ronthatja el azt a
 * képernyőt, ami épp online, működik és a szerverről kapta az adatot. Az
 * olvasás hibája ugyanígy üres másolatnak látszik -- és az üres másolatot a
 * felület KIMONDJA ("nincs mentett másolat"), tehát ez a fajta csend nem
 * marad rejtve a szerelő elől.
 */

type Database = Awaited<ReturnType<typeof initializeOfflineDatabase>>;

let opening: Promise<Database> | null = null;

function database(): Promise<Database> {
  opening ??= initializeOfflineDatabase();
  return opening;
}

export interface CachedAssets {
  items: AssetListItem[];
  /** A legfrissebb mentés ideje, ISO alakban. `null`, ha nincs másolat. */
  syncedAt: string | null;
}

export interface CachedAsset {
  /** A teljes adatlap, ha ezt az eszközt megnyitották térerővel. */
  detail: AssetDetail | null;
  /** A listasor, ami minden mentett eszközről megvan. */
  summary: AssetListItem | null;
  syncedAt: string | null;
}

function parse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/** A lista egy oldala. Ugyanannak az eszköznek az újabb sora felülírja a régit. */
export async function rememberAssets(items: AssetListItem[]): Promise<void> {
  if (items.length === 0) return;
  const savedAt = new Date().toISOString();
  try {
    const db = await database();
    await db.withTransactionAsync(async () => {
      for (const item of items) {
        await db.runAsync(
          `INSERT INTO cached_assets (id, qr_token, payload_json, synced_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             qr_token = excluded.qr_token,
             payload_json = excluded.payload_json,
             synced_at = excluded.synced_at`,
          [item.id, item.qrToken, JSON.stringify(item), savedAt],
        );
      }
    });
  } catch {
    // Lásd a modul fejlécét: a mentés hibája nem ronthat el egy működő,
    // online képernyőt.
  }
}

export async function rememberAssetDetail(detail: AssetDetail): Promise<void> {
  const savedAt = new Date().toISOString();
  try {
    const db = await database();
    await db.runAsync(
      `INSERT INTO cached_asset_details (id, qr_token, payload_json, synced_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         qr_token = excluded.qr_token,
         payload_json = excluded.payload_json,
         synced_at = excluded.synced_at`,
      [detail.id, detail.qrToken, JSON.stringify(detail), savedAt],
    );
    // Az adatlap a listasort is naprakészen tartja: aki megnyitott egy eszközt,
    // annak a listán se a tegnapi állapota jöjjön elő.
    await rememberAssets([detail]);
  } catch {
    // Ugyanaz, mint fent.
  }
}

export async function readCachedAssets(): Promise<CachedAssets> {
  try {
    const db = await database();
    const rows = await db.getAllAsync<{
      payload_json: string;
      synced_at: string;
    }>(
      `SELECT payload_json, synced_at FROM cached_assets ORDER BY synced_at DESC`,
    );

    const items = rows
      .map((row) => parse<AssetListItem>(row.payload_json))
      .filter((item): item is AssetListItem => item !== null)
      .sort((left, right) => left.name.localeCompare(right.name, "hu"));

    return { items, syncedAt: rows[0]?.synced_at ?? null };
  } catch {
    return { items: [], syncedAt: null };
  }
}

async function readOne(
  where: "id" | "qr_token",
  value: string,
): Promise<CachedAsset> {
  const empty: CachedAsset = { detail: null, summary: null, syncedAt: null };
  try {
    const db = await database();
    const detailRow = await db.getFirstAsync<{
      payload_json: string;
      synced_at: string;
    }>(
      `SELECT payload_json, synced_at FROM cached_asset_details WHERE ${where} = ?`,
      [value],
    );
    const summaryRow = await db.getFirstAsync<{
      payload_json: string;
      synced_at: string;
    }>(`SELECT payload_json, synced_at FROM cached_assets WHERE ${where} = ?`, [
      value,
    ]);

    return {
      detail: detailRow ? parse<AssetDetail>(detailRow.payload_json) : null,
      summary: summaryRow
        ? parse<AssetListItem>(summaryRow.payload_json)
        : null,
      syncedAt: detailRow?.synced_at ?? summaryRow?.synced_at ?? null,
    };
  } catch {
    return empty;
  }
}

export function readCachedAsset(id: string): Promise<CachedAsset> {
  return readOne("id", id);
}

/**
 * A BEOLVASOTT QR-KÓD FELOLDÁSA TÉRERŐ NÉLKÜL. A `qrToken` a listasorban is
 * megjön a szerverről, pontosan ezért: enélkül a helyszíni katalógus nem tudná,
 * melyik eszközre mutat a matrica.
 */
export function readCachedAssetByToken(qrToken: string): Promise<CachedAsset> {
  return readOne("qr_token", qrToken);
}

/**
 * KIJELENTKEZÉSKOR MINDEN MEGY. Partner-eszközök adatai ülnek a készüléken, a
 * telefon pedig a következő kollégához is kerülhet -- a mentett másolat nem
 * élheti túl azt a munkamenetet, amiben keletkezett.
 */
export async function forgetOfflineAssets(): Promise<void> {
  try {
    const db = await database();
    await db.execAsync(
      `DELETE FROM cached_asset_details; DELETE FROM cached_assets;`,
    );
  } catch {
    // Nem dobjuk tovább: a kijelentkezés akkor is fusson végig, ha a helyi
    // adatbázis épp nem nyitható meg. A munkamenet-token ettől függetlenül
    // törlődik, tehát a másolat szerver felé nem használható.
  }
}
