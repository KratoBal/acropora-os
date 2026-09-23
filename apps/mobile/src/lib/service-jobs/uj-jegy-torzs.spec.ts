import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  eszkozNelkuliMuveletAzonosito,
  ujJegyTorzse,
  type UjJegyAllapot,
} from "./uj-jegy-torzs";

const ALAP: UjJegyAllapot = {
  cim: "Szivattyú zúg",
  leiras: "",
  originAssetId: null,
  customerId: null,
  departmentId: null,
  assetIds: [],
  userId: "user-1",
  openedAt: "2026-09-18T18:00:00.000Z",
};

const torzs = (reszlet: Partial<UjJegyAllapot> = {}) =>
  ujJegyTorzse({ ...ALAP, ...reszlet });

describe("mi megy fel egy új hibajegyből", () => {
  it("gép mellől az originAssetId megy, partner és helyszín NEM", () => {
    const eredmeny = torzs({
      originAssetId: "asset-1",
      customerId: "cust-1",
      departmentId: "dept-1",
    });

    assert.equal(eredmeny.ok, true);
    if (!eredmeny.ok) return;
    assert.deepEqual(eredmeny.payload, {
      title: "Szivattyú zúg",
      originAssetId: "asset-1",
    });
  });

  /**
   * A MÁSIK IRÁNY, ÉS ENÉLKÜL AZ ELŐZŐ ÁLLÍTÁS NEM BIZONYÍT SEMMIT: egy olyan
   * változat, ami SOHA nem küld partnert, az első teszten is átmenne.
   */
  it("gép nélkül a megadott partner és helyszín megy fel", () => {
    const eredmeny = torzs({ customerId: "cust-1", departmentId: "dept-1" });

    assert.equal(eredmeny.ok, true);
    if (!eredmeny.ok) return;
    assert.deepEqual(eredmeny.payload, {
      title: "Szivattyú zúg",
      customerId: "cust-1",
      departmentId: "dept-1",
    });
  });

  /**
   * A PARTNER KOTELEZO GEP NELKUL (Balazs dontese, 2026-09-23). Ez a teszt a
   * REGI viselkedes tukorkepe: eddig itt `ok: true` allt, "csak a cím
   * kötelező" néven -- a döntés ezt az utat zárta le, nem szűkítette.
   */
  it("gép nélkül, partner nélkül a küldés előtt megáll", () => {
    const eredmeny = torzs();

    assert.deepEqual(eredmeny, {
      ok: false,
      hiba: "Partner kiválasztása kötelező.",
    });
  });

  /**
   * A HELYSZIN IS KOTELEZO GEP NELKUL, UGYANATTOL A DONTESTOL -- de csak
   * AKKOR eldontheto ez a hianyzo mezo hibaja, ha a partner MAR megvan.
   * Enelkul a teszt nem tudna megkulonboztetni a ket hianyt.
   */
  it("gép nélkül, helyszín nélkül a küldés előtt megáll, ha a partner megvan", () => {
    const eredmeny = torzs({ customerId: "cust-1" });

    assert.deepEqual(eredmeny, {
      ok: false,
      hiba: "Helyszín kiválasztása kötelező.",
    });
  });

  it("üres cím esetén nem küldünk semmit", () => {
    assert.deepEqual(torzs({ cim: "   " }), {
      ok: false,
      hiba: "A jegy címe kötelező.",
    });
  });

  /**
   * A SZERVER UGYANEZT ŐRZI, ÉS UGYANEZZEL A MONDATTAL. Itt azért áll, hogy a
   * szerelő a helyszínen NE egy szerver-hibából tudja meg, mit hagyott ki.
   *
   * `originAssetId`-VEL, SZANDEKOSAN: gep nelkul ez az eset MA MAR a
   * "Partner kiválasztása kötelező" agon allna meg elobb (lasd fent) -- ez
   * az allitas azt a MASIK utat meri, ahol a hivo mar ADOTT egy gepet, es
   * MELLETTE, tevesen, helyszint is kuldott volna partner nelkul.
   */
  it("helyszín partner nélkül, gép mellett: a küldés előtt megáll", () => {
    assert.deepEqual(
      torzs({ originAssetId: "asset-1", departmentId: "dept-1" }),
      {
        ok: false,
        hiba: "Helyszínt csak partnerrel együtt lehet megadni.",
      },
    );
  });

  it("a leírás csak akkor kerül bele, ha van", () => {
    // PARTNER ES HELYSZIN KELL, MERT MOSTANTOL KOTELEZO: enelkul mindket
    // hivas a partner-hiany agara esne, es az allitas nem a leirasrol szolna.
    const ures = torzs({ customerId: "cust-1", departmentId: "dept-1" });
    const teli = torzs({
      customerId: "cust-1",
      departmentId: "dept-1",
      leiras: "  hangos  ",
    });

    assert.equal(ures.ok && "description" in ures.payload, false);
    assert.equal(teli.ok && teli.payload.description, "hangos");
  });

  /**
   * A MŰVELET-AZONOSÍTÓ KÉT ALAKJA SOHA NEM ESHET EGYBE, és a gép nélküli
   * alakban a FELHASZNALO adja azt, amit addig a gép: két szerelő ugyanabban az
   * ezredmásodpercben különben ugyanazt a kulcsot küldené, és a szerver
   * globális idempotencia-kulcsa a másodiknak AZ ELSŐ jegyét adná vissza.
   */
  it("a gép nélküli azonosító a felhasználót is hordozza", () => {
    assert.equal(
      eszkozNelkuliMuveletAzonosito({
        userId: "user-1",
        openedAt: "2026-09-18T18:00:00.000Z",
      }),
      "service-job:nincs-eszkoz:user-1:2026-09-18T18:00:00.000Z",
    );
  });

  it("két szerelő ugyanabban a pillanatban KÜLÖN kulcsot kap", () => {
    const egyik = torzs({
      customerId: "cust-1",
      departmentId: "dept-1",
      userId: "user-1",
    });
    const masik = torzs({
      customerId: "cust-1",
      departmentId: "dept-1",
      userId: "user-2",
    });

    assert.equal(
      egyik.ok && masik.ok && egyik.operationId !== masik.operationId,
      true,
    );
  });

  it("ugyanaz a szerelő, ugyanaz a pillanat: UGYANAZ a kulcs", () => {
    const egyszer = torzs({ customerId: "cust-1", departmentId: "dept-1" });
    const ketszer = torzs({ customerId: "cust-1", departmentId: "dept-1" });

    assert.equal(
      egyszer.ok && ketszer.ok && egyszer.operationId === ketszer.operationId,
      true,
    );
  });

  /**
   * A SZERVER MINTÁJA: `^[A-Za-z0-9_.:-]{8,128}$`. A kulcs alakja ezen belül
   * kell maradjon, különben a felvitel a validáción bukik el -- és a szerelő
   * egy érvényes bejelentésre kapna hibát.
   */
  it("mindkét kulcs-alak megfelel a szerver mintájának", () => {
    const minta = /^[A-Za-z0-9_.:-]{8,128}$/;
    const gepes = torzs({ originAssetId: "asset-1" });
    const gepNelkul = torzs({ customerId: "cust-1", departmentId: "dept-1" });

    assert.match(gepes.ok ? gepes.operationId : "", minta);
    assert.match(gepNelkul.ok ? gepNelkul.operationId : "", minta);
  });
});

