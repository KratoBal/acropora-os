import assert from "node:assert/strict";
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
