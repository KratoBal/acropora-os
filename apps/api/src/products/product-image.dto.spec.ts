// a class-validator dekorátorai a metaadatot olvassák, amit élesben a `main.ts` telepít
import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { SetProductImageAltDto } from "./dto/product-image.dto.js";

/**
 * A KÉP ALT-SZÖVEGE KÖTELEZŐ MEZŐ (T4.1-D3, barracuda #2139). MI PIROSÍT: ha a
 * mező nélküli törzs átmegy (az csendben törölné a kézi alt-ot); ha a szándékos
 * null vagy az üres szöveg (mindkettő törlés) elakad; ha a nem szöveg vagy a
 * túl hosszú szöveg átmegy.
 */
const hibas = (body: object) =>
  validateSync(plainToInstance(SetProductImageAltDto, body)).length > 0;

describe("SetProductImageAltDto", () => {
  it("a szöveget, az üres szöveget és a null-t (törlés) elfogadja", () => {
    for (const altText of ["Acropora millepora, felülnézet", "", null])
      assert.equal(hibas({ altText }), false, String(altText));
    assert.equal(hibas({ altText: "a".repeat(300) }), false);
  });

  it("a hiányzó mezőt, a nem szöveget és a túl hosszút elutasítja", () => {
    assert.equal(hibas({}), true, "{}");
    assert.equal(hibas({ alt: "elírt mezőnév" }), true, "elírt mezőnév");
    assert.equal(hibas({ altText: 5 }), true, "szám");
    assert.equal(hibas({ altText: "a".repeat(301) }), true, "301 karakter");
  });
});
