import { describe, expect, it } from "vitest";

import { serviceJobNoteDescription } from "./service-job-labels";

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
    expect(text).toContain("elálláskor");
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

    expect(text).not.toContain("elálláskor");
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
