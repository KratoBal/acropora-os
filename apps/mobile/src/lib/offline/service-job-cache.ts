import type {
  ServiceJobDetail,
  ServiceJobListItem,
} from "@/lib/api/service-jobs";

import { initializeOfflineDatabase } from "./database";

/**
 * A HIBAJEGYEK HELYSZÍNI MÁSOLATA -- CSAK OLVASÁSRA, ÉS EZ DÖNTÉS.
 *
 * Amit ide mentünk: a lista sorai (minden lehúzott jegyről), és a teljes lap
 * arról, amit valaki megnyitott térerővel. Ugyanaz az alak, mint az eszköznél.
 *
 * AMI IDE NEM KERÜL, ÉS AMIÉRT NEM: a LÉPTETÉS. A szerver a LÁTOTT állapotra ír
 * feltételesen -- ha közben más lépett, 409-et ad, nem ír felül csendben. Ez jó,
 * de épp ezért egy sorba tett lépés a sor kiürítésekor bukna el, órákkal később,
 * amikor a szerelő már nincs a gépnél. Az eszköz-út ehhez egy egész alrendszert
 * épített (alapértékek a sorban + feloldó képernyő); amíg az a jegyre nincs meg,
 * a jegy térerő nélkül OLVASHATÓ, de nem léptethető.
 *
 * ÉS EZT A SÁV KIMONDJA. A mentett másolat soha nem néma: egy gomb, ami nem
 * működik, ugyanúgy néz ki, mint egy elromlott.
 *
 * A HIBA ITT NEM DOBÓDIK TOVÁBB, ugyanúgy, mint az eszköz-másolatnál: egy
 * elhasalt mentés nem ronthat el egy működő, online képernyőt. Az olvasás hibája
 * üres másolatnak látszik -- és az üreset a felület kimondja.
 */

type Database = Awaited<ReturnType<typeof initializeOfflineDatabase>>;

let opening: Promise<Database> | null = null;

function database(): Promise<Database> {
  opening ??= initializeOfflineDatabase();
  return opening;
}

export interface CachedServiceJobs {
  items: ServiceJobListItem[];
  /** A legfrissebb mentés ideje, ISO alakban. `null`, ha nincs másolat. */
  syncedAt: string | null;
}

export interface CachedServiceJob {
  detail: ServiceJobDetail | null;
  summary: ServiceJobListItem | null;
  syncedAt: string | null;
}

function parse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export async function rememberServiceJobs(
  items: readonly ServiceJobListItem[],
): Promise<void> {
  if (items.length === 0) return;
  const savedAt = new Date().toISOString();
  try {
    const db = await database();
    await db.withTransactionAsync(async () => {
      for (const item of items) {
        await db.runAsync(
          `INSERT INTO cached_service_jobs (id, payload_json, synced_at)
           VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             payload_json = excluded.payload_json,
             synced_at = excluded.synced_at`,
          [item.id, JSON.stringify(item), savedAt],
        );
      }
    });
  } catch {
    // Lásd a modul fejlécét.
  }
}

export async function rememberServiceJobDetail(
  detail: ServiceJobDetail,
): Promise<void> {
  const savedAt = new Date().toISOString();
  try {
    const db = await database();
    await db.runAsync(
      `INSERT INTO cached_service_job_details (id, payload_json, synced_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         payload_json = excluded.payload_json,
         synced_at = excluded.synced_at`,
      [detail.id, JSON.stringify(detail), savedAt],
    );
    /**
     * A LAP A LISTASORT IS NAPRAKÉSZEN TARTJA. Aki megnyitott egy jegyet, annak
     * a listán se a tegnapi állapota jöjjön elő -- és a léptetés UTÁN ez a
     * mentés az, ami a listát is előreviszi.
     *
     * A `detail` A LISTASOR MEZŐINEK CSAK EGY RÉSZÉT HORDOZZA -- MÉRVE
     * 2026-09-22: a `worksheetCount`-ot a szerver a lap-válaszban SOHA nem
     * küldi (lásd `ServiceJobDetail` fejlécét a `packages/types`-ban). A régi
     * alak ezt a mezőt `undefined`-ként írta a listasorba, és a lista utána
     * csendben "0 munkalap"-ot mutatott, akkor is, ha valójában volt. A
     * fordító EZT a hiányt fogta meg, amikor a két alak szétvált -- pontosan
     * úgy, ahogy ez a megjegyzés korábban megígérte.
     *
     * A JAVÍTÁS: a hiányzó mezőt a MÁR MEGLÉVŐ listasorból vesszük át. Ha
     * nincs korábbi sor (a jegyet még sosem húzta le a lista), a szám 0 --
     * ez ugyanaz a hiányos állapot, ami korábban is fennállt, csak most
     * KIMONDOTTAN, nem `undefined`-ből fakadó véletlenül.
     */
    const korabbiSor = await db.getFirstAsync<{ payload_json: string }>(
      `SELECT payload_json FROM cached_service_jobs WHERE id = ?`,
      [detail.id],
    );
    const korabbiSzam =
      (korabbiSor && parse<ServiceJobListItem>(korabbiSor.payload_json))
        ?.worksheetCount ?? 0;
    await rememberServiceJobs([{ ...detail, worksheetCount: korabbiSzam }]);
  } catch {
    // Ugyanaz, mint fent.
  }
}

export async function readCachedServiceJobs(): Promise<CachedServiceJobs> {
  try {
    const db = await database();
    const rows = await db.getAllAsync<{
      payload_json: string;
      synced_at: string;
    }>(
      `SELECT payload_json, synced_at FROM cached_service_jobs
       ORDER BY synced_at DESC`,
    );
    const items = rows
      .map((row) => parse<ServiceJobListItem>(row.payload_json))
      .filter((item): item is ServiceJobListItem => item !== null);
    return { items, syncedAt: rows[0]?.synced_at ?? null };
  } catch {
    return { items: [], syncedAt: null };
  }
}

export async function readCachedServiceJob(
  id: string,
): Promise<CachedServiceJob> {
  try {
    const db = await database();
    const lap = await db.getFirstAsync<{
      payload_json: string;
      synced_at: string;
    }>(
      `SELECT payload_json, synced_at FROM cached_service_job_details WHERE id = ?`,
      [id],
    );
    const sor = await db.getFirstAsync<{
      payload_json: string;
      synced_at: string;
    }>(`SELECT payload_json, synced_at FROM cached_service_jobs WHERE id = ?`, [
      id,
    ]);
    return {
      detail: lap ? parse<ServiceJobDetail>(lap.payload_json) : null,
      summary: sor ? parse<ServiceJobListItem>(sor.payload_json) : null,
      /**
       * A FRISSEBBIK IDŐPONT, NEM A LAPÉ. A szerelőnek az számít, milyen RÉGI
       * az, amit lát; ha a listát ma húzta le és a lapot tegnap nyitotta meg,
       * a "tegnapi" felirat a lista mellett hamis lenne.
       */
      syncedAt:
        [lap?.synced_at, sor?.synced_at]
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1) ?? null,
    };
  } catch {
    return { detail: null, summary: null, syncedAt: null };
  }
}

/** Kijelentkezéskor minden törlődik: partner-adatok vannak benne. */
export async function forgetOfflineServiceJobs(): Promise<void> {
  try {
    const db = await database();
    await db.execAsync(
      `DELETE FROM cached_service_job_details; DELETE FROM cached_service_jobs;`,
    );
  } catch {
    // Lásd a modul fejlécét.
  }
}
