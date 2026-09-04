import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  planBrandImport,
  type ExistingCollection,
  type OurBrand,
} from "./medusa-brand-plan.js";

const brand = (overrides: Partial<OurBrand> = {}): OurBrand => ({
  id: "brand-1",
  name: "Tunze",
  slug: "tunze",
  isActive: true,
  archivedAt: null,
  ...overrides,
});

const collection = (
  overrides: Partial<ExistingCollection> = {},
): ExistingCollection => ({
  id: "pcol_1",
  handle: "tunze",
  externalId: "brand-1",
  ...overrides,
});

describe("planBrandImport", () => {
  it("letrehozza azt a markat, ami egyik oldalon sincs", () => {
    const terv = planBrandImport([brand()], [], []);

    assert.deepEqual(terv.create, [
      { ourId: "brand-1", title: "Tunze", handle: "tunze" },
    ]);
    assert.deepEqual(terv.mapOnly, []);
    assert.deepEqual(terv.skip, []);
  });

  it("kihagyja azt, ami a Medusan is megvan es nalunk is le van kepezve", () => {
    const terv = planBrandImport(
      [brand()],
      [collection()],
      [{ ourId: "brand-1", medusaId: "pcol_1" }],
    );

    assert.deepEqual(terv.skip, ["brand-1"]);
    assert.deepEqual(terv.create, []);
  });

  /**
   * EZ AZ AZ ESET, AMI NELKUL DUPLIKATUMOT SZULNENK.
   *
   * A gyujtemeny mar all a Medusan, es a MI kulso azonositonkat viseli -- tehat
   * mi hoztuk letre egy korabbi futasban --, csak a lekepezes-sor veszett el
   * nalunk. Aki ilyenkor letrehoz, ket gyujtemenyt kap ugyanarra a markara.
   */
  it("csak osszekot, ha a gyujtemeny mar viseli a mi azonositonkat", () => {
    const terv = planBrandImport([brand()], [collection()], []);

    assert.deepEqual(terv.mapOnly, [{ ourId: "brand-1", medusaId: "pcol_1" }]);
    assert.deepEqual(terv.create, []);
  });

  it("elavultnak jelzi a sort, ha a Medusan mar nincs meg a gyujtemeny", () => {
    const terv = planBrandImport(
      [brand()],
      [],
      [{ ourId: "brand-1", medusaId: "pcol_regi" }],
    );

    assert.deepEqual(terv.staleMapping, ["brand-1"]);
    // Es letre is hozza: az elavult sor nem ok arra, hogy a marka kimaradjon.
    assert.deepEqual(terv.create, [
      { ourId: "brand-1", title: "Tunze", handle: "tunze" },
    ]);
  });

  /**
   * A HATODIK ESET, ES AZ EGYETLEN, AHOL MAGUNKTOL SEMMIT NEM TESZUNK.
   *
   * Ket gyujtemeny all a Medusan ugyanarra a markara: az egyikre a mi
   * lekepezes-sorunk mutat, a masik a mi kulso azonositonkat viseli. Egy
   * automata dontes kozuluk az egyiket csendben elarvitana.
   */
  it("utkozest jelent, ha a lekepezesunk mas gyujtemenyre mutat, mint amelyik az azonositonkat viseli", () => {
    const terv = planBrandImport(
      [brand()],
      [collection({ id: "pcol_uj" })],
      [{ ourId: "brand-1", medusaId: "pcol_regi" }],
    );

    assert.deepEqual(terv.conflict, [
      {
        ourId: "brand-1",
        mappedMedusaId: "pcol_regi",
        medusaIdCarryingOurId: "pcol_uj",
      },
    ]);
    assert.deepEqual(terv.create, []);
    assert.deepEqual(terv.skip, []);
  });

  it("nem viszi ki az inaktiv markat", () => {
    const terv = planBrandImport([brand({ isActive: false })], [], []);

    assert.deepEqual(terv.skipArchived, ["brand-1"]);
    assert.deepEqual(terv.create, []);
  });

  /**
   * ES A SZURO SORRENDJE MERT ALLITAS, NEM RESZLET.
   *
   * Egy MAR LEKEPEZETT, azota archivalt marka a `skip` agba esne, ha az
   * archivalas-szuro kesobb futna -- es akkor a jelentes azt mondana rola, hogy
   * rendben van. Igy viszont a sajat listajaban jelenik meg, es latszik, hogy
   * TUDATOSAN maradt ki.
   */
  it("az archivalt marka akkor is a sajat listajaba kerul, ha le van kepezve", () => {
    const terv = planBrandImport(
      [brand({ archivedAt: new Date("2026-09-01T00:00:00.000Z") })],
      [collection()],
      [{ ourId: "brand-1", medusaId: "pcol_1" }],
    );

    assert.deepEqual(terv.skipArchived, ["brand-1"]);
    assert.deepEqual(terv.skip, []);
  });

  /**
   * A KULSO AZONOSITO NELKULI GYUJTEMENY IDEGEN, ES NEM SZABAD RANYULNI.
   *
   * Egy kezzel letrehozott gyujtemeny ugyanazzal a handle-lel is allhat a
   * Medusan. Ha a terv a HANDLE alapjan kotne ossze, atvennenk valaki mas
   * munkajat -- ezert kizarolag a kulso azonosito szamit.
   */
  it("nem koti ossze a mi markankat egy idegen, azonos nevu gyujtemennyel", () => {
    const terv = planBrandImport(
      [brand()],
      [collection({ externalId: null })],
      [],
    );

    assert.deepEqual(terv.mapOnly, []);
    assert.deepEqual(terv.create, [
      { ourId: "brand-1", title: "Tunze", handle: "tunze" },
    ]);
  });
});
