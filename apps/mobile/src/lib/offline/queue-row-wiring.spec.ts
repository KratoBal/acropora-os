import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A SOR-KÉPERNYŐ BEKÖTÉSE: A HATÁR A KONSTANSBÓL JÖN.
 *
 * Ebben a csomagban nincs komponens-teszt, ezért ez az állítás a képernyő
 * FORRÁSÁT olvassa. A HATÁRA kimondva: azt méri, hogy a képernyő a helyes
 * hívást írja le, nem azt, hogy a szerelő LÁTJA a mondatot. Magát a mondatot
 * a `queue-drain.spec.ts` méri, viselkedésben.
 *
 * MIÉRT KÜLÖN FÁJL, ÉS NEM A `queue-drain.spec.ts`-BEN: ott a `queue-store`
 * neve nem szerepelhet importként (`expo-sqlite`-on át behúzza a react-native
 * globális típusait, és attól egy ÉRINTETLEN spec áll meg). Itt viszont csak a
 * forrás SZÖVEGÉT olvassuk, tehát a név nem hoz futásidejű függőséget.
 *
 * MINDEN MINTA A HÍVÁS ALAKJÁRA ILLESZT, NEM A PUSZTA NÉVRE -- egy név-alapú
 * állítást az `import` sor zölden tartana.
 */
const KEPERNYO = "src/app/queue.tsx";
const SZAMOLO = "src/lib/offline/queue-drain.ts";

const olvas = (ut: string) => readFileSync(ut, "utf8");

describe("a sor-képernyő ismétlődő-hiba jelzése", () => {
  it("POZITÍV KONTROLL: a két fájl olvasható és nem üres", () => {
    for (const ut of [KEPERNYO, SZAMOLO])
      assert.ok(olvas(ut).length > 2000, `${ut}: üres vagy gyanúsan rövid`);
  });

  /**
   * A HATÁRT A KONSTANSBÓL VESZI, NEM MÁSOLT SZÁMBÓL.
   *
   * MI PIROSÍT: egy beírt `3`. Ha a határ valaha négyre nő, egy másolt hármas
   * CSENDBEN eltérne az összesítőtől: a kezdőlap ismétlődő hibát mondana, a sor
   * pedig semleges számot ugyanarra a tételre.
   */
  it("a képernyő a KONSTANST adja át, nem beégetett számot", () => {
    assert.match(
      olvas(KEPERNYO),
      /describeAttemptCount\(\s*entry\.attemptCount,\s*ISMETLODO_HIBA_HATAR,?\s*\)/,
    );
  });

  /**
   * ÉS A RÉGI, MINŐSÍTÉS NÉLKÜLI ALAK NINCS TÖBBÉ A KÉPERNYŐN.
   *
   * 2026-09-17-ig a sor egy puszta számot írt ki a meta-sorba, saját
   * karakterláncból. Ha valaki visszaírja, a jelzés MELLETTE állna, és a
   * szerelő két különböző mondatot látna ugyanarról.
   */
  it("a puszta kísérlet-szám nem áll ott külön", () => {
    assert.doesNotMatch(
      olvas(KEPERNYO),
      /\$\{entry\.attemptCount\} feltöltési/,
    );
  });

  /**
   * A SZÁMOLÓ A HATÁRT PARAMÉTERKÉNT VESZI, NEM MAGÁTÓL OLVASSA.
   *
   * Ez tartja a `queue-drain.ts`-t mentesen a `queue-store` importjától -- és
   * ezen múlik, hogy a viselkedés-teszt egyáltalán lefusson. Ha valaki a
   * függvénybe emeli a konstanst, a spec-készlet fordítása hasal el, egy
   * ÉRINTETLEN fájlon.
   */
  it("a számoló paraméterként kapja a határt", () => {
    assert.match(
      olvas(SZAMOLO),
      /export function describeAttemptCount\(\s*attemptCount: number,\s*threshold: number,?\s*\)/,
    );
    assert.doesNotMatch(olvas(SZAMOLO), /from "\.\/queue-store"/);
  });
});
