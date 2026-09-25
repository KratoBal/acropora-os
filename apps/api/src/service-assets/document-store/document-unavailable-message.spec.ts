import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { documentUnavailableMessage } from "./document-store.js";

/**
 * A HIANYZO VALTOZO A MAI UZENETET ADJA -- EZ A BIZONYITEK, HOGY ELESBEN
 * NULLA VALTOZAS TORTENIK.
 */
describe("documentUnavailableMessage", () => {
  it("a változó nélkül a MAI üzenetet adja", () => {
    assert.equal(
      documentUnavailableMessage({}),
      "A csatolmány tartalma a tárolóban nem érhető el.",
    );
  });

  it("egy elgépelt vagy örökölt érték NEM nyit staging-üzenetet", () => {
    for (const ertek of ["", "true", "1", "yes", "LIVEE"]) {
      assert.equal(
        documentUnavailableMessage({ DOCUMENT_STORE_STAGING_HINT: ertek }),
        "A csatolmány tartalma a tárolóban nem érhető el.",
        `érték: ${JSON.stringify(ertek)}`,
      );
    }
  });

  it("`live` értéknél a teszt-szerveri üzenet megy, kis- és nagybetűtől függetlenül", () => {
    for (const ertek of ["live", "LIVE", " Live "]) {
      assert.equal(
        documentUnavailableMessage({ DOCUMENT_STORE_STAGING_HINT: ertek }),
        "A fájl csak az éles rendszerben érhető el.",
        `érték: ${JSON.stringify(ertek)}`,
      );
    }
  });
});
