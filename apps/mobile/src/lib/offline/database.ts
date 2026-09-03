import * as SQLite from "expo-sqlite";

import { firstBrokenStep, pendingMigrations } from "./migrations";

const DATABASE_NAME = "acropora-field.db";

/**
 * A KÉSZÜLÉKEN TÁROLT HELYSZÍNI MÁSOLAT.
 *
 * Két tábla, és a különbségük nem részletkérdés:
 *
 * - `cached_assets`: amit a LISTA visszaad. Minden aktív, szerviz partnerhez
 *   tartozó eszközről megvan, mert a lista végiggörgetésekor mentjük. Ebből a
 *   beolvasott QR-kód FELOLDHATÓ térerő nélkül is -- ezért van a `qr_token`
 *   külön oszlopban és indexen, nem csak a JSON-ben.
 * - `cached_asset_details`: a TELJES adatlap, de csak azokról az eszközökről,
 *   amiket valaki már megnyitott térerővel. Egy teljes letöltés eszközönként
 *   egy hívás lenne, ami egy nagyobb partnernél tíz percig tartana és a lista
 *   megnyitását tenné használhatatlanná.
 *
 * A kettő megkülönböztetése a felületen is látszik: a listából összerakott lap
 * HIÁNYOS, és a sáv kimondja (`offline-notice.ts`).
 *
 * - `cached_asset_owners` és `cached_partner_units`: az ESZKÖZ-FELVITEL két
 *   kötelező választója. Balázs 2026-09-03-án élesben mérte, hogy térerő nélkül
 *   nem tud eszközt felvinni: a rögzítés (a sor) MEGY offline, de az ŰRLAP két
 *   listája hálózatról jött, és e nélkül nincs mit választani. A sor tehát
 *   működött, a felvitel mégsem -- a réteg helyessége nem elég, ha a képernyő
 *   nem jut el odáig.
 *
 * - `cached_worksheet_details`: a MEGNYITOTT munkalap teljes adatlapja. A lap a
 *   MUNKAUTASITAS: terero nelkul ezt olvassa a szerelo a helyszinen.
 *
 * - `cached_worksheet_departments`: a munkalap HELYSZÍNEI partnerenként. Külön
 *   tábla, mert a helyszín-lista a munkalap `customerId` mezőjéhez tartozik, és
 *   NEM azonos a `partners.ts` alegység-hívásával: a két végpont más azonosítót
 *   vesz be. A felvitelnél a helyszín KÖTELEZŐ, tehát e nélkül a másolat nélkül
 *   a pincében nincs miből választani.
 *
 * ÚJ TÁBLÁT `CREATE TABLE IF NOT EXISTS` HOZ LÉTRE, ÉS EZ ITT HELYES -- a
 * sorszámozott lépések a MEGLÉVŐ táblák módosítására valók, mert azokat az
 * `IF NOT EXISTS` alak nem éri el. Egy táblát, ami sehol nem létezik, ez a sor
 * minden telepítésen létrehoz, a régieken is.
 *
 * A `sync_queue` az offline ÍRÁS sora, saját idempotencia-protokollal (lásd
 * `docs/MOBILE-DEVELOPMENT.md`).
 *
 * A SÉMA VÁLTOZÁSAI VISZONT MOSTANTÓL SORSZÁMOZOTT LÉPÉSEKBEN mennek, lásd
 * `applyMigrations` -- a `CREATE TABLE IF NOT EXISTS` egy MEGLÉVŐ táblát nem
 * módosít, tehát önmagában csak új telepítéseket ér el.
 */
export async function initializeOfflineDatabase(): Promise<SQLite.SQLiteDatabase> {
  const database = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY NOT NULL,
      operation TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS cached_assets (
      id TEXT PRIMARY KEY NOT NULL,
      qr_token TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS cached_assets_qr_token
      ON cached_assets (qr_token);

    CREATE TABLE IF NOT EXISTS cached_asset_details (
      id TEXT PRIMARY KEY NOT NULL,
      qr_token TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS cached_asset_details_qr_token
      ON cached_asset_details (qr_token);

    CREATE TABLE IF NOT EXISTS cached_worksheet_details (
      id TEXT PRIMARY KEY NOT NULL,
      payload_json TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cached_worksheet_departments (
      id TEXT PRIMARY KEY NOT NULL,
      customer_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS cached_worksheet_departments_customer
      ON cached_worksheet_departments (customer_id);

    CREATE TABLE IF NOT EXISTS cached_asset_owners (
      id TEXT PRIMARY KEY NOT NULL,
      payload_json TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cached_partner_units (
      id TEXT PRIMARY KEY NOT NULL,
      partner_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS cached_partner_units_partner
      ON cached_partner_units (partner_id);
  `);
  await applyMigrations(database);
  return database;
}

/**
 * A SORSZAMOZOTT LEPESEK LEFUTTATASA, EGYSZER MINDEGYIK.
 *
 * A verziot az SQLite sajat `user_version` pragmaja tarolja -- KULON
 * nyilvantartas, nem a sema alakjabol olvasva. A "letezik-e mar az oszlop"
 * alaku ellenorzes ugyanaz a csapda, mint a `CREATE TABLE IF NOT EXISTS`:
 * egyetlen lepesnel mukodik, ketto utan mar nem mondja meg, hol tartunk.
 *
 * A LEPESEK MIND LEFUTNAK, NEM CSAK AZ UTOLSO. Egy nulladik verzion allo
 * keszuleknek a masodikig kell eljutnia, es a kozbenso lepes kihagyasa
 * CSENDES: az adatbazis mukodik, amig egy lekerdezes nem keresi a hianyzo
 * oszlopot. A `pendingMigrations` epp ezt a tulajdonsagot hordozza, es a
 * specje ket lepessel meri -- eggyel nem lenne merheto.
 *
 * A verziot LEPESENKENT irjuk fel, nem a vegen egyszer: ha a masodik lepes
 * elhasal, az elso akkor is megtortent, es egy vegen felirt verzio ezt
 * elfelejtene -- a kovetkezo indulas ujra futtatna az elsot.
 */
async function applyMigrations(database: SQLite.SQLiteDatabase): Promise<void> {
  const torott = firstBrokenStep();
  if (torott) {
    /**
     * HEZAGOS LEPESSOR ESETEN MEG SEM KEZDJUK. Egy kihagyott sorszam mellett a
     * `user_version` atugorhat egy lepest, es az azon a keszuleken SOHA nem fut
     * le tobbe. Jobb itt megallni, mint felig migralt adatbazissal indulni.
     */
    throw new Error(`Hibás migrációs lépéssor: ${torott}`);
  }
  const sor = await database.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version;",
  );
  const jelenlegi = sor?.user_version ?? 0;
  for (const lepes of pendingMigrations(jelenlegi)) {
    await database.execAsync(lepes.sql);
    await database.execAsync(`PRAGMA user_version = ${lepes.version};`);
  }
}
