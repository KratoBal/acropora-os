import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { jegyNaploSora } from "./service-job-package-log.js";

const MIKOR = new Date("2026-09-20T08:00:00.000Z");

const sor = (belso: boolean, note: string | null = "Alkatrészre várunk") =>
  jegyNaploSora({
    at: MIKOR,
    toStatus: "WAITING_FOR_PARTS",
    note,
    authorName: "Kiss Márta",
    belso,
  });

/**
 * A DOKUMENTUMCSOMAG NAPLOSORA. Balazs dontese, 2026-09-21: "a megjegyzes nem
 * kell a nev igen", majd "keruljon ki onnan is" -- az utobbi errol a PDF-rol.
 */
describe("mi kerul a dokumentumcsomag naplosorába", () => {
  /**
   * A PARTNER CSOMAGJABAN NINCS MEGJEGYZES. Ez a dontes egyik fele.
   */
  it("a partner csomagjából kimarad a megjegyzés", () => {
    const eredmeny = sor(false);
    assert.ok(!eredmeny.text.includes("Alkatrészre várunk"));
    assert.ok(!eredmeny.text.includes("—"));
  });

  /**
   * A BELSO CSOMAGBAN OTT VAN, ES EZ NEM MELLEKES ALLITAS.
   *
   * Enelkul egy kesobbi "egyszerusites" mind a kettobol kivenne a
   * megjegyzest, es az SENKINEK nem tunne fel: a partner ugyis nem latja, a
   * belso olvaso pedig nem tudna, hogy latnia kene.
   */
  it("a belső csomagban OTT VAN a megjegyzés", () => {
    assert.match(sor(true).text, /Alkatrészre várunk/);
  });

  /**
   * A NEV MARAD, MIND A KET OLDALON. Balazs kulon kimondta ("a nev igen"). Ha
   * csak a megjegyzes tavozasat allitanank, a nev egy kesobbi korben csendben
   * elmehetne vele.
   */
  it("a rögzítő kolléga neve mind a két csomagban megmarad", () => {
    assert.equal(sor(false).authorName, "Kiss Márta");
    assert.equal(sor(true).authorName, "Kiss Márta");
  });

  /**
   * AZ ALLAPOT A PARTNER SZAVAVAL ALL OTT, nem a belso nevevel -- a nyolc
   * belso allapot az, amit a partner NEM lat. Ez a sor eddig is igy mukodott,
   * es a megjegyzes kivetele nem viheti el.
   */
  it("az állapot a partner nyelvén áll, mind a két csomagban", () => {
    assert.match(sor(false).text, /Feldolgozás alatt/);
    assert.match(sor(true).text, /Feldolgozás alatt/);
    assert.ok(!sor(false).text.includes("Alkatrészre vár,"));
  });

  /** A HIANYZO CEL-ALLAPOT KIMONDVA ALL, nem ures helyen. */
  it("a hiányzó cél-állapot kimondva áll", () => {
    const eredmeny = jegyNaploSora({
      at: MIKOR,
      toStatus: null,
      note: null,
      authorName: null,
      belso: false,
    });
    assert.match(eredmeny.text, /nincs megadva/);
  });

  /**
   * ES A SZOLGALTATAS TENYLEG A HATOKORBOL SZARMAZTATJA a kapcsolot -- nem egy
   * fix `false`-t ad at. Enelkul a fenti ot allitas egy olyan valtozatot is
   * zolden hagyna, ami a BELSO olvasotol is elveszi a megjegyzest.
   *
   * A HATARA KIMONDVA: ez a forras szoveget olvassa. Egy masik uton szamolt,
   * ugyanolyan nevu valtozo atcsuszna rajta.
   */
  it("POZITÍV KONTROLL: a szolgáltatás a hatókörből adja a kapcsolót", () => {
    const forras = readFileSync(
      new URL(
        "../../src/service-jobs/service-job-package.service.ts",
        import.meta.url,
      ),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, " ");
    assert.match(forras, /belso: scope\.kind === "internal"/);
  });
});
