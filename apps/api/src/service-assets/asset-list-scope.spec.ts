import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assetListWheres } from "./service-assets.repository.js";

/**
 * A SZAMLALO NEM VESZITHETI EL A LATHATOSAGI HATART.
 *
 * Ez a lap allapot-csempeket mutat a lista folott, es a szamokat egy MASIK
 * lekerdezes adja, mint a sorokat. Ha a jogosultsagi szuro csak az egyikbol
 * marad ki, a csempek IDEGEN PARTNER eszkozeit szamoljak meg: a lista helyes
 * marad, a szam folotte nem -- es a kepernyon semmi nem arulja el.
 *
 * A HIBAJEGYEKNEL LEIRT MINTA ITT FELREVEZET, es ezert all kulon allitas
 * rajta: ott a szamlalo "szandekosan nem kap scope-ot", mert OTT a `scope` a
 * felhasznalo sajat szukitese. ITT a `PartnerScope` a lathatosagi hatar. A ket
 * nev ugyanaz, a jelentesuk nem, es a masolas iranya eppen a rossz fele visz.
 *
 * AMI ITT SZANDEKOSAN NINCS: annak ellenorzese, hogy a jogosultsagi szuro `AND`
 * AGKENT all es nem kulcskent. Azt a `auth/partner-scope-and-branch.spec.ts`
 * oriz, forrasbol, MINDEN hivasi helyen -- erosebben, mint ahogy egy futasideju
 * allitas tudna. Egy harmadik, atfedo orzo ugyanarra mar zaj, es epp azt a
 * "melyik a folosleges masolat" kerdest szulne, ami ellen az a fajl kulon
 * figyelmeztet. Ez a spec AZT meri, ami uj: hogy a SZAMLALO is megkapja.
 */
describe("assetListWheres", () => {
  it("a vevő-hatókör a lista ÉS a számláló feltételébe is bekerül", () => {
    const scope = { kind: "customer", customerId: "customer-1" } as const;

    // EGY HIVAS ADJA MIND A KETTOT: a ket feltetel kulonbsege PONTOSAN az
    // allapot, es a lathatosagi ag ugyanabbol a valtozobol kerul mindkettobe.
    const { list, counts } = assetListWheres(scope, {}, { status: "ACTIVE" });

    /*
      A KET AG 2026-09-18 OTA: TULAJDON **VAGY** SAJAT HELYSZIN.

      A masodik ag azert kellett, mert a partner helyszinen allo eszkoz
      SZALLITO-tulajdonu (merve stage-en: 2 sorbol 2, vevo-tulajdonu nulla), a
      portal pedig vevo-tulajdonut kert -- a kerdes szuksegszeruen nulla sort
      adott.

      A `deepEqual` itt SZANDEKOS, es nem `ok`: egy HARMADIK ag beszurasa (vagy
      egy ag, ami nincs a customerId-hez kotve) csendben szelesitene a
      lathatosagot, es egy lazabb allitas atengedne.
    */
    const vartLathatosag = {
      OR: [
        { customerId: "customer-1" },
        { department: { customerId: "customer-1" } },
      ],
    };

    assert.deepEqual(list.AND, [vartLathatosag, { status: "ACTIVE" }]);
    assert.deepEqual(counts.AND, [vartLathatosag, {}]);
  });

  /**
   * ES A NEGATIV OLDAL, SZERKEZETILEG: MINDEN ag a SAJAT customerId-hez van kotve.
   *
   * Ez NEM helyettesiti az integracios merest (`asset-visibility-scope`), ami
   * valodi sorokon nezi meg, hogy MAS partner helyszine nem jon vissza. Azt
   * meri, amit EZ nem tud: a lekerdezes JELENTESET.
   *
   * Amit viszont ez fog meg, es az integracios nem feltetlenul: egy ag, ami
   * BARMELY helyszinre illeszkedne (`department: {}`), a mai fixturakkal akar
   * zolden is atmehetne, ha a masik partnernek eppen nincs eszkoze.
   */
  it("MÁSIK hatókörnél MÁSIK azonosító áll mind a két ágban", () => {
    /*
      === MIÉRT NEM ELÉG A FENTI `deepEqual` ===

      Az EGY hatókörre nézi a formát. Egy beégetett azonosító az implementációban
      (`customerId: "customer-1"` a scope értéke helyett) azon ZÖLDEN átmenne, és
      MINDEN partner ugyanazt a halmazt látná -- a legrosszabb fajta
      adatszivárgás, mert nem hibázik.

      Ez az állítás EZT méri, és csak ezt: ugyanaz a forma, MÁSIK értékkel. A
      kettő két különböző rontásra pirosodik, és épp ezért áll külön.
    */
    const { list } = assetListWheres(
      { kind: "customer", customerId: "customer-2" },
      {},
      {},
    );

    // A SZUKITES MAGA IS ALLITAS: a jogosultsagi ag TOMBBEN all, nem egyetlen
    // objektumkent -- egy egyelemu, nem-tomb alak a masik feltetelt kiutne.
    assert.ok(Array.isArray(list.AND), "a lathatosagi ag AND TOMBBEN all");
    assert.deepEqual(list.AND[0], {
      OR: [
        { customerId: "customer-2" },
        { department: { customerId: "customer-2" } },
      ],
    });
  });

  it("a szállító-hatókör ugyanígy, és NEM vevőként", () => {
    const scope = { kind: "supplier", supplierId: "supplier-1" } as const;

    assert.deepEqual(assetListWheres(scope, {}, {}).counts.AND, [
      { supplierId: "supplier-1" },
      {},
    ]);
  });

  /**
   * A BELSOS HATOKOR URES AGAT AD, es ez NEM ugyanaz, mint a hianyzo ag: az
   * ures objektum azt jelenti, hogy nincs szukites, es ez a belsos felhasznalo
   * eseteben a helyes valasz. Az allitas azert all itt, hogy a masik ketto ne
   * legyen ertelmezheto ugy, mintha barmilyen ures ag gyanus lenne.
   */
  it("belsős hatókörnél nincs szűkítés, és ez szándékos", () => {
    assert.deepEqual(assetListWheres({ kind: "internal" }, {}, {}).counts.AND, [
      {},
      {},
    ]);
  });
});
