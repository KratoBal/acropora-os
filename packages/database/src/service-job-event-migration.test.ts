import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A MIGRACIO SZOVEGET MERI, NEM AZ ADATBAZIS ALLAPOTAT -- es ezt ki kell
 * mondani, mert a ketto nem ugyanaz.
 *
 * Amit ez az allitas-keszlet meg tud fogni: ha valaki ugy szerkeszti at ezt a
 * migraciot (vagy ir helyette masikat), hogy a meglevo sorok fajtaja mar nem
 * KIMONDOTT, hanem egy masik mezobol kovetkeztetheto. Ez az ADR-013 lenyege,
 * es a szerkezete olyan, hogy egy elrontasa NEM okoz hibauzenetet sehol:
 * az adatbazis a hianyt ervenyes allapotnak latja.
 *
 * Amit NEM tud megfogni: hogy a migracio le is fut a Postgresen. Azt a CI
 * `prisma migrate deploy` lepese meri, ezen a gepen nincs adatbazis.
 */
const migration = readFileSync(
  new URL(
    "../prisma/migrations/20260902170000_service_job_event_kind/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

/** Szokoz-fuggetlen osszehasonlitas: a formazas ne dontson el egy allitast. */
function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ");
}

describe("ServiceJobEvent kind migration", () => {
  /**
   * EZ AZ AZ ALLITAS, AMI A MEGLEVO SOROKROL SZOL.
   *
   * A migracio pillanataban minden tarolt sor allapotvaltas volt. Ha az uj
   * oszlop nullazhato lenne (vagy alapertek nelkul allna), a regi sorok
   * fajtaja NEM lenne kimondva, csak kikovetkeztetheto -- pontosan az az
   * allapot, amit az ADR-013 megszuntet.
   */
  it("keeps every existing row explicitly a status change", () => {
    assert.match(
      normalize(migration),
      /ADD COLUMN "kind" "ServiceJobEventKind" NOT NULL DEFAULT 'STATUS_CHANGE'/,
    );
  });

  /**
   * A `kind` onmagaban csak CIMKE volna a sor mellett. A CHECK teszi
   * szaballya: egy cel-allapot nelkuli allapotvaltas nem keletkezhet.
   */
  it("refuses a status change that has no target status", () => {
    assert.match(
      normalize(migration),
      /CHECK \( \("kind" = 'STATUS_CHANGE' AND "toStatus" IS NOT NULL/,
    );
  });

  /**
   * A masik irany ugyanennyire szamit: egy munkalap-esemeny munkalap nelkul
   * olyan naplo-sor lenne, ami nem mondja meg, MIROL szol.
   */
  it("refuses a worksheet event that names no worksheet", () => {
    assert.match(
      normalize(migration),
      /'WORKSHEET_ATTACHED', 'WORKSHEET_DETACHED'\) AND "toStatus" IS NULL AND "worksheetId" IS NOT NULL/,
    );
  });

  /**
   * A `toStatus` nullazhatova valik -- ez kell a munkalap-esemenyekhez. A
   * fajtat viszont NEM ez jelzi: ezert all mellette a fenti ket CHECK-ag.
   */
  it("lets a non-status event leave the target status empty", () => {
    assert.match(normalize(migration), /ALTER COLUMN "toStatus" DROP NOT NULL/);
  });
});
