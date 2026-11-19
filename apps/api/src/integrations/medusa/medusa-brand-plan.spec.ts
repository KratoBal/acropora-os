import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  handleContentCandidates,
  planBrandImport,
  type ExistingCollection,
  type HandleContent,
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

  /*
    A HANDLE UTKOZESE (kartya ec82b629, merve a teszt kirakaton: a `fauna-marin` handle mar letezett, a letrehozas elbukott, es a
    hiba az egesz lepest leallitotta). A korabbi alak (ennek a tesztnek az elodje) azt allitotta, hogy az azonos handle-u,
    kulso azonosito nelkuli gyujtemeny NEM kotheto ossze, hanem letre kell hozni a markat -- vagyis a Medusa elutasitasat
    varta el. Az elvaras HAMIS volt, nem a kod: a Medusan egy handle egyedi, a letrehozas az utkozesre bukik. A VEDELEM, amit az
    elodje orzott (egy idegen gyujtemenyt ne vegyunk at), ma ket allitasban el: a masik marka azonositojat viselo gyujtemeny
    NEM kotheto ossze (`handleTaken`), es az elavult sor melle sem kotunk automatikusan. ES A HARMADIK (acrobot dontese,
    2026-11-19 16:24, 57247): az azonosito nelkuli gyujtemenyt csak akkor kotjuk ossze, ha URES, vagy minden termeke ennek a
    markanak a termeke; mas markaju vagy ismeretlen termekkel kezi valogatas lehet (`curated`), tartalom nelkul pedig nem dont
    (`content-unchecked`). MI PIROSIT: ha a vegyes gyujtemeny osszekotodik; ha tartalom nelkul osszekotodik; ha az ures vagy
    azonos markaju nem kotodik ossze; ha barmelyik esetben letrehozas indul.
  */
  const tartalom = (
    over: Partial<HandleContent> = {},
  ): Map<string, HandleContent> =>
    new Map([
      [
        "pcol_1",
        { total: 3, sameBrand: 3, otherBrand: 0, unknown: 0, ...over },
      ],
    ]);

  it("az azonos handle-u, kulso azonosito nelkuli gyujtemenyhez osszekot, ha csak ennek a markanak a termekei allnak benne", () => {
    const terv = planBrandImport(
      [brand()],
      [collection({ externalId: null })],
      [],
      tartalom(),
    );

    assert.deepEqual(terv.mapOnly, [{ ourId: "brand-1", medusaId: "pcol_1" }]);
    assert.deepEqual(terv.mapByHandle, ["brand-1"]);
    assert.deepEqual(terv.create, []);
    assert.deepEqual(terv.handleTaken, []);
  });

  it("az ures, azonos handle-u gyujtemenyhez is osszekot", () => {
    const terv = planBrandImport(
      [brand()],
      [collection({ externalId: null })],
      [],
      tartalom({ total: 0, sameBrand: 0 }),
    );

    assert.deepEqual(terv.mapByHandle, ["brand-1"]);
    assert.deepEqual(terv.create, []);
  });

  it("mas markaju termekkel a gyujtemeny kezi valogatas lehet: foglalt handle, nem kotunk ossze es nem hozunk letre", () => {
    const terv = planBrandImport(
      [brand()],
      [collection({ externalId: null })],
      [],
      tartalom({ sameBrand: 2, otherBrand: 1 }),
    );

    assert.deepEqual(
      terv.handleTaken.map((h) => [h.ourId, h.reason]),
      [["brand-1", "curated"]],
    );
    assert.deepEqual(terv.mapOnly, []);
    assert.deepEqual(terv.mapByHandle, []);
    assert.deepEqual(terv.create, []);
  });

  it("az ismeretlen markaju termek ugyanugy tart, mint a mas markaju", () => {
    const terv = planBrandImport(
      [brand()],
      [collection({ externalId: null })],
      [],
      tartalom({ sameBrand: 2, unknown: 1 }),
    );

    assert.deepEqual(
      terv.handleTaken.map((h) => h.reason),
      ["curated"],
    );
    assert.deepEqual(terv.mapOnly, []);
  });

  it("tartalom nelkul nem dont: nem ellenorzott, es a jeloltek kozott all", () => {
    const terv = planBrandImport(
      [brand()],
      [collection({ externalId: null })],
      [],
    );

    assert.deepEqual(
      terv.handleTaken.map((h) => h.reason),
      ["content-unchecked"],
    );
    assert.deepEqual(terv.mapOnly, []);
    assert.deepEqual(terv.create, []);
    assert.deepEqual(handleContentCandidates(terv), [
      { collectionId: "pcol_1", brandId: "brand-1" },
    ]);
  });

  it("az osszekotes utan a kovetkezo kor mar nem csinal semmit (a lekepezes-sor ervenyes, a gyujtemeny kulso azonosito nelkul is)", () => {
    const terv = planBrandImport(
      [brand()],
      [collection({ externalId: null })],
      [{ ourId: "brand-1", medusaId: "pcol_1" }],
    );

    assert.deepEqual(terv.skip, ["brand-1"]);
    assert.deepEqual(terv.create, []);
    assert.deepEqual(terv.staleMapping, []);
    assert.deepEqual(terv.mapOnly, []);
  });

  it("a masik marka azonositojat viselo, azonos handle-u gyujtemenyt nem vesszuk at: foglalt handle, nem hozunk letre", () => {
    const terv = planBrandImport(
      // a brand-2 MAI markank (archivalt): a gyujtemenye az ove, nem halott azonosito
      [
        brand(),
        brand({ id: "brand-2", name: "Masik", slug: "masik", isActive: false }),
      ],
      [collection({ externalId: "brand-2" })],
      [],
    );

    assert.deepEqual(terv.handleTaken, [
      {
        ourId: "brand-1",
        handle: "tunze",
        medusaId: "pcol_1",
        reason: "other-brand",
      },
    ]);
    assert.deepEqual(terv.create, []);
    assert.deepEqual(terv.mapOnly, []);
  });

  it("az elavult sor melle egy szabad, azonos handle-u gyujtemenyt nem kotunk automatikusan", () => {
    const terv = planBrandImport(
      [brand()],
      [collection({ id: "pcol_9", externalId: null })],
      [{ ourId: "brand-1", medusaId: "pcol_gone" }],
    );

    assert.deepEqual(terv.handleTaken, [
      {
        ourId: "brand-1",
        handle: "tunze",
        medusaId: "pcol_9",
        reason: "stale-mapping",
      },
    ]);
    assert.deepEqual(terv.create, []);
    assert.deepEqual(terv.staleMapping, []);
  });

  it("az a sor, ami egy masik marka azonositojat viselo gyujtemenyre mutat, foglalt, nem ervenyes", () => {
    const terv = planBrandImport(
      // a brand-2 MAI markank (archivalt): a gyujtemenye az ove, nem halott azonosito
      [
        brand(),
        brand({ id: "brand-2", name: "Masik", slug: "masik", isActive: false }),
      ],
      [collection({ externalId: "brand-2" })],
      [{ ourId: "brand-1", medusaId: "pcol_1" }],
    );

    assert.deepEqual(
      terv.handleTaken.map((h) => h.reason),
      ["mapped-to-other-brand"],
    );
    assert.deepEqual(terv.skip, []);
  });

  it("az elavult sor (a cel gyujtemeny nincs a Medusan) tovabbra is ujra letrehozast ad, ha a handle szabad", () => {
    const terv = planBrandImport(
      [brand()],
      [],
      [{ ourId: "brand-1", medusaId: "pcol_gone" }],
    );

    assert.deepEqual(terv.staleMapping, ["brand-1"]);
    assert.deepEqual(terv.create, [
      { ourId: "brand-1", title: "Tunze", handle: "tunze" },
    ]);
  });

  it("egy foglalt handle egy markat visz el, a tobbit nem (egy menetben a masik letrejon)", () => {
    const terv = planBrandImport(
      [
        brand(),
        brand({ id: "brand-3", name: "Fauna Marin", slug: "fauna-marin" }),
        brand({ id: "brand-2", name: "Masik", slug: "masik", isActive: false }),
      ],
      [collection({ externalId: "brand-2" })],
      [],
    );

    assert.deepEqual(
      terv.handleTaken.map((h) => h.ourId),
      ["brand-1"],
    );
    assert.deepEqual(
      terv.create.map((c) => c.ourId),
      ["brand-3"],
    );
  });

  /*
    A HALOTT AZONOSITO (merve a teszt kirakaton 2026-11-19 15:51 UTC): a 09-15-i gyujtemenyek a 09-25-i OS-ujratoltes elotti
    marka-azonositokat viselik. MI PIROSIT: ha a sajat, lekepezett gyujtemenyunk halott azonositoval "masik marka" lesz (a mert
    59 hamis utkozes); ha a halott azonositoju, azonos handle-u gyujtemeny utkozes lesz a tartalmi feltetel helyett.
  */
  it("a sajat sorunk celja halott azonositot visel: ervenyes sor, skip, nem utkozes", () => {
    const terv = planBrandImport(
      [brand()],
      [collection({ externalId: "cmtr-regi-azonosito" })],
      [{ ourId: "brand-1", medusaId: "pcol_1" }],
    );

    assert.deepEqual(terv.skip, ["brand-1"]);
    assert.deepEqual(terv.handleTaken, []);
    assert.deepEqual(terv.create, []);
  });

  it("a halott azonositoju, azonos handle-u gyujtemeny a tartalmi feltetelre megy, nem utkozes", () => {
    const nelkule = planBrandImport(
      [brand()],
      [collection({ externalId: "cmtr-regi-azonosito" })],
      [],
    );
    assert.deepEqual(
      nelkule.handleTaken.map((h) => h.reason),
      ["content-unchecked"],
    );

    const tartalommal = planBrandImport(
      [brand()],
      [collection({ externalId: "cmtr-regi-azonosito" })],
      [],
      new Map([
        ["pcol_1", { total: 4, sameBrand: 4, otherBrand: 0, unknown: 0 }],
      ]),
    );
    assert.deepEqual(tartalommal.mapByHandle, ["brand-1"]);
    assert.deepEqual(tartalommal.handleTaken, []);
  });
});
