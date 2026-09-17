import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { needsJsonContentType } from "./json-content-type";

describe("needsJsonContentType", () => {
  it("a szöveges törzs kap JSON fejlécet", () => {
    assert.equal(needsJsonContentType(JSON.stringify({ a: 1 })), true);
  });

  /**
   * EZ AZ ÁLLÍTÁS AZ EGÉSZ FÜGGVÉNY OKA.
   *
   * A `FormData` a saját `boundary` értékét viszi; ha felülírjuk
   * `application/json`-ra, a kérés MEGÉRKEZIK, a fájl nélkül, és a telefonon
   * úgy néz ki, mintha magával a fájllal lenne baj.
   *
   * Sima objektummal mérve, nem `FormData` példánnyal: a teszt-fordítás
   * DOM-típus nélkül megy, és a döntés úgysem a FormData mivoltán múlik,
   * hanem azon, hogy a törzs NEM szöveg.
   */
  it("a nem szöveges törzs (FormData is ilyen) NEM kap", () => {
    assert.equal(needsJsonContentType({ append: () => {} }), false);
  });

  it("a hiányzó törzs sem kap", () => {
    assert.equal(needsJsonContentType(undefined), false);
    assert.equal(needsJsonContentType(null), false);
  });
});

/**
 * A DÖNTÉS MEGVOLT, A BEKÖTÉSE NEM VOLT MÉRVE -- ÉS A KETTŐ KÜLÖN ROMLIK EL.
 *
 * A fenti állítások a FÜGGVÉNYT mérik. Ha valaki a `client.ts`-ben „rendet rak" a
 * fejléc-kezelésen és minden törzsre beírja a JSON fejlécet, ezek MIND ZÖLDEK
 * MARADNAK: a függvény tovább ad helyes választ, csak senki nem kérdezi meg.
 *
 * MIÉRT A FORRÁS SZÖVEGÉBŐL: a `client.ts` modul-szinten `fetch`-et, SecureStore-t
 * és a futásidejű környezetet importálja, tehát `node --test` alatt nem tölthető
 * be. A határa kimondva: azt állítja, hogy a képernyő mögötti kliens MEGKÉRDEZI a
 * döntést, nem azt, hogy a kérés a készüléken átmegy.
 */
const KLIENS = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "lib",
  "api",
  "client.ts",
);

describe("a kliens megkérdezi a döntést, nem maga dönt", () => {
  function forras(): string {
    try {
      return readFileSync(KLIENS, "utf8");
    } catch {
      throw new Error(
        `Nem tudtam elolvasni: ${KLIENS}. Ez a KERESÉS hibája, nem a lefedettségé -- az alábbi állítások addig semmit nem mondanak.`,
      );
    }
  }

  it("POZITÍV KONTROLL: a forrás olvasható és nem üres", () => {
    assert.ok(forras().length > 1000, "a forrás üres vagy gyanúsan rövid");
  });

  /**
   * A HÍVÁS ALAKJÁRA illeszt, nem a puszta névre: a név az `import` sorban is ott
   * áll, tehát egy feltétel nélküli `headers.set` mellett is zölden maradna.
   */
  it("a JSON fejléc a döntés MÖGÉ van kötve", () => {
    assert.match(forras(), /if \(needsJsonContentType\(requestInit\.body\)/);
  });

  /**
   * ÉS A TILTÓ OLDAL, mert az állító önmagában nem zárja ki, hogy VALAHOL MÁSHOL
   * mégis bekerüljön. Egy második, feltétel nélküli sor ugyanazt a néma hibát
   * adná vissza, és az előző állítás nem venné észre.
   */
  it("sehol nem ír JSON fejlécet a döntés megkérdezése nélkül", () => {
    const sorok = forras()
      .split("\n")
      .filter((sor) => /headers\.set\(\s*"Content-Type"/.test(sor));

    assert.equal(
      sorok.length,
      1,
      `Content-Type fejlécet ${sorok.length} helyen ír a kliens; pontosan egy várt, a döntés mögött: ${sorok.join(" | ")}`,
    );
  });
});