/**
 * AZ ESZKOZOK A GEP NELKULI UTON (9dfa03c7).
 *
 * A szerver harmadik orzoje: az `assetIds` CSAK helyszinnel egyutt ervenyes, es
 * a kert halmaz maga a helyszin (reszfastul) eszkozeibol all.
 */
describe("a gép nélküli úton megadott eszközök", () => {
  it("helyszínnel együtt felmennek", () => {
    const eredmeny = torzs({
      customerId: "cust-1",
      departmentId: "dept-1",
      assetIds: ["asset-1", "asset-2"],
    });
    assert.equal(eredmeny.ok, true);
    if (!eredmeny.ok) return;
    assert.deepEqual(eredmeny.payload, {
      title: "Szivattyú zúg",
      customerId: "cust-1",
      departmentId: "dept-1",
      assetIds: ["asset-1", "asset-2"],
    });
  });

  /**
   * A SZERVER HARMADIK ORZOJE, A KULDES ELOTT. Nem azert, hogy helyettesitse a
   * szervert, hanem hogy a szerelo a helyszinen ne egy szerver-hibauzenetbol
   * tudja meg, mit hagyott ki.
   *
   * GEP NELKUL EZ AZ AG MA MAR NEM ERHETO EL: a fentebb bevezetett "Helyszín
   * kiválasztása kötelező" ellenorzes korabban lecsapja, meg mielott az
   * eszkoz-specifikus szabalyhoz erne. Az `originAssetId` ezert KELL ide --
   * enelkul ez a teszt a MASIK uzenetet kapna, es nem azt merne, amit a neve
   * mond.
   */
  it("helyszín nélkül a felvitel megáll, mielőtt elindulna, gép mellett is", () => {
    const eredmeny = torzs({
      originAssetId: "asset-1",
      customerId: "cust-1",
      assetIds: ["asset-1"],
    });
    assert.equal(eredmeny.ok, false);
    if (eredmeny.ok) return;
    assert.match(eredmeny.hiba, /helyszínnel/i);
  });

  /**
   * AZ URES AZONOSITO KIESIK, ES EZ NEM OVATOSSAG: a valaszto allapota egy
   * tomb, es egy torolt sor ures sztringet hagyhat benne. Egy ures azonosito
   * a szerveren nem letezo eszkozre mutatna, es a TELJES felvitel hasalna el
   * rajta -- egy olyan sor miatt, amit a szerelo mar levett.
   *
   * ES A CSUPA-URES LISTA NEM KULD MEZOT: egy `assetIds: []` a kerésben azt
   * allitana, hogy a szerelo SEMMIT nem valasztott -- ami igaz, de akkor a
   * mezonek nincs is helye a torzsben.
   */
  it("az üres azonosító kiesik, és csupa üresnél nincs mező", () => {
    const egy = torzs({
      customerId: "cust-1",
      departmentId: "dept-1",
      assetIds: ["  ", "asset-1", ""],
    });
    assert.equal(egy.ok, true);
    if (!egy.ok) return;
    assert.deepEqual(egy.payload.assetIds, ["asset-1"]);

    const semmi = torzs({
      customerId: "cust-1",
      departmentId: "dept-1",
      assetIds: ["", "   "],
    });
    assert.equal(semmi.ok, true);
    if (!semmi.ok) return;
    assert.ok(!("assetIds" in semmi.payload));
  });

  /**
   * GEP MELLOL AZ `assetIds` SEM MEGY FEL. Ott a jegy MAGAROL a geprol szol,
   * es azt az `originAssetId` mondja meg -- egy melle tett lista ugyanazt az
   * eszkozt MASODSZOR is rakotne, mas jelentessel.
   *
   * MI PIROSIT: ha a lista az `originAssetId` melle kerulne. A tipus ezt nem
   * fogja meg: mind a ketto ervenyes mezo a szerveren.
   */
  it("gép mellől az eszköz-lista NEM megy fel", () => {
    const eredmeny = torzs({
      originAssetId: "asset-1",
      customerId: "cust-1",
      departmentId: "dept-1",
      assetIds: ["asset-2"],
    });
    assert.equal(eredmeny.ok, true);
    if (!eredmeny.ok) return;
    assert.deepEqual(eredmeny.payload, {
      title: "Szivattyú zúg",
      originAssetId: "asset-1",
    });
  });
});
