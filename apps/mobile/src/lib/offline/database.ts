import * as SQLite from "expo-sqlite";

const DATABASE_NAME = "acropora-field.db";

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
  `);
  return database;
}
