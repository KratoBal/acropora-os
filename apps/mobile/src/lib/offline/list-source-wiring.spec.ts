import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * AZ URLAP TENYLEG A KOZOS FORRASBOL EPUL-E.
 *
 * === MIERT KELL EZ, HOLOTT A `list-source.spec.ts` MAR ZOLD ===
 *
 * Mert az a fuggvenyt meri, nem a BEKOTESET. Megmertem: a javitas visszarontasa
 * utan (a helyszin-valaszto megint kozvetlenul a halozati valaszt olvasta) a
 * teljes mobil sor ZOLD MARADT, mind a 744 allitas. Egy ellenorzes, ami a hibat
 * nem tudja pirosra valtani, nem ellenorzes.
 *
 * A mert hiba (2026-09-14, Balazs jelentese a 15 szamu buildrol): az uj eszkoz
 * urlapon a partner-lista visszaesett a mentett masolatra, a helyszin-valaszto
 * viszont nem -- az ket kulon helyen epult, es a masodik nem ismerte a
 * masolatot. Terero nelkul tehat ures maradt, magyarazat nelkul.
 *
 * === MIERT FORRAS-SZOVEG, ES NEM VISELKEDES ===
 *
 * A mobil oldalon nincs kepernyo-renderelo a tesztsorban: minden allitas tiszta
 * fuggvenyen all. Egy React kepernyo bekotese igy csak a forras alakjabol
 * merheto. Ez nem az ideal, es ki is mondom: ha egyszer lesz renderelo, ezt az
 * allitast VISELKEDESRE kell cserelni, nem melle tenni.
 *
 * A mintat az `apps/api/src/mobile/mobile-api-routes.spec.ts` hasznalja mar.
 */
const SCREEN = "src/app/assets/new.tsx";
/**
 * A HELYSZIN-VALASZTO 2026-09-16 OTA KOZOS KOMPONENS (a szerkeszto kepernyo is
 * ezt hasznalja). A `unitLevels` hivas ezzel ATKERULT oda, tehat a hivas
 * ARGUMENTUMAT mar nem itt lehet merni -- de a KERDES valtozatlan: a valaszto a
 * kozos, masolatra visszaeso sorokbol epuljon-e. Az allitas ezert a valaszto
 * BEMENETET meri, nem a belsejet.
 */
const PICKER = "src/components/assets/unit-picker.tsx";

describe("az uj eszkoz urlap listai", () => {
  const source = readFileSync(SCREEN, "utf8");

  /**
   * MINDEN `unitLevels(` HIVAS A KOZOS VALTOZOT KAPJA.
   *
   * Nem azt tiltjuk, hogy a `unitsQuery` szerepeljen a fajlban -- ott kell
   * lennie, a lekeres es a mentes is hasznalja. Azt tiltjuk, hogy a VALASZTO
   * epuljon belole.
   */
  it("a helyszin-valaszto a kozos sorokbol epul, nem a halozati valaszbol", () => {
    const rows = [
      ...source.matchAll(/<UnitPicker[\s\S]*?rows=\{([^}]+)\}/g),
    ].map((match) => match[1]!.trim());
    assert.equal(
      rows.length,
      1,
      `Egy helyszin-valasztot vartam a ${SCREEN} fajlban, ennyit talaltam: ${rows.length}. Ha a kepernyo atalakult, ezt az allitast is at kell irni, nem torolni.`,
    );
    assert.equal(
      rows[0],
      "unitRows",
      `A helyszin-valaszto ${rows[0]} ertekbol epul. Ez volt a 2026-09-14-i hiba: a masolat megvolt, csak nem kerdezte meg senki. A kozos valtozo neve: unitRows.`,
    );

    /**
     * POZITIV KONTROLL A KOMPONENSRE: a `unitLevels` hivas tenyleg ATKERULT, nem
     * eltunt. Enelkul a fenti allitas akkor is zold lenne, ha a valaszto belseje
     * kiurult volna -- es epp az a kerdes, hogy a kapott sorokbol epul-e a fa.
     */
    const valaszto = readFileSync(PICKER, "utf8");
    assert.match(valaszto, /unitLevels\(rows,/);
  });

  /**
   * ES A KET LISTA UGYANAZT A SZABALYT KOVESSE. A hiba abbol allt elo, hogy a
   * partner-listanak volt masolat-visszaesese, a helyszineknek nem -- ket kulon
   * megoldas ugyanarra a kerdesre, es csak az egyik volt jo.
   */
  it("mindket lista a kozos donteshozon at jon", () => {
    const talalat = source.match(/listFromCacheOrNetwork\(/g) ?? [];
    assert.equal(
      talalat.length,
      2,
      `Ket listat vartam a kozos donteshozon at (tulajdonosok es helyszinek), ennyi van: ${talalat.length}.`,
    );
  });
});
