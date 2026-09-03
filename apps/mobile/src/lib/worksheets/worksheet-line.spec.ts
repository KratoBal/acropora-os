import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildWorksheetLinePayload,
  parseQuantity,
  worksheetLineId,
} from "./worksheet-line";

/**
 * A HAROM MEZO, ES AMI KOZULUK A LEGKONNYEBBEN ELROMLIK: A MENNYISEG.
 *
 * A telefon billentyuzete VESSZOT ad tizedesjelnek, a szerver `number`-t var.
 */

const ALAP = { description: "Szivattyú csere", quantity: "1,5", unit: "óra" };

describe("a mennyiség olvasása", () => {
  it("a MAGYAR alakot (vesszővel) elfogadja", () => {
    /*
      MI PIROSIT: egy szigoru `Number()` hivas. Akkor a szerelo beirna, hogy
      1,5, es a mentes egy olyan hibaval hasalna el, ami a SZAMROL szol --
      holott az irasmod a baj.
    */
    assert.deepEqual(parseQuantity("1,5"), { ok: true, value: 1.5 });
  });

  it("a PONTOS alakot is", () => {
    assert.deepEqual(parseQuantity("2.25"), { ok: true, value: 2.25 });
  });

  it("ami NEM szám, azt elutasítja", () => {
    // ISMERT POZITIV KONTROLL a fentiekhez: e nelkul egy "mindent elfogad"
    // valtozat is atmenne rajtuk, es a szerver kapna egy NaN erteket.
    for (const rossz of ["", "  ", "ket", "1,5,5", "-2", "1e5"])
      assert.equal(parseQuantity(rossz).ok, false, `elfogadta: ${rossz}`);
  });
});

describe("a sor azonosítója", () => {
  it("megfelel a SZERVER alakjának", () => {
    /*
      A szerver mintaja: 8-64 karakter, betu, szam, kotojel, alahuzas. A
      rogzites kulcsa (`asset-create:V2196:2026-...`) NEM felelne meg neki --
      abban kettospont es pont is van. Ha ezt elrontjuk, a sor a SZERVEREN
      bukna el, egy alak-hibaval, amit a szerelo nem tud ertelmezni.
    */
    const id = worksheetLineId({ now: 1_780_000_000_000, random: 0.42 });
    assert.match(id, /^[A-Za-z0-9_-]{8,64}$/);
  });

  it("két hívás KÉT azonosítót ad", () => {
    // MI PIROSIT: egy allando azonosito. Akkor a masodik tetel beszurasa a
    // szerveren utkozne az elsovel, es a szerelo azt latna, hogy nem tud
    // masodik sort felvinni.
    assert.notEqual(
      worksheetLineId({ now: 1_780_000_000_000, random: 0.42 }),
      worksheetLineId({ now: 1_780_000_000_001, random: 0.99 }),
    );
  });
});

describe("a tétel összeállítása", () => {
  it("a HÁROM mezővel átmegy, és nem küld többet", () => {
    const r = buildWorksheetLinePayload(ALAP, "line-abc12345");
    assert.equal(r.ok, true);
    assert.deepEqual(r.ok ? r.payload : null, {
      id: "line-abc12345",
      description: "Szivattyú csere",
      quantity: 1.5,
      unit: "óra",
    });
  });

  it("ÁRAT nem küld, még akkor sem, ha lenne honnan", () => {
    /*
      Az arat az IRODA adja meg. Egy telefonrol kuldott nulla a lapon
      ERTEKKENT allna: aki ranez, nem tudja megkulonboztetni az ingyenes
      munkatol.

      MI PIROSIT: barmilyen ar-mezo bekerulese a payloadba.
    */
    const r = buildWorksheetLinePayload(ALAP, "line-abc12345");
    const kulcsok = r.ok ? Object.keys(r.payload).sort() : [];
    assert.deepEqual(kulcsok, ["description", "id", "quantity", "unit"]);
  });

  it("üres megnevezésnél a MEGNEVEZÉS mezőnél áll meg", () => {
    const r = buildWorksheetLinePayload(
      { ...ALAP, description: "   " },
      "line-abc12345",
    );
    assert.equal(r.ok ? null : r.field, "description");
  });

  it("rossz mennyiségnél a MENNYISÉG mezőnél", () => {
    const r = buildWorksheetLinePayload(
      { ...ALAP, quantity: "ket" },
      "line-abc12345",
    );
    assert.equal(r.ok ? null : r.field, "quantity");
  });

  it("üres egységnél az EGYSÉG mezőnél", () => {
    const r = buildWorksheetLinePayload({ ...ALAP, unit: "" }, "line-abc12345");
    assert.equal(r.ok ? null : r.field, "unit");
  });
});
