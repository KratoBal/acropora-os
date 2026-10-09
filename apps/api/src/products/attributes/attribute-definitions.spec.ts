import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { FIELD_SPECS } from "@acropora/jev/product-enrichment";

import {
  ATTRIBUTE_DEFINITION_ADDITIONS,
  ATTRIBUTE_DEFINITION_CHANGES,
  additionSql,
  ATTRIBUTE_DEFINITIONS,
  CURRENT_ATTRIBUTE_DEFINITIONS,
  changeSql,
  COPY_KEYS,
  DIMENSION_UNIT,
  KIND_DATA_TYPE,
  seedSql,
} from "./attribute-definitions.js";

/**
 * AZ EGYEZESI TESZT (SEO P0 PR 2, C1 es a 3. dontes): minden `FIELD_SPECS`
 * teny-kulcshoz van definicio, ILLESZKEDO tipussal, egy EXPLICIT lekepezo
 * tablahoz merve; a szoveg-jellegu kulcsoknak nincs. Es a migracio pontosan ezt
 * a seedet irja be.
 *
 * MI PIROSIT: egy uj `FIELD_SPECS` teny-kulcs definicio nelkul; egy kulcs mas
 * tipussal vagy egyseggel; egy nem `public` seed-sor (a kapu elvenne a mai
 * tenyt); a migracio es a modul elcsuszasa.
 */
const SPECS = FIELD_SPECS as Record<
  string,
  { tier: string; claims: string; kind: { kind: string; dimension?: string } }
>;
const TENY_KULCSOK = Object.keys(SPECS).filter(
  (k) => !(COPY_KEYS as readonly string[]).includes(k),
);
// a MAI definiciok (a seed es a kesobbi hozzaadasok): ezekhez mer a teny-kulcs lista
const by = new Map(CURRENT_ATTRIBUTE_DEFINITIONS.map((d) => [d.key, d]));

