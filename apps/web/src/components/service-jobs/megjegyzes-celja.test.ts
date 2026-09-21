import { describe, expect, it } from "vitest";

import { megjegyzesKuldheto } from "./megjegyzes-celja";

/**
 * A SZABALY EGY NEMA UTAT ZAR LE: egy sikertelen lepes utan megtartott szoveg
 * NEM mehet el csendben egy MASIK atmenettel.
 *
 * A cimke-fuggvenyt a teszt adja, mert a szabaly szandekosan nem ismeri a
 * felirat-tablat -- igy felulet nelkul merheto.
 */
const CIMKE = (lepes: string) =>
  ({
    WAITING_FOR_PARTS: "Alkatrészre vár",
    CANCELLED: "Meghiúsult",
    COMPLETED: "Lezárva",
  })[lepes] ?? lepes;

describe("megjegyzesKuldheto", () => {
  /*
    A POZITIV IRANY ELOSZOR, ES NEM UDVARIASSAGBOL: e nelkul egy "mindent
    megallitunk" szabaly is zold lenne, es akkor a jegy egyetlen lepese sem
    menne at megjegyzessel.
  */
  it("átengedi a szöveget ahhoz a lépéshez, amihez készült", () => {
    const e = megjegyzesKuldheto({
      szoveg: "Szivattyú rendelve",
      celzott: "WAITING_FOR_PARTS",
      most: "WAITING_FOR_PARTS",
      cimke: CIMKE,
    });
    expect(e.rendben).toBe(true);
  });

  it("MEGÁLL, ha a szöveg MÁSIK lépéshez készült", () => {
    const e = megjegyzesKuldheto({
      szoveg: "Szivattyú rendelve",
      celzott: "WAITING_FOR_PARTS",
      most: "CANCELLED",
      cimke: CIMKE,
    });

    expect(e.rendben).toBe(false);
    /*
      A MONDAT MIND A KET LEPEST MEGNEVEZI. Egy "nem lehet elküldeni" alakú
      üzenet a kezelőt találgatásra küldené: nem tudná, melyik szöveg melyik
      gombhoz tartozik, és a leggyorsabb kiút a törlés volna -- vagyis épp az,
      amit a szabály el akar kerülni.
    */
    if (e.rendben) throw new Error("ide nem juthatunk");
    expect(e.uzenet).toContain("Alkatrészre vár");
    expect(e.uzenet).toContain("Meghiúsult");
  });

  /*
    AZ URES MEZO SOHA NEM AKADALY. Enelkul egy korabbi bukas utan a kezelo a
    szoveg torlese utan SEM tudna tovabblepni -- egy javitas, ami rosszabb a
    hibanal.
  */
  it("üres mezőnél nem áll meg, akkor sem, ha volt korábbi cél", () => {
    const e = megjegyzesKuldheto({
      szoveg: "   ",
      celzott: "WAITING_FOR_PARTS",
      most: "CANCELLED",
      cimke: CIMKE,
    });
    expect(e.rendben).toBe(true);
  });

  /*
    A FRISS SZOVEG NEM TARTOZIK SEMMIHEZ, tehat nincs mihez merni. Ezt a hatart
    a modul fejlece is kimondja: az elso gomb melletti elgepelest ez a szabaly
    NEM fogja meg, es azt egy megerosito lepes fogna -- az termek-dontes.
  */
  it("friss szöveget bármelyik lépéshez enged", () => {
    const e = megjegyzesKuldheto({
      szoveg: "Ügyfél kérte",
      celzott: null,
      most: "CANCELLED",
      cimke: CIMKE,
    });
    expect(e.rendben).toBe(true);
  });
});
