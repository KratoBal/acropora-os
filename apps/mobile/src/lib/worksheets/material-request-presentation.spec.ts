import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMaterialRequestItems,
  describeEmptyMaterialRequests,
  describePendingMaterialRequestWorksheet,
  materialRequestByline,
} from "./material-request-presentation";

const iso = (s: string) => s;

describe("a felvitt tételek tisztítása és ellenőrzése", () => {
  it("a CSUPA ÜRES sorokból nem lesz igény", () => {
    const out = buildMaterialRequestItems([
      { name: "", quantity: "", unit: "" },
    ]);
    assert.equal(out.ok, false);
    assert.match(out.message ?? "", /legalább egy tételt/);
  });

  it("a FÉLIG kitöltött sor hibát ad, nem hagyja csendben ki", () => {
    // MI PIROSIT: a hiányos sor átengedése (csak a teljesen üreseket szűrve).
    const out = buildMaterialRequestItems([
      { name: "40mm könyök", quantity: "", unit: "db" },
    ]);
    assert.equal(out.ok, false);
    assert.match(out.message ?? "", /nevet, a mennyiséget és az egységet/);
  });

  it("a szövegeket LEVÁGVA adja tovább, és a teljesen üres sort kihagyja", () => {
    const out = buildMaterialRequestItems([
      { name: "  40mm könyök  ", quantity: " 2 ", unit: " db " },
      { name: "", quantity: "", unit: "" },
    ]);
    assert.equal(out.ok, true);
    assert.deepEqual(out.items, [
      { name: "40mm könyök", quantity: "2", unit: "db" },
    ]);
  });

  it("a FELSŐ HATÁR a szerveré, és a mondat megmondja, melyik mező", () => {
    // MI PIROSIT: egy más határ, mint amit a DTO ismer (200/100/50).
    const out = buildMaterialRequestItems([
      { name: "x".repeat(201), quantity: "1", unit: "db" },
    ]);
    assert.equal(out.ok, false);
    assert.match(out.message ?? "", /200/);
  });
});

describe("ki és mikor kérte", () => {
  it("piszkozaton a LÉTREHOZÁS idejét mutatja, nem a küldését", () => {
    const line = materialRequestByline(
      {
        status: "DRAFT",
        requestedByName: "Szerelő Sándor",
        createdAt: "LETREHOZVA",
        submittedAt: null,
        receivedAt: null,
        receivedByName: null,
      },
      iso,
    );
    assert.match(line, /piszkozat, LETREHOZVA/);
  });

  it("elküldött igénynél a KÜLDÉS idejét mutatja", () => {
    const line = materialRequestByline(
      {
        status: "OPEN",
        requestedByName: "Szerelő Sándor",
        createdAt: "LETREHOZVA",
        submittedAt: "KULDVE",
        receivedAt: null,
        receivedByName: null,
      },
      iso,
    );
    assert.match(line, /elküldve KULDVE/);
    assert.doesNotMatch(line, /LETREHOZVA/);
  });

  it("beérkezett igénynél a beérkezés idejét ÉS a jelölő nevét is mutatja", () => {
    const line = materialRequestByline(
      {
        status: "RECEIVED",
        requestedByName: "Szerelő Sándor",
        createdAt: "LETREHOZVA",
        submittedAt: "KULDVE",
        receivedAt: "BEERKEZVE",
        receivedByName: "Beszerző Béla",
      },
      iso,
    );
    assert.match(line, /elküldve KULDVE/);
    assert.match(line, /beérkezett BEERKEZVE \(Beszerző Béla\)/);
  });

  it("az ISMERETLEN kérőt KIMONDJA, nem hagyja üresen", () => {
    const line = materialRequestByline(
      {
        status: "DRAFT",
        requestedByName: null,
        createdAt: "A",
        submittedAt: null,
        receivedAt: null,
        receivedByName: null,
      },
      iso,
    );
    assert.match(line, /Ismeretlen kolléga/);
  });
});

describe("az üres lista mondata", () => {
  it("aki FELVIHET, biztatást kap", () => {
    assert.match(describeEmptyMaterialRequests(true), /Anyagigénylés gombbal/);
  });

  it("aki NEM vihet fel, nem kap felszólítást olyanra, amit nem tud megtenni", () => {
    // MI PIROSIT: közös szöveg a két ágra.
    assert.doesNotMatch(
      describeEmptyMaterialRequests(false),
      /Anyagigénylés gombbal/,
    );
  });
});

describe("a munkalap sora a beszerző listáján", () => {
  it("a sorszámot mutatja, ha van", () => {
    assert.equal(
      describePendingMaterialRequestWorksheet("BIO-2026-014"),
      "Munkalap: BIO-2026-014",
    );
  });

  it("a piszkozat állapotot mondja, ha még nincs sorszám", () => {
    assert.match(describePendingMaterialRequestWorksheet(null), /piszkozat/);
  });
});
