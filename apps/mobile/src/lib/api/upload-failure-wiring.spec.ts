import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * MIND A HÁROM FELTÖLTŐ KÉPERNYŐ MEGMONDJA, MIÉRT HALT EL A KÜLDÉS.
 *
 * A MÉRT HIBA, 2026-09-17: Balázs 11:13-kor megerősítette, hogy a telefonról
 * MÉG SOHA nem ment fel kép. Három körben kerestük vakon, mi hal el -- és a
 * keresést épp az akasztotta meg, hogy a képernyő egyetlen, fix mondatot adott
 * („A szerver jelenleg nem érhető el"), miközben az okot az `ApiNetworkError`
 * `cause` mezője MÁR HORDOZTA.
 *
 * A HATÁRA KIMONDVA: ezek az állítások a forrást olvassák, tehát azt mérik,
 * hogy a helyes hívás ott áll -- nem azt, hogy a szerelő LÁTJA a mondatot, és
 * végképp nem azt, hogy a feltöltés működik.
 *
 * MINDEN MINTA A HÍVÁS ALAKJÁRA ILLESZT, ÉS A DARABSZÁMOT IS MÉRI. Ugyanaznap
 * háromszor fordult elő, hogy egy puszta névre illesztő állítás ZÖLD MARADT egy
 * valódi rontásra, mert az `import` sor életben tartotta a nevet.
 */
const KEPERNYOK = [
  "src/app/assets/[id].tsx",
  "src/app/service-jobs/[id].tsx",
  "src/app/worksheets/[id].tsx",
] as const;

const olvas = (ut: string) => readFileSync(ut, "utf8");

describe("a feltöltés bukása megmondja, mi történt", () => {
  it("POZITÍV KONTROLL: mind a három képernyő olvasható és nem üres", () => {
    for (const ut of KEPERNYOK)
      assert.ok(olvas(ut).length > 2000, `${ut}: üres vagy gyanúsan rövid`);
  });

  /**
   * A HÁROM KÉPERNYŐ UGYANAZT A MÉRHETŐ DÖNTÉST HÍVJA, nem három saját
   * mondatot ír. Három másolatból egyszer az egyik változna meg -- és ebben az
   * appban a fénykép-menet MÁR EGYSZER négyszer másolódott le, mielőtt valaki
   * kiemelte.
   */
  it("mind a három a közös döntést hívja", () => {
    for (const ut of KEPERNYOK)
      assert.match(
        olvas(ut),
        /describeUploadFailure\(\{/,
        `${ut}: nem a közös döntést hívja`,
      );
  });

  /**
   * A HÁLÓZATI ÁGAT MEG KELL KÜLÖNBÖZTETNI. Enélkül a szerver saját üzenete
   * („túl nagy fájl") is „nem jutott el a szerverig" alakban jelenne meg -- és
   * a szerelő a térerőt kezdené keresni egy olyan hiba miatt, amit a szerver
   * MEGNEVEZETT.
   */
  it("mind a három megkülönbözteti a hálózati bukást a válaszolt hibától", () => {
    for (const ut of KEPERNYOK)
      assert.match(
        olvas(ut),
        /networkFailure: (?:error|cause) instanceof ApiNetworkError/,
        `${ut}: nem különbözteti meg a hálózati bukást`,
      );
  });

  /**
   * A KÉP HIVATKOZÁSA IS ELMEGY, mert a legerősebb mai jelölt az, hogy a natív
   * réteg nem tudja megnyitni, amit a képválasztó adott. A séma az az egy mező,
   * amiből ez eldől -- és a KÖVETKEZŐ próbálkozásnál ez mondja meg.
   */
  it("mind a három elküldi a kép hivatkozását is", () => {
    for (const ut of KEPERNYOK)
      assert.match(
        olvas(ut),
        /uris: (?:files|photos)\.map\(\(f\) => f\.uri\)/,
        `${ut}: a kép hivatkozása nem jut el a mondatba`,
      );
  });

  /**
   * ÉS EGYIK SEM ÍR SAJÁT, NÉMA MONDATOT A BUKÁS ÁGÁRA. Ez a hiba KONKRÉT
   * alakja volt: `error instanceof Error ? error.message : "..."` -- ami
   * hálózati hibánál épp a fix, semmitmondó szöveget adta vissza.
   *
   * A MINTA A `catch` ÁGRA SZŰKÍT: a `describeRejection` ugyanezt az alakot
   * használja, és ott HELYES -- ott a szerver VÁLASZOLT, tehát az ő üzenete a
   * jó. Egy szűkítés nélküli tiltás ezt is elvágná.
   */
  it("egyik sem esik vissza a néma mondatra a catch ágon", () => {
    for (const ut of KEPERNYOK) {
      const s = olvas(ut);
      assert.doesNotMatch(
        s,
        /\} catch \((?:error|cause)\) \{\s*set\w+\(\s*(?:error|cause) instanceof Error/,
        `${ut}: a catch ág megint a néma mondatra esik vissza`,
      );
    }
  });
});
