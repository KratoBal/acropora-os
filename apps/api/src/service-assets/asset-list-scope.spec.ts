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
    const { list, counts } = assetListWheres(
      scope,
      ["dept-1", "dept-2"],
      {},
      { status: "ACTIVE" },
    );

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
    /*
      A HARMADIK TENGELY 2026-09-22 OTA: A HOZZARENDELT HELYSZIN.

      Balazs, 07:46:59 UTC: egy partner-felhasznalo csak a hozza RENDELT
      helyszinek dolgait lassa. A ket regi ag (tulajdon vagy reszleg) azt
      mondja meg, KIE a sor; ez azt, HOL all -- es a ketto `AND`-del all
      egymas mellett, mert MIND A KETTONEK teljesulnie kell.
    */
    const vartLathatosag = {
      AND: [
        {
          OR: [
            { customerId: "customer-1" },
            { department: { customerId: "customer-1" } },
          ],
        },
        { departmentId: { in: ["dept-1", "dept-2"] } },
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
      ["dept-9"],
      {},
      {},
    );

    // A SZUKITES MAGA IS ALLITAS: a jogosultsagi ag TOMBBEN all, nem egyetlen
    // objektumkent -- egy egyelemu, nem-tomb alak a masik feltetelt kiutne.
    assert.ok(Array.isArray(list.AND), "a lathatosagi ag AND TOMBBEN all");
    assert.deepEqual(list.AND[0], {
      AND: [
        {
          OR: [
            { customerId: "customer-2" },
            { department: { customerId: "customer-2" } },
          ],
        },
        { departmentId: { in: ["dept-9"] } },
      ],
    });
  });

  /**
   * A HELYSZIN-TENGELY KULON ALLITAST KAP, ES EZ NEM ISMETLES.
   *
   * A fenti ket `deepEqual` a TELJES alakot nezi, tehat egy helyszin-rontast is
   * pirosra dontene -- csak epp UGYANAZZAL a pirossal, mint egy tulajdon-rontast.
   * A kalibracio kimenetebol nem lehetne megmondani, melyik tengely romlott el.
   *
   * Ez az allitas CSAK a helyszin-agrol szol, es a SZAMLALO oldalarol meri: az
   * volt az a hely, ahol egy korabbi szeletnel a szures csendben kimaradt.
   */
  it("a hozzárendelt helyszínek a SZÁMLÁLÓ feltételébe is bekerülnek", () => {
    const { counts } = assetListWheres(
      { kind: "customer", customerId: "customer-1" },
      ["dept-5"],
      {},
      {},
    );
    // A SZUKITES MAGA IS ALLITAS: a lathatosagi ag TOMBBEN all. Ha egyetlen
    // objektumma laposodna, a masodik feltetel kiesne -- ezert kerdezzuk meg,
    // mielott indexelnenk.
    assert.ok(Array.isArray(counts.AND), "a szamlalo agai TOMBBEN allnak");
    const lathatosag = counts.AND[0] as { AND: unknown[] };

    assert.deepEqual(lathatosag.AND[1], { departmentId: { in: ["dept-5"] } });
  });

  it("a szállító-hatókör ugyanígy, és NEM vevőként", () => {
    const scope = { kind: "supplier", supplierId: "supplier-1" } as const;

    assert.deepEqual(assetListWheres(scope, ["dept-1"], {}, {}).counts.AND, [
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
    assert.deepEqual(
      assetListWheres({ kind: "internal" }, ["dept-1"], {}, {}).counts.AND,
      [{}, {}],
    );
  });
});
