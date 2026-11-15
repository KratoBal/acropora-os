import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProductData } from "../product-data/product-data.types.js";
import { unknownOmnibus } from "./calendar-gaps.service.js";

/*
  WHICH SALE PRODUCTS HAVE AN UNKNOWN OMNIBUS VALUE (T5.5 S6). What turns this red: a running sale variant without an
  Omnibus value counted as known; a planned (not running) sale counted; a product the reader did not answer for counted
  as known (barracuda's #2605 note: a missing answer is the unsafe side).
*/
const product = (
  id: string,
  variants: {
    sale: "fut" | "tervezett" | null;
    omnibus: "ismert" | "ismeretlen";
  }[],
): ProductData =>
  ({
    id,
    variants: variants.map((v) => ({
      price: {
        status: "ismert",
        sale: v.sale ? { state: v.sale } : null,
        omnibus:
          v.omnibus === "ismert"
            ? { status: "ismert" }
            : { status: "ismeretlen", reason: "nincs előzmény" },
      },
    })),
  }) as unknown as ProductData;

describe("unknownOmnibus", () => {
  it("a running sale variant without the value is unknown; a known one or a planned sale is not", () => {
    assert.deepEqual(
      unknownOmnibus(
        ["a", "b", "c"],
        [
          product("a", [{ sale: "fut", omnibus: "ismeretlen" }]),
          product("b", [{ sale: "fut", omnibus: "ismert" }]),
          product("c", [{ sale: "tervezett", omnibus: "ismeretlen" }]),
        ],
      ),
      ["a"],
    );
  });

  it("a product the reader did not answer for counts as unknown", () => {
    assert.deepEqual(
      unknownOmnibus(
        ["a", "gone"],
        [product("a", [{ sale: "fut", omnibus: "ismert" }])],
      ),
      ["gone"],
    );
  });
});
