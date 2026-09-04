import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { projectVariantOptions } from "./medusa-variant-options.js";

/**
 * A MERCE: A TENGELY NEVE A FORRASBOL JON, ES SEMMI NEM UGRIK BE HELYETTE.
 *
 * acrobot kikotese, 2026-09-04: "ha nincs tengely-nev, az nevesitett megallas
 * legyen, ne csendes helyettesites". Egy behelyettesitett "Kivitel" a boltban
 * valodinak latszana, es senki nem keresne, mert a lap mukodne.
 *
 * ES A MASODIK MERCE, AMI KONNYEN KIMARAD: a hetkoznapi termek viselkedese NEM
 * valtozhat. A ket alak (tengely nelkuli es tengelyes) KULON allitast kap,
 * kulonben egy keszlet, ami csak a tengelyeset meri, egy elrontott
 * alapertelmezett agon is zold maradna.
 */

const sor = (sku: string, values: unknown) => ({
  sku,
  unasVariantValues: values,
});

describe("valtozat-opciok: a hetkoznapi termek", () => {
  /**
   * ISMERT NEGATIV, es a legfontosabb allitas az egesz fajlban: ma 1884 ilyen
   * termek van, es ezek viselkedese nem mozdulhat.
   */
  it("kombinacio nelkul az alapertelmezett agra megy", () => {
    const d = projectVariantOptions([sor("PUMP-1", null)]);
    assert.equal(d.ok, true);
    if (!d.ok) return;
    assert.equal(d.kind, "default");
  });

  it("ures tomb is az alapertelmezett ag", () => {
    const d = projectVariantOptions([sor("PUMP-1", [])]);
    assert.equal(d.ok, true);
    if (!d.ok) return;
    assert.equal(d.kind, "default");
  });

  it("valtozat nelkul is az alapertelmezett ag", () => {
    const d = projectVariantOptions([]);
    assert.equal(d.ok, true);
    if (!d.ok) return;
    assert.equal(d.kind, "default");
  });
});

describe("valtozat-opciok: a tengely a forrasbol", () => {
  /**
   * ISMERT POZITIV, ES NEM KITALALT: ez a `5902026731119cs` termek valodi
   * alakja a 2026-09-03-i exportbol. A tengely neve "Flakon", ket ertekkel.
   */
  it("egy tengely, ket ertek: a FORRAS neve kerul ki, nem alapertelmezes", () => {
    const d = projectVariantOptions([
      sor("A-1", [{ name: "Flakon", value: "Egyedi csomagolas" }]),
      sor("A-2", [{ name: "Flakon", value: "Flakon" }]),
    ]);

    assert.equal(d.ok, true);
    if (!d.ok || d.kind !== "axes")
      return assert.fail("tengelyes agat vartunk");
    assert.deepEqual(d.axes, [
      { title: "Flakon", values: ["Egyedi csomagolas", "Flakon"] },
    ]);
    assert.deepEqual(d.rows, [
      {
        sku: "A-1",
        title: "Egyedi csomagolas",
        options: { Flakon: "Egyedi csomagolas" },
      },
      { sku: "A-2", title: "Flakon", options: { Flakon: "Flakon" } },
    ]);
  });

  /**
   * A MASODIK TENGELY-NEV KULON TESZT, acrobot 5. kikotese szerint.
   *
   * Nem stilus: ha csak egy nevre lenne allitas, egy beegetett tengely-nev is
   * atmenne. Ket kulonbozo nev azt meri, hogy a nev TENYLEG a bemenetbol jon.
   * A "Szin" a katalogus masik nyolc tengelyes termekének a neve.
   */
  it("masik termek, masik tengely-nev: ugyanaz a szabaly", () => {
    const d = projectVariantOptions([
      sor("B-1", [{ name: "Szin", value: "Fekete" }]),
      sor("B-2", [{ name: "Szin", value: "Feher" }]),
    ]);

    assert.equal(d.ok, true);
    if (!d.ok || d.kind !== "axes")
      return assert.fail("tengelyes agat vartunk");
    assert.deepEqual(d.axes, [{ title: "Szin", values: ["Fekete", "Feher"] }]);
  });

  /**
   * KET TENGELY: a forras szerkezete engedi, a mai adat nem tartalmazza.
   * A fixtura ezert SZINTETIKUS, es ezt ki kell mondani -- de a szabaly
   * megirasa nem varhat az elso ilyen termekre, mert akkor az elso ilyen
   * termek CSENDBEN veszitene el a masodik tengelyet.
   */
  it("ket tengely: mindketto kikerul, es az ertekek nem keverednek", () => {
    const d = projectVariantOptions([
      sor("C-1", [
        { name: "Szin", value: "Fekete" },
        { name: "Meret", value: "L" },
      ]),
      sor("C-2", [
        { name: "Szin", value: "Feher" },
        { name: "Meret", value: "L" },
      ]),
    ]);

    assert.equal(d.ok, true);
    if (!d.ok || d.kind !== "axes")
      return assert.fail("tengelyes agat vartunk");
    assert.deepEqual(d.axes, [
      { title: "Szin", values: ["Fekete", "Feher"] },
      { title: "Meret", values: ["L"] },
    ]);
    assert.deepEqual(d.rows[0], {
      sku: "C-1",
      title: "Fekete / L",
      options: { Szin: "Fekete", Meret: "L" },
    });
  });
});

