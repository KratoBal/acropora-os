import type { WorksheetDepartment } from "@/lib/api/worksheets";

import { initializeOfflineDatabase } from "./database";

/**
 * A MUNKALAP HELYSZÍNEI A KÉSZÜLÉKEN.
 *
 * === MIÉRT KELL EGYÁLTALÁN ===
 *
 * A munkalap felvitelénél a helyszín (alegység) KÖTELEZŐ mező: a szerver
 * `departmentId` nélkül elutasítja a lapot. A lista viszont hálózatról jön,
 * tehát térerő nélkül nincs miből választani -- és akkor a helyszíni felvitel
 * pontosan ott nem működik, ahol a legtöbbet érne.
 *
 * === AMIT MENTÜNK, ÉS AMIT NEM ===
 *
 * Csak azoknak a partnereknek a helyszínei, akiknél a szerelő JÁRT is (a
 * választó megnyitása menti őket). Egy teljes letöltés minden partnerre a
 * legelső indításnál percekig tartana, és a legtöbb sor sosem kellene.
 *
 * A HIBÁT ITT ELNYELJÜK, ugyanúgy, mint az `asset-cache.ts`-ben: egy elhasalt
 * mentés nem ronthat el egy működő, online képernyőt. A másolat KÉNYELEM.
 * (A sor ezzel szemben BIZONYÍTÉK, ezért ott a hiba visszamegy a hívóhoz --
 * lásd `queue-store.ts`.)
 */

type Database = Awaited<ReturnType<typeof initializeOfflineDatabase>>;

let opening: Promise<Database> | null = null;

function database(): Promise<Database> {
  opening ??= initializeOfflineDatabase();
  return opening;
}

export interface CachedWorksheetDepartments {
  items: WorksheetDepartment[];
  /** A mentés ideje, ISO alakban. `null`, ha nincs másolat. */
  syncedAt: string | null;
}

/**
 * EGY PARTNER HELYSZÍNEI. A régi sorok NEM maradnak ott: a lista a partnerre
 * nézve TELJES, tehát egy időközben törölt helyszínnek el kell tűnnie a
 * másolatból is. Enélkül a szerelő egy már nem létező helyszínt választana, és
 * a küldés a szerveren bukna el, a pincéből nézve megmagyarázhatatlanul.
 */
export async function rememberWorksheetDepartments(
  customerId: string,
  items: readonly WorksheetDepartment[],
): Promise<void> {
  const savedAt = new Date().toISOString();
  try {
    const db = await database();
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        `DELETE FROM cached_worksheet_departments WHERE customer_id = ?`,
        [customerId],
      );
      for (const item of items) {
        await db.runAsync(
          `INSERT INTO cached_worksheet_departments
             (id, customer_id, payload_json, synced_at)
           VALUES (?, ?, ?, ?)`,
          [item.id, customerId, JSON.stringify(item), savedAt],
        );
      }
    });
  } catch {
    // Lásd a modul fejlécét: a másolat kényelem, nem bizonyíték.
  }
}

export async function readCachedWorksheetDepartments(
  customerId: string,
): Promise<CachedWorksheetDepartments> {
  try {
    const db = await database();
    const rows = await db.getAllAsync<{
      payload_json: string;
      synced_at: string;
    }>(
      `SELECT payload_json, synced_at FROM cached_worksheet_departments
        WHERE customer_id = ?`,
      [customerId],
    );
    const items: WorksheetDepartment[] = [];
    for (const row of rows) {
      const parsed = parse<WorksheetDepartment>(row.payload_json);
      if (parsed) items.push(parsed);
    }
    return {
      items,
      /**
       * A LEGFRISSEBB MENTÉS IDEJE. Egy partner sorai EGY mentésből valók (a
       * frissítés törli és újraírja őket), tehát bármelyik sor ideje ugyanaz --
       * a maximum akkor is helyes, ha ez egyszer megváltozna.
       */
      syncedAt: rows.reduce<string | null>(
        (max, row) =>
          max === null || row.synced_at > max ? row.synced_at : max,
        null,
      ),
    };
  } catch {
    // Az olvasás hibája ÜRES másolatnak látszik, és az üres másolatot a felület
    // kimondja -- ez a csend tehát nem marad rejtve a szerelő elől.
    return { items: [], syncedAt: null };
  }
}

/**
 * KIJELENTKEZÉSKOR EZ IS MEGY. Partner-helyszínek nevei és kódjai ülnek benne,
 * és a telefon a következő kollégához is kerülhet -- ugyanaz az indok, mint az
 * eszköz-másolatnál.
 */
export async function forgetWorksheetDepartments(): Promise<void> {
  try {
    const db = await database();
    await db.execAsync(`DELETE FROM cached_worksheet_departments;`);
  } catch {
    // A kijelentkezés akkor is fusson végig, ha a helyi adatbázis nem nyitható.
  }
}

function parse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
