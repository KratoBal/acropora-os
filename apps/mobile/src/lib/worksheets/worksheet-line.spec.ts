import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildWorksheetLinePayload,
  describeQueuedWorksheetLines,
  describeWorksheetLineQueueWrite,
  parseQuantity,
  readQueuedWorksheetLine,
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

describe("a sorba tett tétel törzse", () => {
  it("kiolvassa a HÁROM mezőt", () => {
    assert.deepEqual(
      readQueuedWorksheetLine(
        JSON.stringify({ description: "Csere", quantity: 1.5, unit: "óra" }),
      ),
      { description: "Csere", quantity: 1.5, unit: "óra" },
    );
  });

  it("az AZONOSÍTÓT nem viszi tovább, akkor sem, ha valaki beleírta", () => {
    /*
      A tetel azonositoja a SOR kulcsa, es a kuldes ONNAN veszi. Ha ez a
      fuggveny is visszaadna egy `id` mezot, ket helyen allna ugyanaz, es egy
      javitas az egyiket atirhatna -- a szerver MAS azonositot kapna, mint
      amivel a sor magat azonositja, es epp az idempotencia esne ki.

      MI PIROSIT: egy `return p as QueuedWorksheetLine` alaku valtozat, ami a
      teljes objektumot tovabbadja.
    */
    const out = readQueuedWorksheetLine(
      JSON.stringify({
        id: "line-mas",
        description: "Csere",
        quantity: 1,
        unit: "db",
      }),
    );
    assert.deepEqual(Object.keys(out ?? {}).sort(), [
      "description",
      "quantity",
      "unit",
    ]);
  });

  it("a HIÁNYOS és a SÉRÜLT törzsre null, nem féllábú objektum", () => {
    /*
      EZ A LENYEG: egy sima `JSON.parse` cast mellett a hianyos torzs
      `undefined` mezokkel menne fel a szerverre, es a hiba OTT jelenne meg,
      ertelmetlen elutasitaskent -- amit a sor konfliktusnak sorolna, es a
      tetel orokre elakadna.

      A MENNYISEG SZOVEGKENT is bukas: a szerver `number`-t var. Ez az az eset,
      ami a legkonnyebben atcsuszna, mert „latszatra ki van tolteve".
    */
    assert.equal(readQueuedWorksheetLine("nem json"), null);
    assert.equal(
      readQueuedWorksheetLine(JSON.stringify({ description: "Csere" })),
      null,
    );
    assert.equal(
      readQueuedWorksheetLine(
        JSON.stringify({ description: "Csere", quantity: "1,5", unit: "óra" }),
      ),
      null,
    );
  });
});

describe("mit mondunk a sorba került tételről", () => {
  it("a SIKERES sorba tétel kimondja, hogy a lapon NEM látszik", () => {
    /*
      EZ AZ EGY MONDAT AKADALYOZZA MEG A KETSZERES FELVITELT. A lap tetel-listaja
      a szerver valaszabol jon, tehat a sorba tett tetel ott NINCS ott. Egy sima
      "elmentve" utan a szerelo ranez a listara, nem latja, es UJRA beirja --
      ket kulon kulccsal, tehat a duplikacio-vedelem sem fogja meg.

      MI PIROSIT: egy semleges nyugtazo mondat a "nem látszik" resz nelkul.
    */
    const out = describeWorksheetLineQueueWrite({
      ok: true,
      operationId: "line-1",
    });
    assert.equal(out.type, "queued");
    assert.match(out.message, /NEM látszik/);
    assert.match(out.message, /ne írd be újra/);
  });

  it("az ELBUKOTT sorba tétel NEM ugyanazt mondja", () => {
    /*
      A ket eset a felhasznalonak ugyanugy nez ki: "elkuldtem". Ha a sorba tetel
      bukott el, a tetel SEHOL nem letezik -- se a szerveren, se a telefonon --,
      es egy zold mondat mellett a szerelo tovabbmenne.

      MI PIROSIT: kozos szoveg a ket agra.
    */
    const bukott = describeWorksheetLineQueueWrite({
      ok: false,
      error: "disk full",
    });
    assert.equal(bukott.type, "queue-failed");
    assert.match(bukott.message, /elveszett/);
    // A NYERS HIBA IS BENNE MARAD: ez az, amit az irodanak tovabb lehet adni.
    assert.match(bukott.message, /disk full/);
  });
});

describe("hány tétel vár még feltöltésre a lapon", () => {
  it("NULLÁNÁL csendben marad", () => {
    // Egy „0 tétel vár" mondat minden lapon ott allna, es a valodi hatralek
    // mondata elveszne a zajban.
    assert.equal(describeQueuedWorksheetLines(0), null);
    assert.equal(describeQueuedWorksheetLines(-1), null);
  });

  it("EGY tételnél is helyes magyarul, és megmondja, HOL találja meg", () => {
    const egy = describeQueuedWorksheetLines(1);
    assert.match(egy ?? "", /^Egy tétel/);
    assert.match(egy ?? "", /Feltöltésre várók/);
  });

  it("TÖBBNÉL a számot mondja", () => {
    assert.match(describeQueuedWorksheetLines(3) ?? "", /^3 tétel/);
  });
});