describe("valtozat-opciok: amitol MEGALL", () => {
  /**
   * EZ A KIKOTES MAGA. A csendes valasz itt egy behelyettesitett tengely-nev
   * lenne, es a bolti lap tole mukodne -- csak nem azt mondana, amit a forras.
   */
  it("hianyzo tengely-nev: nevesitett megallas, nem alapertelmezes", () => {
    const d = projectVariantOptions([sor("D-1", [{ value: "Fekete" }])]);
    assert.equal(d.ok, false);
    if (d.ok) return;
    assert.equal(d.reason, "variant-axis-name-missing");
  });

  it("ures tengely-nev ugyanaz, mint a hianyzo", () => {
    const d = projectVariantOptions([
      sor("D-2", [{ name: "   ", value: "Fekete" }]),
    ]);
    assert.equal(d.ok, false);
    if (d.ok) return;
    assert.equal(d.reason, "variant-axis-name-missing");
  });

  it("hianyzo ertek: sajat nev, mert a teendo mas", () => {
    const d = projectVariantOptions([sor("D-3", [{ name: "Szin" }])]);
    assert.equal(d.ok, false);
    if (d.ok) return;
    assert.equal(d.reason, "variant-value-missing");
  });

  it("nem lista alaku JSON: megallas, nem csendes atugras", () => {
    const d = projectVariantOptions([sor("D-4", { name: "Szin" })]);
    assert.equal(d.ok, false);
    if (d.ok) return;
    assert.equal(d.reason, "variant-values-malformed");
  });

  /**
   * A VEGYES ESET, ES AMIERT NEM VALASZTUNK: barmelyik agat valasztanank, a
   * masik sorai CSENDBEN esnenek ki a boltbol.
   */
  it("vegyes allapot: van kombinacios es kombinacio nelkuli sor is", () => {
    const d = projectVariantOptions([
      sor("E-1", [{ name: "Szin", value: "Fekete" }]),
      sor("E-2", null),
    ]);
    assert.equal(d.ok, false);
    if (d.ok) return;
    assert.equal(d.reason, "variant-values-mixed");
  });

  it("eltero tengelyek a sorok kozott: nem kepezheto egy opcio-keszlet", () => {
    const d = projectVariantOptions([
      sor("F-1", [{ name: "Szin", value: "Fekete" }]),
      sor("F-2", [{ name: "Meret", value: "L" }]),
    ]);
    assert.equal(d.ok, false);
    if (d.ok) return;
    assert.equal(d.reason, "variant-axes-inconsistent");
  });

  /**
   * KET SOR UGYANAZZAL A KOMBINACIOVAL: a mi adatunkban ellentmondas. A bolt
   * oldalan az elso nyerne, a masodik neman eltunne.
   */
  it("ismetlodo kombinacio: megallas, nem az elso nyer", () => {
    const d = projectVariantOptions([
      sor("G-1", [{ name: "Szin", value: "Fekete" }]),
      sor("G-2", [{ name: "Szin", value: "Fekete" }]),
    ]);
    assert.equal(d.ok, false);
    if (d.ok) return;
    assert.equal(d.reason, "variant-combination-duplicate");
  });
});
