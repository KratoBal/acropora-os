import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isWorksheetIssuedSheet,
  preferSignedSheet,
  WORKSHEET_ISSUED_SHEET_TYPES,
} from "./worksheet-management.js";

/**
 * EGY VERZIOHOZ KET KIADOTT LAP TARTOZHAT, ES A VEVO FELE A VEGLEGES SZAMIT.
 *
 * A lezaraskori lapon PISZKOZAT felirat all -- nem eliratbol, hanem a SORREND
 * miatt: a lapot a `close()` allitja elo, az alairas csak azutan jon, tehat a
 * generalas pillanataban az allapot soha nem `SIGNED`. A megoldas (Balazs
 * dontese, 2026-09-21: "igen jo igy") egy KULON, vegleges dokumentum, es ez a
 * valaszto mondja meg, melyiket mutatjuk.
 */
describe("a kiadott lapok halmaza", () => {
  it("MIND A KETTO kiadott lap, a feltoltott csatolmany nem", () => {
    assert.equal(isWorksheetIssuedSheet("GENERATED_SHEET"), true);
    assert.equal(isWorksheetIssuedSheet("SIGNED_SHEET"), true);
    /*
      A NEGATIV OLDAL NELKUL egy "mindig igaz" valtozat is zold lenne -- es
      akkor minden feltoltott fenykep a kiadott lapok koze kerulne.
    */
    assert.equal(isWorksheetIssuedSheet("PHOTO"), false);
    assert.equal(isWorksheetIssuedSheet("OTHER"), false);
  });

  it("a halmaz PONTOSAN ezt a kettot tartalmazza", () => {
    assert.deepEqual([...WORKSHEET_ISSUED_SHEET_TYPES].sort(), [
      "GENERATED_SHEET",
      "SIGNED_SHEET",
    ]);
  });
});

describe("melyik lap megy a vevo fele", () => {
  const lezaraskori = { type: "GENERATED_SHEET" as const, nev: "lezaraskori" };
  const vegleges = { type: "SIGNED_SHEET" as const, nev: "vegleges" };

  /**
   * A SORREND NEM SZAMIT, ES EZ A LENYEG.
   *
   * A ket eset KULON all, mert a "legfrissebb nyer" szabaly MA ugyanezt adna --
   * a vegleges kesobb keletkezik. Az viszont EGYBEESES, nem szabaly: egy
   * visszamenoleges potlas, ami a LEZARASKORIT gyartja utolag egy mar alairt
   * verziora, a ket szabalyt szetvalasztana. Ha valaki egyszer idorendre
   * cserelne a tipus szerinti valasztast, EZ a ket allitas pirosodik.
   */
  it("a veglegest valasztja, barmilyen sorrendben all a lista", () => {
    assert.equal(preferSignedSheet([lezaraskori, vegleges])?.nev, "vegleges");
    assert.equal(preferSignedSheet([vegleges, lezaraskori])?.nev, "vegleges");
  });

  it("vegleges nelkul a lezaraskori megy -- nem URES kez", () => {
    assert.equal(preferSignedSheet([lezaraskori])?.nev, "lezaraskori");
  });

  it("ures listara undefined, nem dobas", () => {
    assert.equal(preferSignedSheet([]), undefined);
  });

  /**
   * A FELTOLTOTT CSATOLMANY SOHA NEM LAP.
   *
   * Enelkul egy "add vissza az elsot" valtozat is zold lenne a fenti harom
   * allitasra -- es akkor egy fenykep menne a hibajegy-csomagba munkalap
   * gyanant.
   */
  it("fenykepet SOHA nem ad vissza", () => {
    assert.equal(
      preferSignedSheet([
        { type: "PHOTO" as const, nev: "kep" },
        { type: "OTHER" as const, nev: "egyeb" },
      ]),
      undefined,
    );
  });
});
