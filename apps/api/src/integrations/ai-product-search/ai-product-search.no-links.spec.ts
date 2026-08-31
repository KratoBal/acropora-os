import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * A KÉSZLET-VETÍTÉS NEM VISZ URL-T, ÉS EZT MOSTANTÓL TART IS VALAMI.
 *
 * A mérés (2026-08-27) szerint a `UnasProductSnapshot` tábla - amiből ez a
 * vetítés olvas - HÁROM URL-oszlopot tart: `productUrl` és `sefUrl` (a mi
 * boltunk terméklapja) és `manufacturerUrl` (a gyártó oldala). A vetítés
 * egyiket sem viszi, és ez ma helyes.
 *
 * **De eddig SEMMI nem tartotta meg.** A típus fejléc-kommentje egyetlen
 * szándékos hiányt nevezett meg (a `ProductExtension` táblát); az URL-mezők
 * hiánya sehol nem volt döntésként rögzítve, a forrás pedig UGYANAZ a tábla,
 * amiben a három mező áll - vagyis egy sorral vannak attól, hogy bekerüljenek.
 *
 * Ez a teszt nem azt állítja, hogy soha nem kerülhetnek be. Azt állítja, hogy
 * **a bekerülésük ne legyen csendes**: aki hozzáadja, ezt a fájlt is elrontja,
 * és akkor a külső-link szabályról szóló beszélgetés a MEZŐ ELŐTT történik meg,
 * nem utána.
 *
 * SZERKEZETI TESZT, ÉS EZÉRT KÉT KONTROLL TARTOZIK HOZZÁ. Egy mintára épülő
 * ellenőrzés a saját hibájától is zöld lehet: egy elrontott minta nulla
 * találatot ad, egy üresen olvasott fájl szintén - és mindkettő pontosan úgy
 * néz ki, mint a rendben lévő állapot. Ezért az első két teszt a KERESÉST
 * méri, nem a lefedettséget.
 */

const REPOSITORY =
  "src/integrations/ai-product-search/ai-product-search.repository.ts";
const TYPES = "src/integrations/ai-product-search/ai-product-search.types.ts";

/** A három oszlop, ahogy a sémában áll. */
const URL_COLUMNS = ["productUrl", "sefUrl", "manufacturerUrl"] as const;

const read = (file: string) => readFileSync(file, "utf8");

/**
 * A `select` objektum törzse a tárolóból.
 *
 * SZŰKÍTVE, és ez nem kényelem: a fájl KOMMENTJEI szándékosan megnevezik a
 * három oszlopot (azért, hogy a hiány ki legyen mondva). Egy teljes fájlra
 * futó keresés tehát a saját magyarázatunkon bukna el, és az a legrosszabb
 * fajta hamis piros: attól pirosodna, hogy leírtuk, miért nincs ott.
 */
function selectBlock(source: string): string {
  const start = source.indexOf("const select = {");
  assert.notEqual(start, -1, "a tároló `select` objektuma nem található");

  /**
   * A záró zárójelet SZÁMOLÁSSAL keressük, nem behúzással.
   *
   * Az első változatom a `\n    };` alakra illesztett, és a saját kontroll-
   * mintámon bukott el, mert az máshogy volt behúzva. Ez pontosan az, amiért a
   * kontroll létezik: egy behúzás-függő minta egy átformázás után csendben nem
   * találna semmit, és a teszt zölden azt állítaná, hogy nincs URL a
   * vetítésben.
   */
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }

  assert.fail("a `select` objektum vége nem található");
}

describe("a keresés maga (kontroll)", () => {
  /**
   * ELSŐ KONTROLL: a minta MEGTALÁLJA, amit keres. Enélkül egy elgépelt
   * oszlopnév nulla találatot adna, és a teszt zölden azt állítaná, hogy
   * nincs URL a vetítésben.
   */
  it("a három oszlopnevet megtalálja egy mintában, ami tartalmazza őket", () => {
    const sample = `
      const select = {
        unasSnapshot: {
          select: { productUrl: true, sefUrl: true, manufacturerUrl: true },
        },
      };
    `;
    for (const column of URL_COLUMNS)
      assert.ok(
        selectBlock(sample).includes(column),
        `a keresés nem találta meg: ${column}`,
      );
  });

  /**
   * MÁSODIK KONTROLL: a fájlokat tényleg elolvassuk, és a kivágott rész nem
   * üres. Egy üres olvasás ugyanúgy nulla találatot adna.
   */
  it("a fájlokat elolvassa, és a select nem üres", () => {
    const block = selectBlock(read(REPOSITORY));

    assert.ok(
      block.includes("unasSnapshot"),
      "a kivágott select nem tartalmazza az unasSnapshot ágat: rossz helyen vágtunk",
    );
    assert.ok(
      block.length > 200,
      `a kivágott select gyanúsan rövid (${block.length} karakter)`,
    );
    assert.ok(read(TYPES).includes("AiProductSearchHit"));
  });
});

describe("a vetítés nem visz URL-t", () => {
  it("a tároló select-je egyetlen URL-oszlopot sem kér le", () => {
    const block = selectBlock(read(REPOSITORY));

    for (const column of URL_COLUMNS)
      assert.ok(
        !block.includes(column),
        `a vetítés lekéri a(z) ${column} oszlopot. Ez nem mezőbővítés, hanem ` +
          `döntés a külső-link szabályról: amit a modell megkap, azt ` +
          `megismételheti.`,
      );
  });

  it("a vetítés TÍPUSA sem deklarál URL-mezőt", () => {
    /**
     * A típus külön áll: a `select` a lekérdezést mondja meg, a típus azt,
     * amit a hívó LÁTHAT. A kettő elcsúszhat, és a modell felé a típus a
     * szerződés.
     *
     * Itt a fejléc-komment SZÁNDÉKOSAN megnevezi a három oszlopot, ezért a
     * kommentek nélküli szövegben keresünk - különben a magyarázat bukna meg.
     */
    const withoutComments = read(TYPES)
      .replaceAll(/\/\*[\s\S]*?\*\//g, "")
      .replaceAll(/\/\/.*$/gm, "");

    for (const column of URL_COLUMNS)
      assert.ok(
        !withoutComments.includes(column),
        `a vetítés típusa deklarálja a(z) ${column} mezőt`,
      );

    // És a kontroll ehhez is: a komment-eltávolítás nem ette meg a típust.
    assert.ok(withoutComments.includes("AiProductSearchHit"));
  });
});
