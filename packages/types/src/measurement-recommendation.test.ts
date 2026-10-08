import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hasMalformedRecommendationToken,
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

  it("RECO-MALFORMED: a brace left after the real tokens is malformed", () => {
    assert.deepEqual(
      [
        "Jó: {{termek:abc}} és {{termek:x-1}}.",
        "Szóköz: {{termek: abc}}",
        "Ékezet: {{termék:abc}}",
        "Keret: {{ termek:abc }}",
        "Csonka: {{termek:abc",
        "Fél: termek:abc}}",
        "Semmi kapcsos.",
      ].map(hasMalformedRecommendationToken),
      [false, true, true, true, true, true, false],
    );
  });
});
