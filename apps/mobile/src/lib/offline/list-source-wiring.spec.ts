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
  /**
   * A PARTNER-SAV A PARTNER-MONDATOT KAPJA, NEM A HELYSZINET.
   *
   * === A MERT HIBA (2026-09-16, a 710-ben javitva) ===
   *
   * A partner-valaszto folott a HELYSZIN-fuggveny szovege allt, es ures
   * gyorsitotarnal ezt mondta: "Ehhez a partnerhez nincs mentett helyszin ...
   * nyisd meg egyszer a partnert". A felhasznalo MEG NEM valasztott partnert,
   * es epp a PARTNER-lista volt ures -- a mondat masrol beszelt, es olyan
   * lepest javasolt, ami abbol az allapotbol nem elvegezheto.
   *
   * === MIERT KELL ORZO A HIVOHELYRE, HOLOTT A FUGGVENY MAR MERVE VAN ===
   *
   * Mert lemertem: a partner-savot visszamutatva a helyszin-fuggvenyre MINDEN
   * teszt zold maradt (749 lefutott, 0 piros). A FUGGVENY vedve volt, a
   * HIVOHELY nem -- es a hiba epp a hivohelyen allt. Egy ellenorzes, ami a
   * hibat nem tudja pirosra valtani, nem ellenorzes.
   *
   * A HATARA UGYANAZ, mint a fajl tobbi allitasae: a SZERKEZETET meri, nem azt,
   * hogy a mondat jol hangzik. Ha egyszer lesz kepernyo-renderelo, ezt
   * VISELKEDESRE kell cserelni, nem melle tenni.
   */
  it("a partner-sav a partner-mondatot kapja, a helyszin-sav a helyszinet", () => {
    const ownersFrom = source.indexOf("const ownersNotice");
    const unitsFrom = source.indexOf("const unitsNotice");
    // A KONTROLL A KERESESRE: ket horgony nelkul az alabbi ket szelet URES
    // lenne, es minden allitas zolden menne at rajta.
    assert.ok(ownersFrom > -1, "nincs `ownersNotice` a képernyőn");
    assert.ok(
      unitsFrom > ownersFrom,
      "nincs `unitsNotice` az `ownersNotice` után",
    );

    const ownersBlock = source.slice(ownersFrom, unitsFrom);
    const unitsBlock = source.slice(unitsFrom, unitsFrom + ownersBlock.length);

    assert.match(ownersBlock, /describeCachedOwnersNotice/);
    assert.doesNotMatch(
      ownersBlock,
      /describeCachedDepartmentsNotice/,
      "a partner-sáv a HELYSZÍN mondatát kapja",
    );
    // ES A TULSO IRANY: a helyszin-sav se csusszon at a partner-mondatra.
    assert.match(unitsBlock, /describeCachedDepartmentsNotice/);
    assert.doesNotMatch(
      unitsBlock,
      /describeCachedOwnersNotice/,
      "a helyszín-sáv a PARTNER mondatát kapja",
    );
  });

  /**
   * ES A SZAMLALO IS A SAJAT LISTAJABOL JON.
   *
   * Nem szorszalhasogatas: a mondat KET allapotot valaszt szet a `count`
   * alapjan ("nincs mentett sor" kontra "mentett sorokbol"). Ha a partner-sav a
   * HELYSZIN listajanak hosszat kapna, ures partner-lista mellett is azt
   * allitana, hogy van mibol valasztani.
   */
  it("mindkét sáv a SAJÁT listájának hosszát adja át", () => {
    const ownersFrom = source.indexOf("const ownersNotice");
    const unitsFrom = source.indexOf("const unitsNotice");
    const ownersBlock = source.slice(ownersFrom, unitsFrom);

    assert.match(ownersBlock, /count: cachedOwners\.items\.length/);
    assert.doesNotMatch(ownersBlock, /cachedUnits/);
  });
});
