import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { documentedContentType } from "./service-assets.repository.js";

describe("a tárolt dokumentum típusa", () => {
  it("a sor tényleges PNG típusát adja tovább, nem PDF-et állít", () => {
    assert.equal(documentedContentType("image/png"), "image/png");
  });

  it("ismeretlen régi típust hangosan megállít", () => {
    assert.throws(
      () => documentedContentType("application/x-ismeretlen"),
      /Nem támogatott tárolt dokumentumtípus/,
    );
  });
});
