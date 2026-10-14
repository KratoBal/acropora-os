import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AquariumMeasurementOccasion } from "@acropora/types";

import type { RecommendationDeviation } from "./measurement-recommendation.contract.js";
import { recommendationDeviations } from "./measurement-recommendation.deviations.js";
import {
  pickExamples,
  productShopUrl,
  recommendationSegments,
  unverifiedReferences,
} from "./measurement-recommendation.service.js";

const occasion = (
  measuredAt: string,
  values: [string, number][],
): AquariumMeasurementOccasion =>
  ({
    id: measuredAt,
    measuredAt,
    values: values.map(([parameterCode, value]) => ({ parameterCode, value })),
  }) as AquariumMeasurementOccasion;

describe("measurement recommendation (2b3983e1)", () => {
  it("RECO-UNVERIFIED: the draft's references backed only by our own data, once each, in text order", () => {
    const candidate = (productId: string, unverified?: boolean) => ({
      productId,
      name: productId,
      category: "",
      effects: [],
      basis: "JEV" as const,
      ...(unverified ? { unverified } : {}),
    });
    assert.deepEqual(
      unverifiedReferences(
        "{{termek:b}} és {{termek:a}}, majd {{termek:b}}; {{termek:c}} {{termek:x}}",
        [
          candidate("a", true),
          candidate("b", true),
          candidate("c"),
          candidate("d", true),
        ],
      ),
      // c is verified, d is not referenced, x is no candidate at all
      ["b", "a"],
    );
  });

  it("RECO-DEVIATIONS: only the rows outside their range, with the PDF's status, side and trend", () => {
    const earlier = occasion("2026-10-01T10:00:00.000Z", [["KH", 5]]);
    const now = occasion("2026-10-08T10:00:00.000Z", [
      ["KH", 6],
      ["KALCIUM", 430],
      ["FOSZFAT", 0.3],
      // no range of its own, and no water type for a default: not sent
      ["HOMERSEKLET", 31],
    ]);
    const deviations = recommendationDeviations(now, [now, earlier], null, [
      { parameterCode: "KH", min: 7, max: 9 },
      { parameterCode: "KALCIUM", min: 400, max: 450 },
      { parameterCode: "FOSZFAT", max: 0.1 },
    ]);
    assert.deepEqual(
      deviations.map((d) => [d.parameterCode, d.direction, d.status, d.trend]),
      [
        ["KH", "LOW", "WARN", "IMPROVING"],
        ["FOSZFAT", "HIGH", "ALERT", null],
      ],
    );
  });

  it("RECO-SEGMENTS: a known product gets its name and link; an unknown id none", () => {
    assert.deepEqual(
      recommendationSegments(
        "Ez: {{termek:a}} vagy {{termek:b}}",
        new Map([["a", { name: "A termék", url: "https://x.invalid/a" }]]),
      ),
      [
        { kind: "text", text: "Ez: " },
        {
          kind: "product",
          productId: "a",
          name: "A termék",
          url: "https://x.invalid/a",
        },
        { kind: "text", text: " vagy " },
        { kind: "product", productId: "b", name: null, url: null },
      ],
    );
    assert.deepEqual(recommendationSegments(null, new Map()), []);
  });

  /**
   * MI PIROSÍT: ha a link a soha nem írt `isPublished`-en múlik (a szinkron
   * státuszt és címet ír, publikálást nem), ha egy inaktív (0) vagy ismeretlen
   * státuszú termék is linket kap, ha a webshop csatorna sora kerül elő, vagy ha
   * nem http(s) cím lesz link.
   */
  it("RECO-SHOP-URL: the UNAS page of a product active in the shop; nothing for an inactive, unknown or non-http one", () => {
    const unas = (
      externalStatus: string | null,
      productUrl: string | null,
    ) => ({
      channel: "UNAS",
      externalStatus,
      productUrl,
    });
    const url = "https://bolt.example.invalid/kh";
    assert.deepEqual(
      [
        productShopUrl([
          {
            channel: "WEBSHOP",
            externalStatus: "1",
            productUrl: "https://w.invalid/",
          },
          unas("1", url),
        ]),
        productShopUrl([unas("2", url)]),
        productShopUrl([unas("3", url)]),
        productShopUrl([unas("0", url)]),
        productShopUrl([unas(null, url)]),
        productShopUrl([unas("1", null)]),
        productShopUrl([unas("1", "javascript:alert(1)")]),
        productShopUrl([
          { channel: "WEBSHOP", externalStatus: "1", productUrl: url },
        ]),
      ],
      [url, url, url, null, null, null, null, null],
    );
  });

  it("RECO-EXAMPLES: the matching approved pairs, the corrected ones first, at most three", () => {
    const d = (
      parameterCode: string,
      direction: "LOW" | "HIGH",
    ): RecommendationDeviation =>
      ({ parameterCode, direction }) as RecommendationDeviation;
    const row = (
      id: string,
      deviations: RecommendationDeviation[],
      aiDraft: string,
      approvedText: string,
    ) => ({
      id,
      input: { waterType: null, volumeLiters: null, deviations },
      aiDraft,
      approvedText,
    });
    const picked = pickExamples(
      [d("KH", "LOW")],
      [
        row("same-1", [d("KH", "LOW")], "x", "x"),
        row("other-dir", [d("KH", "HIGH")], "x", "y"),
        row("fixed-1", [d("KH", "LOW"), d("FOSZFAT", "HIGH")], "x", "y"),
        row("same-2", [d("KH", "LOW")], "x", "x"),
        row("fixed-2", [d("KH", "LOW")], "a", "b"),
      ],
    );
    assert.deepEqual(
      picked.map((p) => p.id),
      ["fixed-1", "fixed-2", "same-1"],
    );
  });
});
