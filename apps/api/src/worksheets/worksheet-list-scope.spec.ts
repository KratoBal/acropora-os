import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { worksheetListWheres } from "./worksheets.repository.js";

/**
 * A SZAMLALO NEM VESZITHETI EL A LATHATOSAGI HATART.
 *
 * A lista folott allapot-csempek allnak, es a szamokat MAS lekerdezes adja,
 * mint a sorokat. Ha a jogosultsagi szuro csak az egyikbol marad ki, a csempek
 * IDEGEN PARTNER munkalapjait szamoljak meg: a lista helyes marad, a szam
 * folotte nem, es a kepernyon semmi nem arulja el.
 *
 * A HIBAJEGYEKNEL LEIRT MINTA ITT FELREVEZET: ott a szamlalo "szandekosan nem
 * kap scope-ot", mert OTT a `scope` a felhasznalo sajat szukitese. ITT a
 * `PartnerScope` a lathatosagi hatar. Ugyanaz a szo, mas jelentes.
 *
 * AMI ITT SZANDEKOSAN NINCS: annak ellenorzese, hogy a hatokor-hivas `AND`
 * agkent all. Azt a `auth/partner-scope-and-branch.spec.ts` oriz, forrasbol,
 * MINDEN hivasi helyen -- erosebben, mint egy futasideju allitas. Ez a spec
 * azt meri, ami uj: hogy a SZAMLALO is megkapja.
 */
describe("worksheetListWheres", () => {
  it("a vevő-hatókör a lista ÉS a számláló feltételébe is bekerül", () => {
    const scope = { kind: "customer", customerId: "customer-1" } as const;

    // EGY HIVAS ADJA MIND A KETTOT. A kulonbseg PONTOSAN az allapot-szukites:
    // a munkalapnal ez egy azonosito-halmaz, mert az allapot a legutolso
    // verzion all, nem a soron.
    const { list, counts } = worksheetListWheres(
      scope,
      { customerId: "customer-1" },
      { id: { in: ["ws-1", "ws-2"] } },
    );

    /*
      A MASODIK AG 2026-09-18 OTA A REJTES SZUROJE. Az allitas a TELJES tombre
      megy, nem csak a hatokor-agra: igy egy felcserelt sorrend is kipirosodik,
      es a rejtes-ag sem tunhet el eszrevetlenul.
    */
    assert.deepEqual(list.AND, [
      { customerId: "customer-1" },
      { hiddenAt: null },
      { customerId: "customer-1", id: { in: ["ws-1", "ws-2"] } },
    ]);
    assert.deepEqual(counts.AND, [
      { customerId: "customer-1" },
      { hiddenAt: null },
      { customerId: "customer-1" },
    ]);
  });

  /**
   * A SZAMLALO FELTETELE PONTOSAN AZ ALLAPOTTAL TER EL A LISTAETOL.
   *
   * Ez az az allitas, ami a csempek ES a lista "ugyanarrol a halmazrol
   * beszelnek" tulajdonsagat rogziti -- korabban a kliensen mertuk, harom
   * kulon hivas szuroit osszevetve. Itt egy szinttel lejjebb all, es
   * eroesebben: nem azt nezi, hogy a hivo jol rakta ossze, hanem hogy a ket
   * feltetel EGY forrasbol szuletik.
   */
  it("a számláló feltétele csak az állapot-szűkítéssel tér el a listáétól", () => {
    const felhasznaloiSzuro = {
      customerId: "customer-1",
      assignees: { some: { userId: "user-1" } },
    };
    const { list, counts } = worksheetListWheres(
      { kind: "internal" },
      felhasznaloiSzuro,
      { id: { in: ["ws-9"] } },
    );

    // A FELHASZNALOI SZURO A HARMADIK AG: a masodik 2026-09-18 ota a rejtese.
    const listaSzuro = (list.AND as Record<string, unknown>[])[2];
    const szamlaloSzuro = (counts.AND as Record<string, unknown>[])[2];

    assert.deepEqual(szamlaloSzuro, felhasznaloiSzuro);
    assert.deepEqual(listaSzuro, {
      ...felhasznaloiSzuro,
      id: { in: ["ws-9"] },
    });
  });

  it("a szállító-hatókör ugyanígy, és NEM vevőként", () => {
    assert.deepEqual(
      worksheetListWheres({ kind: "supplier", supplierId: "s-1" }, {}, {})
        .counts.AND,
      [{ supplierId: "s-1" }, { hiddenAt: null }, {}],
    );
  });
});

/**
 * A REJTETT LAPOK A LISTABOL ES A SZAMLALOBOL IS KIMARADNAK.
 *
 * UGYANAZ A SZERKEZETI OK, AMIRT A HATOKOR IS EGY HIVASBOL SZULETIK: ha a
 * rejtes csak az egyikbe kerulne bele, a lista ures maradna es a csempen allo
 * szam nem nulla. Az a fajta elteres, amit a felhasznalo hibanak lat, es
 * amirol nem tudja megmondani, melyik oldal hazudik.
 */
describe("a rejtett lapok a listából és a számlálóból is kimaradnak", () => {
  const BELSO = { kind: "internal" } as const;

  /** A `where` `AND` tombjenek agai, ellenorzott alakkal. */
  function agak(where: unknown): unknown[] {
    assert.ok(
      where && typeof where === "object" && "AND" in where,
      "a where nem AND-ágakból áll",
    );
    const value = (where as { AND: unknown }).AND;
    assert.ok(Array.isArray(value), "az AND nem tömb");
    return value;
  }

  const rejtett = (where: unknown) =>
    agak(where).some(
      (ag) =>
        ag !== null &&
        typeof ag === "object" &&
        "hiddenAt" in ag &&
        (ag as { hiddenAt: unknown }).hiddenAt === null,
    );

  it("alapból MIND A KETTŐBEN ott a szűrő", () => {
    const { list, counts } = worksheetListWheres(BELSO, {}, {});
    assert.equal(rejtett(list), true, "a listából hiányzik");
    assert.equal(rejtett(counts), true, "a számlálóból hiányzik");
  });

  it("a kapcsolóval MIND A KETTŐBŐL kikerül", () => {
    /*
      POZITIV KONTROLL A FENTI ALLITASHOZ: ha a kereso `rejtett()` barmit
      igaznak mondana, ez a ket allitas is zold lenne. Igy viszont a ket irany
      egyutt bizonyit: a szuro OTT VAN, amikor kell, es NINCS ott, amikor nem.
    */
    const { list, counts } = worksheetListWheres(BELSO, {}, {}, true, true);
    assert.equal(rejtett(list), false);
    assert.equal(rejtett(counts), false);
  });

  it("PARTNER hatókörön a kapcsoló nem hat", () => {
    const { list, counts } = worksheetListWheres(
      { kind: "customer", customerId: "cust-1" },
      {},
      {},
      true,
      true,
    );
    assert.equal(rejtett(list), true);
    assert.equal(rejtett(counts), true);
  });
});
