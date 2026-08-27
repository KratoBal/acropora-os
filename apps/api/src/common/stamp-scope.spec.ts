import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * A HELYI IDO SZERINTI BELYEG HATOKORE: PONTOSAN EGY HELY.
 *
 * Az eszkozszam kerul cimkere, es ott egy ember olvassa le -- ezert all az
 * helyi ido szerint, jelolessel. MINDEN mas csalad belyege UTC marad, es ez
 * nem izles: a beszerzesi bizonylatszam es a POS rendelesszam KULSO
 * rendszerbe is kimegy (NAV, UNAS, Szamlazz.hu), es azok alakjanak
 * megvaltoztatasa mar nem a mi korunk.
 *
 * EZ A FAJL AZERT VAN, MERT A HATOKOR EGY SORRAL TAGITHATO. A `stamp` mezot
 * barmelyik hivasi helyre oda lehet irni, es a valtozas SEMMILYEN teszten nem
 * bukna el -- a szam tovabbra is egyedi, a kereses tovabbra is illeszkedik,
 * es csak egy kulso rendszerben derulne ki, honapokkal kesobb.
 */

const MARKED = /stamp:\s*"local-marked"/;

async function sourceFiles(): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of glob("src/**/*.ts"))
    if (!entry.endsWith(".spec.ts")) found.push(entry);
  return found.sort();
}

describe("a helyi idos belyeg hatokore", () => {
  it("csak az eszkozszam keri, senki mas", async () => {
    const files = await sourceFiles();

    // Ures sopres ne latszodjon zoldnek.
    assert.ok(
      files.length >= 100,
      `Csak ${files.length} forrasfajlt talaltam. Ez a keresés hibaja.`,
    );

    const asking = files.filter((file) =>
      MARKED.test(readFileSync(file, "utf8")),
    );

    assert.deepEqual(
      asking,
      ["src/service-assets/service-assets.repository.ts"],
      "A helyi idos, jelolt belyeget ma KIZAROLAG az eszkozszam hasznalhatja. " +
        "Egy uj hely ide felvetele azt jelenti, hogy egy masik csalad szamanak " +
        "az ALAKJA valtozik meg -- a beszerzes es a POS eseteben kulso " +
        "rendszer fele is. Ha ez a szandek, ez a sor is atirando, az indokkal.",
    );
  });

  /**
   * A KONTROLL A KERESESRE. Ha a `stamp` mezo neve vagy az erteke megvaltozik
   * es ezt a fajlt senki nem koveti, a fenti allitas URES halmazon menne
   * vegig, es zolden mondana, hogy minden rendben.
   */
  it("megtalalja azt az egy helyet, amirol allit valamit", () => {
    const source = readFileSync(
      "src/service-assets/service-assets.repository.ts",
      "utf8",
    );

    assert.match(source, MARKED);
    assert.match(source, /prefix:\s*"ESZK"/);
  });
});
