import * as SQLite from "expo-sqlite";

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
 * A `sync_queue` tábla változatlan, és ma sem hív senki: az offline ÍRÁS külön
 * munka, saját idempotencia-protokollal (lásd `docs/MOBILE-DEVELOPMENT.md`).
 * A helyszíni katalógus szándékosan csak OLVAS.
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
  `);
  return database;
}
