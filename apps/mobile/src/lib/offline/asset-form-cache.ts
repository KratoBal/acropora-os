import type { AssetOwnerOption } from "@/lib/api/assets";
import type { PartnerUnit } from "@/lib/api/partners";

import { initializeOfflineDatabase } from "./database";

/**
 * AZ ESZKÖZ-FELVITEL KÉT VÁLASZTÓJA A KÉSZÜLÉKEN.
 *
 * === MIÉRT KELL, ÉS MIÉRT MOST ===
 *
 * Balázs 2026-09-03-án élesben mérte a saját telefonján: térerő nélkül NEM tud
 * új eszközt felvenni, mert a partnerek nem töltődnek be, és ezért helyszínt
 * sem tud választani.
 *
 * A RÖGZÍTÉS MAGA MŰKÖDÖTT: a sor, a duplikáció-védelem és a fénykép mind
 * megvolt. Az ŰRLAP viszont két listát hálózatról kért, és e nélkül nincs mit
 * választani -- vagyis egy alsó réteg helyessége semmit nem ér, ha a képernyő
 * nem jut el odáig. Ez a másolat pótolja azt a kettőt.
 *
 * === AMIT MENTÜNK, ÉS AMIT NEM ===
 *
 * A tulajdonos-lista EGÉSZBEN mentődik (egy hívás, egy lista), az alegységek
 * viszont PARTNERENKÉNT -- csak azoknál, akiket a szerelő meg is nyitott. Egy
 * teljes letöltés minden partner minden alegységére az első indításnál percekig
 * tartana, és a sorok többsége sosem kellene.
 *
 * A HIBÁT ITT ELNYELJÜK, mint az `asset-cache.ts`-ben: egy elhasalt mentés nem
 * ronthat el egy működő, online képernyőt. A másolat KÉNYELEM; a sor ezzel
 * szemben BIZONYÍTÉK, és ott a hiba visszamegy a hívóhoz.
 */

type Database = Awaited<ReturnType<typeof initializeOfflineDatabase>>;

let opening: Promise<Database> | null = null;

function database(): Promise<Database> {
  opening ??= initializeOfflineDatabase();
  return opening;
}

export interface CachedAssetOwners {
  items: AssetOwnerOption[];
  syncedAt: string | null;
}

export interface CachedPartnerUnits {
  items: PartnerUnit[];
  syncedAt: string | null;
}

/**
 * A TULAJDONOS-LISTA TELJES CSERÉVEL frissül: a válasz a teljes halmaz, tehát
 * egy időközben megszűnt partner nem maradhat a másolatban. Csak beszúrva a
 * szerelő egy már nem választható partnert választana, és a felvitel a
 * szerveren bukna el -- a pincéből nézve megmagyarázhatatlanul.
 */
export async function rememberAssetOwners(
  items: readonly AssetOwnerOption[],
): Promise<void> {
  const savedAt = new Date().toISOString();
  try {
    const db = await database();
    await db.withTransactionAsync(async () => {
      await db.runAsync(`DELETE FROM cached_asset_owners`);
      for (const item of items) {
        await db.runAsync(
          `INSERT INTO cached_asset_owners (id, payload_json, synced_at)
           VALUES (?, ?, ?)`,
          [item.id, JSON.stringify(item), savedAt],
        );
      }
    });
  } catch {
    // Lásd a modul fejlécét: a másolat kényelem, nem bizonyíték.
  }
}

export async function readCachedAssetOwners(): Promise<CachedAssetOwners> {
  try {
    const db = await database();
    const rows = await db.getAllAsync<{
      payload_json: string;
      synced_at: string;
    }>(`SELECT payload_json, synced_at FROM cached_asset_owners`);
    return { items: parseAll<AssetOwnerOption>(rows), syncedAt: newest(rows) };
  } catch {
    // Az olvasás hibája ÜRES másolatnak látszik, és azt a felület kimondja.
    return { items: [], syncedAt: null };
  }
}

/** Egy partner alegységei. A régi sorok mennek: a lista a partnerre TELJES. */
export async function rememberPartnerUnits(
  partnerId: string,
  items: readonly PartnerUnit[],
): Promise<void> {
  const savedAt = new Date().toISOString();
  try {
    const db = await database();
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        `DELETE FROM cached_partner_units WHERE partner_id = ?`,
        [partnerId],
      );
      for (const item of items) {
        await db.runAsync(
          `INSERT INTO cached_partner_units (id, partner_id, payload_json, synced_at)
           VALUES (?, ?, ?, ?)`,
          [item.id, partnerId, JSON.stringify(item), savedAt],
        );
      }
    });
  } catch {
    // Lásd a modul fejlécét.
  }
}

export async function readCachedPartnerUnits(
  partnerId: string,
): Promise<CachedPartnerUnits> {
  try {
    const db = await database();
    const rows = await db.getAllAsync<{
      payload_json: string;
      synced_at: string;
    }>(
      `SELECT payload_json, synced_at FROM cached_partner_units
        WHERE partner_id = ?`,
      [partnerId],
    );
    return { items: parseAll<PartnerUnit>(rows), syncedAt: newest(rows) };
  } catch {
    return { items: [], syncedAt: null };
  }
}

/**
 * KIJELENTKEZÉSKOR EZ IS MEGY. Partnerek nevei és kódjai ülnek benne, és a
 * telefon a következő kollégához is kerülhet -- ugyanaz az indok, mint a többi
 * másolatnál.
 */
export async function forgetAssetFormCache(): Promise<void> {
  try {
    const db = await database();
    await db.execAsync(
      `DELETE FROM cached_partner_units; DELETE FROM cached_asset_owners;`,
    );
  } catch {
    // A kijelentkezés akkor is fusson végig, ha a helyi adatbázis nem nyitható.
  }
}

function parseAll<T>(rows: readonly { payload_json: string }[]): T[] {
  const items: T[] = [];
  for (const row of rows) {
    try {
      items.push(JSON.parse(row.payload_json) as T);
    } catch {
      // Egy sérült sor nem viheti el a többit: a lista fele is több a semminél.
    }
  }
  return items;
}

function newest(rows: readonly { synced_at: string }[]): string | null {
  return rows.reduce<string | null>(
    (max, row) => (max === null || row.synced_at > max ? row.synced_at : max),
    null,
  );
}
