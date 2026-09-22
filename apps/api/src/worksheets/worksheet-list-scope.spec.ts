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
/**
 * A HOZZARENDELT HELYSZINEK ALLANDOK EBBEN A FAJLBAN.
 *
 * Ez a spec a REJTES es a HATOKOR tengelyet meri; a helyszin-tengelynek sajat
 * allitasa van lentebb. Egy valtozo lista itt csak zajt vinne az alakokba.
 */
const EGYSEGEK = ["dept-1", "dept-2"];

describe("worksheetListWheres", () => {
  it("a vevő-hatókör a lista ÉS a számláló feltételébe is bekerül", () => {
    const scope = { kind: "customer", customerId: "customer-1" } as const;

    // EGY HIVAS ADJA MIND A KETTOT. A kulonbseg PONTOSAN az allapot-szukites:
    // a munkalapnal ez egy azonosito-halmaz, mert az allapot a legutolso
    // verzion all, nem a soron.
    const { list, counts } = worksheetListWheres(
      scope,
      EGYSEGEK,
      { customerId: "customer-1" },
      { id: { in: ["ws-1", "ws-2"] } },
    );

    /*
      A MASODIK AG 2026-09-22 OTA A HOZZARENDELT HELYSZINEK SZUROJE, a harmadik
      a rejtese. Az allitas a TELJES tombre megy, nem csak a hatokor-agra: igy
      egy felcserelt sorrend is kipirosodik, es egyik ag sem tunhet el
      eszrevetlenul.
    */
    assert.deepEqual(list.AND, [
      { customerId: "customer-1" },
      { departmentId: { in: EGYSEGEK } },
      { hiddenAt: null },
      { customerId: "customer-1", id: { in: ["ws-1", "ws-2"] } },
    ]);
    assert.deepEqual(counts.AND, [
      { customerId: "customer-1" },
      { departmentId: { in: EGYSEGEK } },
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
      EGYSEGEK,
      felhasznaloiSzuro,
      { id: { in: ["ws-9"] } },
    );

    /*
      A FELHASZNALOI SZURO A NEGYEDIK AG.

      A sorrend 2026-09-22-ig harom agbol allt (hatokor, rejtes, felhasznaloi
      szuro), es a helyszin-tengely a MASODIK helyre kerult. Az index tehat 2-rol
      3-ra valtozott -- es ezt a fordito NEM mondja meg: egy tombindex akkor is
      lefordul, ha a szomszed agra mutat. Ezert all mellette a lenti allitas,
      ami a helyszin-agat NEV SZERINT meri: ha valaki ujra atrendezi a sorrendet,
      ott derul ki, nem itt.
    */
    const listaSzuro = (list.AND as Record<string, unknown>[])[3];
    const szamlaloSzuro = (counts.AND as Record<string, unknown>[])[3];

    assert.deepEqual(szamlaloSzuro, felhasznaloiSzuro);
    assert.deepEqual(listaSzuro, {
      ...felhasznaloiSzuro,
      id: { in: ["ws-9"] },
    });
  });

  /**
   * A HELYSZIN-TENGELY KULON ALLITAST KAP, ES EZ NEM ISMETLES.
   *
   * Balazs, 2026-09-22 07:46:59 UTC: egy partner-felhasznalo CSAK a hozza
   * rendelt helyszinek dolgait lassa. A fenti allitasok a TELJES agtombot
   * nezik, tehat egy helyszin-rontast is pirosra dontenenek -- csak epp
   * UGYANAZZAL a pirossal, mint barmelyik masik ag rontasat.
   *
   * Ez az allitas CSAK a helyszin-agrol szol, es MIND A KET oldalrol (lista es
   * szamlalo): egy szures, ami csak a listara kerul, ures listat ad nem-nulla
   * szam melle -- az a fajta elteres, amirol a felhasznalo nem tudja
   * megmondani, melyik oldal hazudik.
   */
  it("a hozzárendelt helyszínek a listába ÉS a számlálóba is bekerülnek", () => {
    const { list, counts } = worksheetListWheres(
      { kind: "customer", customerId: "customer-1" },
      EGYSEGEK,
      {},
      {},
    );

    const vart = { departmentId: { in: EGYSEGEK } };
    assert.deepEqual((list.AND as unknown[])[1], vart);
    assert.deepEqual((counts.AND as unknown[])[1], vart);
  });

  /**
   * ES A BELSOS HIVO AGA URES MARAD -- kulon allitas, hogy a fenti ne legyen
   * ertelmezheto ugy, mintha minden hivasra kerulne helyszin-szures.
   */
  it("belsős hívónál a helyszín-ág ÜRES, és ez szándékos", () => {
    const { list } = worksheetListWheres(
      { kind: "internal" },
      EGYSEGEK,
      {},
      {},
    );

    assert.deepEqual((list.AND as unknown[])[1], {});
  });

  it("a szállító-hatókör ugyanígy, és NEM vevőként", () => {
    assert.deepEqual(
      worksheetListWheres(
        { kind: "supplier", supplierId: "s-1" },
        EGYSEGEK,
        {},
        {},
      ).counts.AND,
      /*
        A SZALLITOI HATOKOR HELYSZIN-AGA URES, ES EZ SZANDEKOS.

        Csak a VEVO-hatokor szukul: ma nulla szallitoi hatokoru felhasznalo
        letezik (acrobot merese, 2026-09-22), tehat ott nincs pozitiv kontroll
        -- egy szukites olyan allitast rogzitene helyesnek, amit senki nem tud
        megcafolni. Ugyanez a dontes all az eszkoz oldalan is; ha a ketto
        elternne, ugyanaz a felhasznalo ket felulet kozott mast latna.
      */
      [{ supplierId: "s-1" }, {}, { hiddenAt: null }, {}],
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
    const { list, counts } = worksheetListWheres(BELSO, EGYSEGEK, {}, {});
    assert.equal(rejtett(list), true, "a listából hiányzik");
    assert.equal(rejtett(counts), true, "a számlálóból hiányzik");
  });

  it("a kapcsolóval MIND A KETTŐBŐL kikerül", () => {
    /*
      POZITIV KONTROLL A FENTI ALLITASHOZ: ha a kereso `rejtett()` barmit
      igaznak mondana, ez a ket allitas is zold lenne. Igy viszont a ket irany
      egyutt bizonyit: a szuro OTT VAN, amikor kell, es NINCS ott, amikor nem.
    */
    const { list, counts } = worksheetListWheres(
      BELSO,
      EGYSEGEK,
      {},
      {},
      true,
      true,
    );
    assert.equal(rejtett(list), false);
    assert.equal(rejtett(counts), false);
  });

  it("PARTNER hatókörön a kapcsoló nem hat", () => {
    const { list, counts } = worksheetListWheres(
      { kind: "customer", customerId: "cust-1" },
      EGYSEGEK,
      {},
      {},
      true,
      true,
    );
    assert.equal(rejtett(list), true);
    assert.equal(rejtett(counts), true);
  });
});
