import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseRecommendationText,
  recommendationProductIds,
} from "./measurement-recommendation.js";

describe("parseRecommendationText (2b3983e1)", () => {
  it("RECO-PARSE: text and product tokens in order; a malformed token stays text", () => {
    assert.deepEqual(
      parseRecommendationText(
        "A KH alacsony: {{termek:cmp1}} segít, vagy {{termek:cmp-2_x}}. {{termek:}} {{termek:a b}}",
      ),
      [
        { kind: "text", text: "A KH alacsony: " },
        { kind: "product", productId: "cmp1" },
        { kind: "text", text: " segít, vagy " },
        { kind: "product", productId: "cmp-2_x" },
        { kind: "text", text: ". {{termek:}} {{termek:a b}}" },
      ],
    );
    assert.deepEqual(parseRecommendationText(""), []);
    assert.deepEqual(parseRecommendationText("{{termek:x}}"), [
      { kind: "product", productId: "x" },
    ]);
  });

  it("RECO-IDS: each referenced product once, in first-seen order", () => {
    assert.deepEqual(
      recommendationProductIds(
        "{{termek:b}} és {{termek:a}}, majd {{termek:b}}",
      ),
      ["b", "a"],
    );
  });
});
