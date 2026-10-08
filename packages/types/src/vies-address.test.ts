import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { splitViesAddress, viesCountry, viesFill } from "./vies-address.js";

/** The answers measured on stage (exchange/vies/vies-nyers-stage-2026-10-07.json). */
describe("a VIES-cím mezőkre bontva", () => {
  it("NL: a kitöltött házszám nullái nélkül, az irányítószám és a város külön", () => {
    assert.deepEqual(splitViesAddress("VOLDERSGRACHT 00001\n2611ET DELFT"), {
      addressLine1: "VOLDERSGRACHT 1",
      postalCode: "2611ET",
      city: "DELFT",
    });
    assert.equal(
      splitViesAddress("WEENA 00664\n3012CN ROTTERDAM").addressLine1,
      "WEENA 664",
    );
  });

  it("AT: az irányítószám ország-előtagja leválik", () => {
    assert.deepEqual(splitViesAddress("Europastraße 3\nAT-5020 Salzburg"), {
      addressLine1: "Europastraße 3",
      postalCode: "5020",
      city: "Salzburg",
    });
  });

  it("CZ: a középső sor (városrész) az utcához tartozik, a dupla szóköz egy lesz", () => {
    assert.deepEqual(
      splitViesAddress(
        "tř. Václava Klementa 869\nMLADÁ BOLESLAV II\n293 01  MLADÁ BOLESLAV 1",
      ),
      {
        addressLine1: "tř. Václava Klementa 869, MLADÁ BOLESLAV II",
        postalCode: "293 01",
        city: "MLADÁ BOLESLAV 1",
      },
    );
  });

  it("IE: egysoros cím, irányítószám nélkül: egészben az utcába, kitalált város nélkül", () => {
    assert.deepEqual(
      splitViesAddress("3RD FLOOR, GORDON HOUSE, BARROW STREET, DUBLIN 4"),
      {
        addressLine1: "3RD FLOOR, GORDON HOUSE, BARROW STREET, DUBLIN 4",
        postalCode: "",
        city: "",
      },
    );
  });

  it("az ország a VIES-előtagból, Görögország EL helyett GR", () => {
    assert.equal(viesCountry("NL810433941B01"), "NL");
    assert.equal(viesCountry("EL123456789"), "GR");
    assert.equal(viesCountry("123"), null);
  });
});

describe("a VIES-kitöltés soha nem ír felül kérdés nélkül", () => {
  const answer = {
    name: "COOLBLUE B.V.",
    address: "WEENA 00664\n3012CN ROTTERDAM",
    taxNumber: "NL810433941B01",
  };

  it("az üres mezőket kitölti", () => {
    const { fill, conflicts } = viesFill(
      { name: "", country: "", addressLine1: "", postalCode: "", city: "" },
      answer,
    );
    assert.deepEqual(fill, {
      name: "COOLBLUE B.V.",
      country: "NL",
      addressLine1: "WEENA 664",
      postalCode: "3012CN",
      city: "ROTTERDAM",
    });
    assert.deepEqual(conflicts, []);
  });

  it("a beírt, eltérő értéket ütközésnek adja, nem írja felül; az egyezőt békén hagyja", () => {
    const { fill, conflicts } = viesFill(
      { name: "Coolblue", country: "NL", city: "rotterdam", postalCode: "" },
      answer,
    );
    assert.deepEqual(fill, { postalCode: "3012CN" });
    assert.deepEqual(conflicts, [
      { field: "name", current: "Coolblue", vies: "COOLBLUE B.V." },
    ]);
  });

  it("olyan mezőt, ami az űrlapon nincs, nem javasol", () => {
    const { fill } = viesFill({ name: "" }, answer);
    assert.deepEqual(fill, { name: "COOLBLUE B.V." });
  });
});
