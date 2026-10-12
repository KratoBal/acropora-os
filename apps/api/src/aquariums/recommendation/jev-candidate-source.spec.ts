import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  JevRecommendationCandidateSource,
  limitCandidates,
  matchingJevRows,
  MAX_CANDIDATES,
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

describe("a product that moves another measured deviation the wrong way (barracuda, #1668)", () => {
  it("is not a candidate: low calcium and high magnesium, a product raising both", () => {
    const wanted = wantedMoves([
      dev("KALCIUM", "LOW"),
      dev("MAGNEZIUM", "HIGH"),
    ]);
    assert.deepEqual(
      matchingJevRows(
        [
          row({ productId: "both-up", value: "KALCIUM:EMEL;MAGNEZIUM:EMEL" }),
          row({ productId: "ca-only", value: "KALCIUM:EMEL" }),
          row({
            productId: "both-right",
            value: "KALCIUM:EMEL;MAGNEZIUM:CSOKKENT",
          }),
        ],
        wanted,
      ).map((m) => m.productId),
      ["ca-only", "both-right"],
    );
  });
});

describe("the cap the AI side takes (barracuda, #1668)", () => {
  it("at most MAX_CANDIDATES, the ones helping more deviations first, then by name", () => {
    const wanted = wantedMoves([dev("KALCIUM", "LOW"), dev("NITRAT", "HIGH")]);
    const candidate = (name: string, effects: string[]) => ({
      productId: name,
      name,
      category: "",
      basis: "JEV" as const,
      effects: effects.map((e) => {
        const [parameterCode, direction] = e.split(":") as [
          string,
          "EMEL" | "CSOKKENT",
        ];
        return { parameterCode, direction };
      }),
    });
    const many = Array.from({ length: 250 }, (_, i) =>
      candidate(`termek-${String(i).padStart(3, "0")}`, ["KALCIUM:EMEL"]),
    );
    const limited = limitCandidates(
      [...many, candidate("zz-mindketto", ["KALCIUM:EMEL", "NITRAT:CSOKKENT"])],
      wanted,
    );
    assert.equal(MAX_CANDIDATES < 300, true);
    assert.deepEqual(
      [
        limited.length,
        limited[0]!.name,
        limited[1]!.name,
        limited.at(-1)!.name,
      ],
      [MAX_CANDIDATES, "zz-mindketto", "termek-000", "termek-198"],
    );
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

  it("the source itself applies the cap", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `p-${i}`);
    const source = new JevRecommendationCandidateSource();
    (source as unknown as { database: unknown }).database = {
      $queryRaw: async () =>
        ids.map((productId) => row({ productId, value: "KALCIUM:EMEL" })),
      product: {
        findMany: async () =>
          ids.map((id) => ({ id, name: id, categories: [] })),
      },
    };
    const candidates = await source.candidates({
      deviations: [dev("KALCIUM", "LOW")],
    });
    assert.equal(candidates.length, MAX_CANDIDATES);
  });
});
