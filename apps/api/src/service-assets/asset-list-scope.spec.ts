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

    assert.deepEqual(list.AND, [
      { customerId: "customer-1" },
      { status: "ACTIVE" },
    ]);
    assert.deepEqual(counts.AND, [{ customerId: "customer-1" }, {}]);
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
