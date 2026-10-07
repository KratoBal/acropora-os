import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { FIELD_SPECS } from "@acropora/jev/product-enrichment";

import {
  ATTRIBUTE_DEFINITIONS,
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
const by = new Map(ATTRIBUTE_DEFINITIONS.map((d) => [d.key, d]));

describe("attribute definitions vs FIELD_SPECS", () => {
  it("every fact key has exactly one definition, the copy keys none", () => {
    assert.equal(TENY_KULCSOK.length, 25);
    assert.deepEqual(
      [...ATTRIBUTE_DEFINITIONS.map((d) => d.key)].sort(),
      [...TENY_KULCSOK].sort(),
    );
    assert.equal(by.size, ATTRIBUTE_DEFINITIONS.length);
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
        "20261007140000_attribute_model",
        "migration.sql",
      ),
      "utf8",
    );
    assert.ok(
      migracio.includes(seedSql()),
      "the migration's INSERT is not seedSql()",
    );
  });
});
