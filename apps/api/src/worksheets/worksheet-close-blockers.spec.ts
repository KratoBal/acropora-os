import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  worksheetCloseBlocker,
  type WorksheetCloseState,
} from "./worksheet-close-blockers.js";

/** Egy lezárható lap: minden feltétel teljesül. */
function closable(): WorksheetCloseState {
  return {
    status: "DRAFT",
    lineCount: 2,
    partnerCode: "BIO",
    // Az alegység kódja legfeljebb három nagybetű VAGY SZÁMJEGY lehet. Az
    // első fixture-öm "01" volt, és akkor a teszt fogta meg, nem az olvasás
    // -- 2026-09-22 óta viszont az "01" ÉRVÉNYES kód (Balázs kérte a
    // számjegyet), tehát ez a megjegyzés ma már nem egy élő védelmet ír le,
    // hanem azt, honnan jön ez a fixture. A "AKV" marad, mert nincs okunk
    // cserélni; ha valaki mégis elírja, a hossz-szabály még mindig fogja.
    departmentCode: "AKV",
    hasNumber: false,
  };
}

describe("mi akadályozza a munkalap lezárását", () => {
  it("teljes lapon nincs akadály", () => {
    assert.equal(worksheetCloseBlocker(closable()), null);
  });

  /**
   * AZ ÁR HIÁNYA 2026-09-17 ÓTA NEM AKADÁLY, ÉS EZ BALÁZS DÖNTÉSE.
   *
   * A kérése az volt, hogy a nettó, bruttó és áfa mezők ne jelenjenek meg sem
   * a weben, sem az appban; két utat tettünk elé, és a "B"-t választotta:
   * tűnjön el mindenhonnan, és akkor a lezárásból is ki kell venni az
   * ár-feltételt.
   *
   * MIÉRT NEM TÖRÖLTEM EZT A TESZTET, HANEM MEGFORDÍTOTTAM: egy törölt teszt
   * után semmi nem mondaná meg, hogy a viselkedés MEGVÁLTOZOTT, és nem
   * elfelejtettük. Ha valaki egyszer visszateszi a feltételt -- jó szándékkal,
   * a séma régi kommentjét olvasva --, EZ pirosodik ki, és a neve megmondja,
   * hogy döntés volt.
   */
  it("az állapot NEM ISMER ár-mezőt, tehát a feltétel nem is tehető vissza csendben", () => {
    /*
      MIÉRT ÍGY, ÉS NEM EGY `null`-t VÁRÓ ÁLLÍTÁSSAL: az első változatom ez volt --

          assert.equal(worksheetCloseBlocker(closable()), null);

      -- és az DÍSZLET. A `closable()` fixtúrából kivettem az ár-mezőt, tehát az
      az állítás BETŰRE ugyanazt méri, mint a fenti "teljes lapon nincs akadály".
      Nem tudott volna elbukni semmitől, ami az ár-feltétellel kapcsolatos.

      A `@ts-expect-error` viszont AKKOR pirosodik, amikor a hiba MEGSZŰNIK:
      ha valaki visszateszi a `linesWithoutPrice` mezőt az állapotba, a jelölt
      sor már nem hibás, és a fordító panaszkodik a feleslegessé vált jelölésre.
      Ez fordításidejű őrző arra, amit egy futásidejű állítás nem tud megfogni.
    */
    const blocker = worksheetCloseBlocker({
      ...closable(),
      // A PRETTIER ELMOZDITOTTA EZT A JELOLEST, es a forditó szolt rola
      // (TS2578: unused directive). A direktiva a HIBAS SOR elott kell allnia,
      // nem a kifejezes elott -- a formazas ugyanis tobb sorra tordelte a
      // hivast, es a hiba a mezo soraba kerult.
      // @ts-expect-error -- az ár-feltétel 2026-09-17-én kikerült (Balázs döntése)
      linesWithoutPrice: 1,
    });
    // És ha valaki mégis visszateszi: a lap ár nélkül is lezárható marad.
    assert.equal(blocker, null);
  });

  it("tétel nélkül nem zárható le", () => {
    assert.equal(
      worksheetCloseBlocker({ ...closable(), lineCount: 0 }),
      "NO_LINES",
    );
  });

  it("nem piszkozat lapon nincs mit lezárni", () => {
    assert.equal(
      worksheetCloseBlocker({ ...closable(), status: "SIGNED" }),
      "NOT_DRAFT",
    );
  });

  /**
   * A SORREND NEM KÖZÖMBÖS, ÉS EZ AZ EGYETLEN ÁLLÍTÁS, AMI MÉRI.
   *
   * Egy már aláírt lapon az ár hiánya nem az a válasz, amit a felhasználónak
   * adni kell: az általánosabb akadály áll elöl. Egy fordított sorrend
   * ugyanúgy "működne", csak rossz mondatot mutatna.
   */
  it("az általánosabb akadály áll elöl", () => {
    assert.equal(
      worksheetCloseBlocker({
        ...closable(),
        status: "SIGNED",
        lineCount: 0,
      }),
      "NOT_DRAFT",
    );
  });

  /**
   * A MÁR MEGSZÁMOZOTT LAPON A SZÁM FELTÉTELEI NEM AKADÁLYOZNAK. A szám
   * megvan, és visszamenőleg nem változik - egy azóta törölt partner-rövidítés
   * nem teheti lezárhatatlanná azt, aminek már van száma.
   */
  it("megszámozott lapon a hiányzó partner-rövidítés nem akadály", () => {
    assert.equal(
      worksheetCloseBlocker({
        ...closable(),
        partnerCode: null,
        hasNumber: true,
      }),
      null,
    );
  });

  it("szám nélküli lapon a hiányzó partner-rövidítés akadály", () => {
    assert.equal(
      worksheetCloseBlocker({ ...closable(), partnerCode: null }),
      "PARTNER_CODE_MISSING",
    );
  });
});
