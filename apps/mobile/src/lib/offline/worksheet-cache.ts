import type { WorksheetDetail } from "@/lib/api/worksheets";

import { initializeOfflineDatabase } from "./database";

/**
 * A MEGNYITOTT MUNKALAP HELYSZINI MASOLATA.
 *
 * === MIERT KELL, ES MIERT EZ AZ ELSO LEPES ===
 *
 * A munkalap a MUNKAUTASITAS: a szerelo azt olvassa a helyszinen, hogy mit kell
 * csinalnia. Terero nelkul eddig egy MEGLEVO lapot MEG SEM TUDOTT MEGNYITNI --
 * a `getWorksheet` egyenesen a szerverre ment, gyorsitotar nelkul.
 *
 * Az uj lap NYITASA mar mukodott offline (a sor viszi fel); az olvasas nem. Egy
 * tetelt pedig nem lehet olyan lapra irni, amit meg megnyitni sem lehet, tehat
 * ez elozi a tobbi offline kepesseget.
 *
 * === CSAK AMIT MEGNYITOTTAK, ES CSAK TERERŐVEL ===
 *
 * Ugyanaz a szabaly, mint az eszkoz adatlapjanal: a masolat akkor keletkezik,
 * amikor valaki TERERŐVEL megnyitotta a lapot. Nem toltunk le elore semmit --
 * egy elore letoltott keszlet olyan lapokat is a keszulekre hozna, amikhez a
 * szerelonek semmi koze.
 *
 * === A HIBA NEM DOBODIK TOVABB ===
 *
 * Egy elhasalt mentes nem ronthatja el azt a kepernyot, ami epp online mukodik.
 * Az olvasas hibaja ugyanigy ures masolatnak latszik -- es azt a felulet
 * KIMONDJA, tehat ez a csend nem marad rejtve.
 *
 * === KIJELENTKEZESKOR TORLODIK ===
 *
 * Partner-adatok allnak benne (kinek a lapja, milyen munkarol), es a keszulek a
 * kovetkezo kollegahoz is kerulhet. A takaritas a `forget-offline-data.ts`-ben
 * van, mert a kovetkezo olvaso ott fogja keresni.
 */

type Database = Awaited<ReturnType<typeof initializeOfflineDatabase>>;

let opening: Promise<Database> | null = null;

function database(): Promise<Database> {
  opening ??= initializeOfflineDatabase();
  return opening;
}

export interface CachedWorksheet {
  /** A teljes adatlap, ha ezt a lapot megnyitottak tererovel. `null`, ha nem. */
  detail: WorksheetDetail | null;
  /** A mentes ideje, ISO alakban. `null`, ha nincs masolat. */
  syncedAt: string | null;
}

function parse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export async function rememberWorksheet(
  detail: WorksheetDetail,
): Promise<void> {
  try {
    const db = await database();
    await db.runAsync(
      `INSERT INTO cached_worksheet_details (id, payload_json, synced_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         payload_json = excluded.payload_json,
         synced_at = excluded.synced_at`,
      [detail.id, JSON.stringify(detail), new Date().toISOString()],
    );
  } catch {
    // Lasd a fejlecet: egy elhasalt mentes nem ronthat el egy mukodo kepernyot.
  }
}

export async function readCachedWorksheet(
  id: string,
): Promise<CachedWorksheet> {
  try {
    const db = await database();
    const row = await db.getFirstAsync<{
      payload_json: string;
      synced_at: string;
    }>(
      `SELECT payload_json, synced_at FROM cached_worksheet_details WHERE id = ?`,
      [id],
    );
    if (!row) return { detail: null, syncedAt: null };
    return {
      detail: parse<WorksheetDetail>(row.payload_json),
      syncedAt: row.synced_at,
    };
  } catch {
    return { detail: null, syncedAt: null };
  }
}

export async function forgetCachedWorksheets(): Promise<void> {
  try {
    const db = await database();
    await db.runAsync(`DELETE FROM cached_worksheet_details`);
  } catch {
    // Ugyanaz a szabaly: a kijelentkezes nem hasalhat el egy takaritason.
  }
}