describe("attribute definitions vs FIELD_SPECS", () => {
  it("every fact key has exactly one definition, the copy keys none", () => {
    assert.equal(TENY_KULCSOK.length, 26);
    assert.deepEqual(
      [...CURRENT_ATTRIBUTE_DEFINITIONS.map((d) => d.key)].sort(),
      [...TENY_KULCSOK].sort(),
    );
    assert.equal(by.size, CURRENT_ATTRIBUTE_DEFINITIONS.length);
    for (const k of COPY_KEYS) assert.equal(by.has(k), false, k);
    // a ket, az elso valtozatbol kimaradt kulcs (C1)
    assert.ok(by.has("manufacturerInfo") && by.has("manufacturerClaims"));
  });

  it("the data type, dimension and unit follow the explicit kind table", () => {
    for (const key of TENY_KULCSOK) {
      const spec = SPECS[key]!;
      const d = by.get(key)!;
      assert.equal(
        d.dataType,
        KIND_DATA_TYPE[spec.kind.kind as keyof typeof KIND_DATA_TYPE],
        key,
      );
      if (spec.kind.kind === "quantity") {
        const du =
          DIMENSION_UNIT[spec.kind.dimension as keyof typeof DIMENSION_UNIT];
        assert.equal(d.dimension, du.dimension, key);
        assert.equal(d.canonicalUnit, du.unit, key);
      }
      assert.equal(d.tier, spec.tier, key);
      assert.equal(d.claimPolicy, spec.claims.toUpperCase(), key);
    }
  });

  it("the named decisions hold", () => {
    assert.equal(by.get("dosing")!.dataType, "DOSE"); // 2. dontes
    assert.equal(by.get("ean")!.dataType, "STRING"); // 3.
    assert.equal(by.get("manufacturerSku")!.dataType, "STRING");
    assert.equal(by.get("brand")!.dataType, "TEXT"); // 4.
    assert.equal(by.get("packSize")!.dataType, "TEXT"); // 8.
    assert.equal(by.get("packSize")!.scope, "PRODUCT");
    assert.equal(by.get("volume")!.label, "Űrtartalom");
    assert.equal(by.get("flowRate")!.label, "Áramlás");
    assert.equal(by.get("power")!.label, "Teljesítményfelvétel");
    assert.deepEqual(by.get("voltage")!.validation, {
      unitQualifiers: ["AC", "DC"],
    });
    for (const k of ["manufacturerInfo", "manufacturerClaims"]) {
      assert.equal(by.get(k)!.aiVisible, true, k);
      assert.equal(by.get(k)!.merchantVisible, false, k);
    }
    for (const k of ["weight", "lengthMm", "widthMm", "heightMm"])
      assert.equal(by.get(k)!.scope, "VARIANT", k);
  });

  it("every seeded definition is public: the gate takes no fact away today", () => {
    for (const d of ATTRIBUTE_DEFINITIONS) assert.equal(d.public, true, d.key);
  });

  it("the migration inserts exactly this seed", () => {
    // az ut az `apps/api`-hoz kepest (ES modul: nincs `__dirname`; a teszt-parancs
    // innen fut, mint a `worksheet-document-migration.spec.ts`-nel)
    const migracio = readFileSync(
      join(
        "..",
        "..",
        "packages",
        "database",
        "prisma",
        "migrations",
        "20261007160000_attribute_model",
        "migration.sql",
      ),
      "utf8",
    );
    assert.ok(
      migracio.includes(seedSql()),
      "the migration's INSERT is not seedSql()",
    );
  });

  /*
    A SEED UTANI VALTOZASOK (SEO P0 PR 4). MI PIROSIT: egy valtozas migracioja
    nem pontosan azt az UPDATE-et irja, amit a lista mond; az `ean` a mai
    allapotban teny maradna (PRODUCT, nem VARIANT_BARCODE, public); egy masik
    definicio is elvesztene a `public` jelet.
  */
  it("every change's migration holds exactly its UPDATE", () => {
    assert.ok(ATTRIBUTE_DEFINITION_CHANGES.length > 0);
    for (const c of ATTRIBUTE_DEFINITION_CHANGES) {
      const migracio = readFileSync(
        join(
          "..",
          "..",
          "packages",
          "database",
          "prisma",
          "migrations",
          c.migration,
          "migration.sql",
        ),
        "utf8",
      );
      assert.ok(migracio.includes(changeSql(c)), c.migration);
    }
  });

  /*
    A SEED UTAN FELVETT DEFINICIOK (kartya 2b3983e1). MI PIROSIT: a migracio nem
    pontosan azt az INSERT-et irja, amit a lista mond.
  */
  it("every addition's migration holds exactly its INSERT", () => {
    assert.ok(ATTRIBUTE_DEFINITION_ADDITIONS.length > 0);
    for (const a of ATTRIBUTE_DEFINITION_ADDITIONS) {
      const migracio = readFileSync(
        join(
          "..",
          "..",
          "packages",
          "database",
          "prisma",
          "migrations",
          a.migration,
          "migration.sql",
        ),
        "utf8",
      );
      assert.ok(migracio.includes(additionSql(a)), a.migration);
      // egy hozzaadas nem lehet a seedben is: akkor ket migracio irna egy kulcsot
      assert.equal(
        ATTRIBUTE_DEFINITIONS.some((d) => d.key === a.definition.key),
        false,
        a.definition.key,
      );
    }
  });

  it("the water parameter effects are the recommendation's input, not a shop fact", () => {
    const d = by.get("waterParameterEffects")!;
    assert.deepEqual(
      [
        d.dataType,
        d.tier,
        d.claimPolicy,
        d.public,
        d.aiVisible,
        d.merchantVisible,
      ],
      ["TEXT", "C", "VALUE", false, true, false],
    );
  });

  it("today the ean is a per-variant barcode, not a public fact; nothing else changed", () => {
    const ean = CURRENT_ATTRIBUTE_DEFINITIONS.find((d) => d.key === "ean")!;
    assert.deepEqual(
      [ean.scope, ean.medusaNativeField, ean.public],
      ["VARIANT", "VARIANT_BARCODE", false],
    );
    assert.deepEqual(
      CURRENT_ATTRIBUTE_DEFINITIONS.filter((d) => !d.public).map((d) => d.key),
      ["ean", "waterParameterEffects"],
    );
    assert.equal(
      CURRENT_ATTRIBUTE_DEFINITIONS.length,
      ATTRIBUTE_DEFINITIONS.length + ATTRIBUTE_DEFINITION_ADDITIONS.length,
    );
  });
});
