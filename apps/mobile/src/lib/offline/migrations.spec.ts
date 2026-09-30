import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DatabaseSync } from "node:sqlite";

import {
  LATEST_VERSION,
  MIGRATIONS,
  applyMigrations,
  firstBrokenStep,
  pendingMigrations,
  type Migration,
  type MigrationDatabase,
} from "./migrations";

/**
 * A KIHAGYOTT LEPES A TET, ES EGY LEPESSEL NEM MERHETO.
 *
 * Egy mechanizmus, ami CSAK az utolso lepest futtatja le, egyetlen lepes mellett
 * helyesnek latszik. A hiba a masodiktol kezdve all elo, es akkor sem hangosan:
 * egy keszulek, ahol a kozbenso lepes kimaradt, addig mukodik, amig egy
 * lekerdezes nem keresi a hianyzo oszlopot.
 */

const PROBA: Migration[] = [
  { version: 1, name: "elso", sql: "SELECT 1;" },
  { version: 2, name: "masodik", sql: "SELECT 2;" },
];

describe("a hátralévő lépések", () => {
  it("a NULLADIK verzióról MIND A KETTŐ hátravan, sorrendben", () => {
    /*
      EZ AZ ALLITAS A MODUL LETEZESENEK OKA. Egy valtozat, ami csak az utolsot
      adja vissza, IT PIROSODIK -- es egyedul itt: egy lepesnel meg zold lenne.
    */
    const h = pendingMigrations(0, PROBA);
    assert.deepEqual(
      h.map((m) => m.version),
      [1, 2],
    );
  });

  it("a MÁSODIKON állva nincs több teendő", () => {
    // ISMERT POZITIV KONTROLL: e nelkul egy "mindig mindent visszaad" valtozat
    // is atmenne a fenti allitason.
    assert.deepEqual(pendingMigrations(2, PROBA), []);
  });

  it("az ELSŐN állva csak a második van hátra", () => {
    const h = pendingMigrations(1, PROBA);
    assert.deepEqual(
      h.map((m) => m.version),
      [2],
    );
  });

  it("kevert sorrendű bemenetet is SORSZÁM szerint ad vissza", () => {
    // A lepesek listaja kezzel irodik. Egy rossz helyre beszurt lepes
    // sorrendben futna le rosszul -- es az `ALTER TABLE` utan futo `CREATE
    // INDEX` mas eredmenyt ad, mint forditva.
    const kevert = [PROBA[1]!, PROBA[0]!];
    assert.deepEqual(
      pendingMigrations(0, kevert).map((m) => m.version),
      [1, 2],
    );
  });
});

describe("a lépések épsége", () => {
  it("a mai lépéssor hézagmentes", () => {
    assert.equal(firstBrokenStep(), null);
    // ES VAN BENNE LEPES. Egy ures lista is hezagmentes -- ez a sor koti le,
    // hogy nem azt merjuk.
    assert.equal(MIGRATIONS.length >= 2, true);
    assert.equal(LATEST_VERSION, MIGRATIONS.length);
  });

  it("a KIHAGYOTT sorszámot megnevezi", () => {
    /*
      MI PIROSIT: ha valaki 1, 3 sorszammal ir be ket lepest. Akkor egy 2-es
      verzion allo keszulek a 3-ast lefuttatna, a `user_version` 3-ra ugrana, es
      a hianyzo 2-es lepes SOHA nem futna le rajta.
    */
    const hezagos: Migration[] = [
      { version: 1, name: "elso", sql: "SELECT 1;" },
      { version: 3, name: "harmadik", sql: "SELECT 3;" },
    ];
    assert.match(firstBrokenStep(hezagos) ?? "", /3\. lépés sorszáma hibás/);
  });

  it("a NULLÁRÓL induló sorszámot is elkapja", () => {
    const nullarol: Migration[] = [
      { version: 0, name: "nulla", sql: "SELECT 0;" },
    ];
    assert.notEqual(firstBrokenStep(nullarol), null);
  });
});

/**
 * A LEPESEK FUTTATASA VALODI SQLITE-ON (a node beepitett `node:sqlite`-ja).
 *
 * === A MERT HIBA (Balazs, 2026-09-30, Android) ===
 *
 * A helyszin letoltese utan terero nelkul a masolat URES volt, es az app
 * teljes ujrainditasa utan IS az maradt. Ujrainditas-allo hiba: a nyitas
 * minden alkalommal bukik. A jelolt: egy lepes oszlopa mar megvan, a
 * `user_version` viszont a lepes elotti -- mert a lepes es a verzio ket kulon
 * hivasban ment, es a kozos kapcsolaton koztuk egy masik tranzakcio
 * visszagorgethetett. Onnantol minden nyitas "duplicate column name" hibaval
 * all meg.
 */
