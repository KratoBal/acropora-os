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
  /**
   * A MERT ELSO FUTAS ALAKJA -- ES A MERCE, AMIHEZ MAJD HASONLITUNK.
   *
   * A tobbi allitas EGY-EGY markan mutatja meg az osztalyozast. Ez az egyetlen,
   * ami az OSSZEGET rogziti, mert a kartya merceje osszeg: a stage adatbazison
   * merve (acrobot, 2026-09-15) 66 marka all, ebbol 65 aktiv es nem archivalt, es
   * a Medusan NULLA gyujtemeny van. Az elso valodi futasnak tehat ezt kell adnia:
   *
   *     create 65, skipArchived 1, minden mas ures
   *
   * AMIERT EZ NEM AZ EGYES ESETEK ISMETLESE: a 66-bol kieso EGYETLEN marka
   * EGYSZERRE inaktiv ES archivalt. A ket oszlopbol kivonassal KETTO jonne ki
   * (1 inaktiv + 1 archivalt), holott ugyanaz a rekord. A `skipArchived` ezert
   * EGY, nem ketto -- es ezt egyetlen korabbi allitas sem rogziti.
   *
   * IGY, HA A VALODI FUTAS MAST MOND, A KULONBSEG AZ ADATRA MUTAT, NEM A
   * LOGIKARA: a logika itt le van szogezve.
   */
  it("a mert kiindulo allapotra 65 letrehozast es 1 kihagyast ad", () => {
    const markak: OurBrand[] = [];
    for (let i = 1; i <= 65; i++)
      markak.push(
        brand({ id: `brand-${i}`, name: `Marka ${i}`, slug: `marka-${i}` }),
      );
    // A HATVANHATODIK: egyszerre inaktiv ES archivalt -- ez a mert eset.
    markak.push(
      brand({
        id: "brand-66",
        name: "Megszunt",
        slug: "megszunt",
        isActive: false,
        archivedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    );

    const terv = planBrandImport(markak, [], []);

    assert.equal(terv.create.length, 65);
    assert.deepEqual(terv.skipArchived, ["brand-66"]);
    assert.deepEqual(terv.mapOnly, []);
    assert.deepEqual(terv.skip, []);
    assert.deepEqual(terv.staleMapping, []);
    assert.deepEqual(terv.conflict, []);
  });

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
