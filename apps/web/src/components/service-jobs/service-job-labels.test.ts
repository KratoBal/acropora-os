import { describe, expect, it } from "vitest";

import {
  serviceJobNoteDescription,
  serviceJobWorksheetLabel,
} from "./service-job-labels";

/**
 * A MEZO LEIRASA AZ ADOTT JEGY LEPESEIHEZ SZABOTT.
 *
 * A megjegyzes ELHAGYHATO, tehat ez nem kovetelmeny, hanem segitseg -- es epp
 * ezert szamit, hogy csak ott alljon, ahol van mit mondani.
 */
describe("serviceJobNoteDescription", () => {
  it("megnevezi a kilépő lépéseket, amikhez tartozik kérdés", () => {
    const text = serviceJobNoteDescription([
      "SCHEDULED",
      "WAITING_FOR_PARTS",
      "CANCELLED",
    ]);

    expect(text).toContain("alkatrészre váráskor");
    expect(text).toContain("meghiúsuláskor");
  });

  /**
   * A SZUKITEST MERO ALLITAS, ES KET FELE VAN.
   *
   * Az elso: a `Folyamatban` jegynel az ellalas FEL SEM MERUL (a tabla nem
   * engedi), tehat emliteni felrevezeto lenne. A masodik: amit MEGIS enged
   * onnan, azt megnevezi. Az elso allitas onmagaban akkor is zold lenne, ha a
   * fuggveny SOHA nem mondana semmit.
   */
  it("nem említi azt a lépést, ami innen nem is mehet", () => {
    const text = serviceJobNoteDescription([
      "COMPLETED",
      "WAITING_FOR_PARTS",
      "WAITING_FOR_CUSTOMER",
    ]);

    expect(text).not.toContain("meghiúsuláskor");
    expect(text).toContain("alkatrészre váráskor");
    expect(text).toContain("ügyfélre váráskor");
  });

  /**
   * A RENDES MENET NEM KAP ZAJT. Ha egyik elerheto lepeshez sem tartozik
   * kerdes, a leirás az alapmondat marad -- egy odabiggyesztett "Erdemes
   * megirni" ures felsorolassal rosszabb a semminel.
   */
  it("kérdés nélküli lépéseknél csak az alapmondat áll", () => {
    const text = serviceJobNoteDescription(["TRIAGED", "SCHEDULED"]);

    expect(text).toContain("Elhagyható.");
    expect(text).not.toContain("Érdemes megírni");
  });

  /**
   * VEGALLAPOTBAN URES A LEPESLISTA, es a fuggveny ilyenkor sem hasal el: a
   * doboz ott mas mondatot mutat, de ez a fuggveny akkor is hivhato.
   */
  it("üres lépéslistára az alapmondatot adja", () => {
    expect(serviceJobNoteDescription([])).toContain("Elhagyható.");
  });
});

/**
 * A LAP NEVE A JEGY ALATT (Balázs kérése, 2026-09-16).
 *
 * A KÉT ÁG KÜLÖN ÁLLÍTÁST KAP, mert a hiba pont a kettő között lakott: a
 * számozott lap MINDIG olvasható volt, a piszkozat SOHA. Egyetlen minta, ami
 * csak a számozottat méri, ugyanúgy zöld maradna, mint ma.
 */
describe("serviceJobWorksheetLabel", () => {
  it("a nevet írja ki, és zárójelben a lap számát", () => {
    expect(
      serviceJobWorksheetLabel({
        number: "BIO-2026-004",
        subject: "Szivattyú csere",
      }),
    ).toBe("Szivattyú csere (BIO-2026-004)");
  });

  it("piszkozatnál a név mellett a Piszkozat szó áll", () => {
    expect(
      serviceJobWorksheetLabel({ number: null, subject: "Szivattyú csere" }),
    ).toBe("Szivattyú csere (Piszkozat)");
  });

  /*
    NEV NELKUL NINCS URES ZAROJEL. A `""` azt jelenti, hogy a laphoz nincs
    verzio, tehat a nevet NEM TUDJUK -- egy "(Piszkozat)" felirat egy hianyzo
    nev elott ugy nezne ki, mintha a lapnak nem VOLNA neve.
  */
  it("név nélkül a régi alak marad, üres zárójel nélkül", () => {
    expect(serviceJobWorksheetLabel({ number: null, subject: "" })).toBe(
      "Piszkozat",
    );
    expect(
      serviceJobWorksheetLabel({ number: "BIO-2026-004", subject: "   " }),
    ).toBe("BIO-2026-004");
  });
});
