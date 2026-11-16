import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";

import {
  DEFAULT_LIMIT,
  MAX_IDENTIFIERS,
  MAX_LIMIT,
  parseProductDataRequest,
} from "./product-data.query.js";

/*
  WHAT TURNS THIS RED: a request with no filter that returns the whole catalogue; `onSale=yes` or a limit of `abc`
  that quietly becomes a default (the agent would get the answer to a DIFFERENT question, and it would look right).
*/
describe("parseProductDataRequest", () => {
  it("splits and trims identifiers, applies the paging defaults", () => {
    const r = parseProductDataRequest({ ids: " a, b ,,c " });
    assert.deepEqual(r.query, { identifiers: ["a", "b", "c"] });
    assert.equal(r.limit, DEFAULT_LIMIT);
    assert.equal(r.offset, 0);
  });

  it("takes a category list and onSale=true", () => {
    const r = parseProductDataRequest({ category: "c1,c2", onSale: "true" });
    assert.deepEqual(r.query, { categoryIds: ["c1", "c2"], onSale: true });
  });

  it("refuses a request with no filter (and with only empty ones)", () => {
    assert.throws(() => parseProductDataRequest({}), BadRequestException);
    assert.throws(
      () => parseProductDataRequest({ ids: " , ", category: "" }),
      BadRequestException,
    );
  });

  it("refuses a bad value instead of defaulting it", () => {
    for (const params of [
      { ids: "a", onSale: "yes" },
      { ids: "a", onSale: "false" },
      { ids: "a", limit: "abc" },
      { ids: "a", limit: "0" },
      { ids: "a", limit: String(MAX_LIMIT + 1) },
      { ids: "a", offset: "-1" },
      { ids: "a", offset: "1.5" },
    ])
      assert.throws(
        () => parseProductDataRequest(params),
        BadRequestException,
        JSON.stringify(params),
      );
  });

  it("caps the identifiers", () => {
    const ids = Array.from({ length: MAX_IDENTIFIERS + 1 }, (_, i) => `i${i}`);
    assert.throws(
      () => parseProductDataRequest({ ids: ids.join(",") }),
      BadRequestException,
    );
    assert.doesNotThrow(() =>
      parseProductDataRequest({ ids: ids.slice(0, MAX_IDENTIFIERS).join(",") }),
    );
  });
});
