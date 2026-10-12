import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  JevRecommendationCandidateSource,
  matchingJevRows,
  wantedMoves,
  type JevEffectRow,
} from "./jev-candidate-source.js";
import type { RecommendationDeviation } from "./measurement-recommendation.contract.js";

/**
 * A JELÖLTEK A JEV-BŐL (kártya 2b3983e1). MI PIROSÍT: az irány megfordul
 * (alacsony kalciumra csökkentő termék); egy ellenőrizetlen vagy ütköző
 * érték jelölt lesz; egy olvashatatlan érték elviszi a többit; egy inaktív
 * termék jelölt lesz; eltérés nélkül is lekérdez.
 */
const dev = (
  parameterCode: string,
  direction: "LOW" | "HIGH",
): RecommendationDeviation =>
  ({
    parameterCode,
    direction,
    measured: 1,
    unit: "mg/l",
    status: "WARN",
    trend: null,
  }) as RecommendationDeviation;

const row = (over: Partial<JevEffectRow>): JevEffectRow => ({
  productId: "p",
  status: "VERIFIED",
  value: "KALCIUM:EMEL",
  sourceRef: "https://gyarto.example/termek",
  ...over,
});

describe("what the measurement wants", () => {
  it("low raises, high lowers", () => {
    assert.deepEqual(
      [...wantedMoves([dev("KALCIUM", "LOW"), dev("NITRAT", "HIGH")])],
      [
        ["KALCIUM", "EMEL"],
        ["NITRAT", "CSOKKENT"],
      ],
    );
  });
});

describe("the JEV rows that help", () => {
  it("only a verified value that moves a deviating parameter the right way", () => {
    const wanted = wantedMoves([dev("KALCIUM", "LOW"), dev("NITRAT", "HIGH")]);
    const found = matchingJevRows(
      [
        row({ productId: "ca-up", value: "KALCIUM:EMEL;KH:EMEL" }),
        row({ productId: "ca-down", value: "KALCIUM:CSOKKENT" }),
        row({
          productId: "no3-down",
          value: "NITRAT:CSOKKENT",
          sourceRef: null,
        }),
        row({ productId: "unverified", status: "UNVERIFIED" }),
        row({ productId: "conflict", status: "CONFLICTING" }),
        row({ productId: "garbage", value: "kalcium fel" }),
        row({ productId: "empty", value: null }),
        row({ productId: "other", value: "FOSZFAT:CSOKKENT" }),
      ],
      wanted,
    );
    assert.deepEqual(found, [
      {
        productId: "ca-up",
        effects: [
          { parameterCode: "KALCIUM", direction: "EMEL" },
          { parameterCode: "KH", direction: "EMEL" },
        ],
        evidenceRef: "https://gyarto.example/termek",
      },
      {
        productId: "no3-down",
        effects: [{ parameterCode: "NITRAT", direction: "CSOKKENT" }],
      },
    ]);
  });
});

describe("the source", () => {
  it("the active products among the matches, with their category; no deviation, no query", async () => {
    let queries = 0;
    let asked: unknown;
    const source = new JevRecommendationCandidateSource();
    (source as unknown as { database: unknown }).database = {
      $queryRaw: async () => {
        queries++;
        return [
          row({ productId: "aktiv", value: "KALCIUM:EMEL" }),
          row({ productId: "inaktiv", value: "KALCIUM:EMEL" }),
        ];
      },
      product: {
        findMany: async (args: { where: unknown }) => {
          asked = args.where;
          return [
            {
              id: "aktiv",
              name: "Kalcium adalék",
              categories: [{ category: { name: "Adalékok" } }],
            },
          ];
        },
      },
    };
    assert.deepEqual(await source.candidates({ deviations: [] }), []);
    assert.equal(queries, 0);
    const candidates = await source.candidates({
      deviations: [dev("KALCIUM", "LOW")],
    });
    assert.deepEqual(asked, {
      id: { in: ["aktiv", "inaktiv"] },
      isActive: true,
    });
    assert.deepEqual(candidates, [
      {
        productId: "aktiv",
        name: "Kalcium adalék",
        category: "Adalékok",
        effects: [{ parameterCode: "KALCIUM", direction: "EMEL" }],
        basis: "JEV",
        evidenceRef: "https://gyarto.example/termek",
      },
    ]);
  });
});