function sqlite(): { db: DatabaseSync; adapter: MigrationDatabase } {
  const db = new DatabaseSync(":memory:");
  // a `database.ts` sema-blokkjanak sync_queue resze, a lepesek elotti alakban
  db.exec(`CREATE TABLE sync_queue (
    id TEXT PRIMARY KEY NOT NULL,
    operation TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  );`);
  const adapter: MigrationDatabase = {
    execAsync: async (source) => {
      db.exec(source);
    },
    getFirstAsync: async <T>(source: string) =>
      (db.prepare(source).get() as T | undefined) ?? null,
    getAllAsync: async <T>(source: string) => db.prepare(source).all() as T[],
  };
  return { db, adapter };
}

const verzio = (db: DatabaseSync) =>
  (db.prepare("PRAGMA user_version;").get() as { user_version: number })
    .user_version;
const oszlopok = (db: DatabaseSync) =>
  (
    db.prepare("PRAGMA table_info(sync_queue);").all() as { name: string }[]
  ).map((sor) => sor.name);

describe("a lépések futtatása valódi SQLite-on", () => {
  it("POZITÍV KONTROLL: üres adatbázison minden lépés lefut", async () => {
    const { db, adapter } = sqlite();
    await applyMigrations(adapter);
    assert.equal(verzio(db), LATEST_VERSION);
    for (const oszlop of [
      "state",
      "last_attempt_at",
      "depends_on_operation_id",
      "depends_on_target",
    ])
      assert.ok(oszlopok(db).includes(oszlop), `hianyzik: ${oszlop}`);
    assert.ok(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name = 'cached_service_jobs'",
        )
        .get(),
    );
  });

  /**
   * EZ A BERAGADT KESZULEK. Az 5-os lepes elso oszlopa megvan, a verzio 4.
   * A regi futtato ujra kiadta a teljes `ALTER TABLE`-t, es "duplicate column
   * name" hibaval megallt -- minden nyitasnal, ujrainditas utan is.
   *
   * MI PIROSIT: ha a lepes a mar meglevo oszlopot is hozza akarja adni.
   */
  it("egy félig lefutott lépés után is végigmegy, és a verzió a helyére kerül", async () => {
    const { db, adapter } = sqlite();
    db.exec(`
      ALTER TABLE sync_queue ADD COLUMN state TEXT NOT NULL DEFAULT 'pending';
      CREATE INDEX sync_queue_state ON sync_queue (state);
      ALTER TABLE sync_queue ADD COLUMN last_attempt_at TEXT;
      CREATE TABLE cached_service_jobs (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, synced_at TEXT NOT NULL);
      CREATE TABLE cached_service_job_details (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, synced_at TEXT NOT NULL);
      ALTER TABLE sync_queue ADD COLUMN depends_on_operation_id TEXT;
      PRAGMA user_version = 4;
    `);
    await applyMigrations(adapter);
    assert.equal(verzio(db), 5);
    assert.ok(oszlopok(db).includes("depends_on_target"));
    // es a kovetkezo nyitas mar semmit nem csinal, hiba nelkul
    await applyMigrations(adapter);
    assert.equal(verzio(db), 5);
  });

  /**
   * A LEPES ES A VERZIO EGYUTT, VAGY EGYIK SEM.
   *
   * MI PIROSIT: ha a lepes egy resze megmarad, vagy a tranzakcio nyitva marad
   * a kozos kapcsolaton.
   */
  it("egy elhasalt lépés nem hagy nyomot, és nem hagy nyitott tranzakciót", async () => {
    const { db, adapter } = sqlite();
    const lepesek: Migration[] = [
      {
        version: 1,
        name: "felig jo",
        sql: "CREATE TABLE felig (x TEXT); SELECT * FROM nincs_ilyen_tabla;",
      },
    ];
    await assert.rejects(
      applyMigrations(adapter, lepesek),
      /nincs_ilyen_tabla/,
    );
    assert.equal(verzio(db), 0);
    assert.equal(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'felig'").get(),
      undefined,
    );
    assert.equal(db.isTransaction, false);
  });
});
