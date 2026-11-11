import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toProjectedCandidateRows } from "./customer-candidate-projection.rules.js";
import type {
  CustomerCandidatesOfMove,
  CustomerRecommendationCandidate,
} from "./customer-candidate-source.js";

/**
 * A VEVŐI JELÖLTEK VETÍTETT SORAI (V3.4 S2b). MI PIROSÍT: a foszfát (vagy bármely nem jóváhagyott paraméter) sora bekerül; https nélküli
 * forrás-hivatkozású sor kimegy; egy mozgáshoz 5-nél több sor; a rang nem 1-től a sorrendben; egy termék kétszer ugyanazon a
 * mozgáson; a bolti cím nem http(s)-re szűrt.
 */
const ALL_MOVES = (
  ["KH", "KALCIUM", "MAGNEZIUM", "NITRAT", "FOSZFAT", "PH"] as const
).flatMap((parameterCode) => [
  { parameterCode, direction: "EMEL" as const },
  { parameterCode, direction: "CSOKKENT" as const },
]);
const candidate = (
  productId: string,
  over: Partial<CustomerRecommendationCandidate> = {},
): CustomerRecommendationCandidate => ({
  productId,
  name: `Termék ${productId}`,
  category: "Adalékok",
  // a fixture serving every move, so the tests are about the other rules; the effect rule has its own test
  effects: ALL_MOVES,
  sideEffects: [],
  evidenceRef: "https://gyarto.example/termek",
  shopUrl: "https://shop.example/termek",
  ...over,
});
const entry = (
  parameterCode: string,
  direction: "EMEL" | "CSOKKENT",
  candidates: CustomerRecommendationCandidate[],
): CustomerCandidatesOfMove => ({ parameterCode, direction, candidates });

describe("toProjectedCandidateRows", () => {
  it("one row per candidate, the rank from 1 in the order given, the fields carried over", () => {
    const rows = toProjectedCandidateRows([
      entry("KALCIUM", "EMEL", [candidate("a"), candidate("b")]),
    ]);
    assert.deepEqual(rows, [
      {
        parameterCode: "KALCIUM",
        direction: "EMEL",
        productId: "a",
        productName: "Termék a",
        category: "Adalékok",
        shopUrl: "https://shop.example/termek",
        evidenceRef: "https://gyarto.example/termek",
        effects: ALL_MOVES.map(
          (move) => `${move.parameterCode}:${move.direction}`,
        ),
        sideEffects: [],
        rank: 1,
      },
      {
        parameterCode: "KALCIUM",
        direction: "EMEL",
        productId: "b",
        productName: "Termék b",
        category: "Adalékok",
        shopUrl: "https://shop.example/termek",
        evidenceRef: "https://gyarto.example/termek",
        effects: ALL_MOVES.map(
          (move) => `${move.parameterCode}:${move.direction}`,
        ),
        sideEffects: [],
        rank: 2,
      },
    ]);
  });

  it("the rank restarts for every parameter and direction, and the same product may serve several moves", () => {
    const rows = toProjectedCandidateRows([
      entry("KALCIUM", "EMEL", [candidate("a")]),
      entry("MAGNEZIUM", "EMEL", [candidate("a"), candidate("b")]),
      entry("NITRAT", "CSOKKENT", [candidate("b")]),
    ]);
    assert.deepEqual(
      rows.map((row) => [
        row.parameterCode,
        row.direction,
        row.productId,
        row.rank,
      ]),
      [
        ["KALCIUM", "EMEL", "a", 1],
        ["MAGNEZIUM", "EMEL", "a", 1],
        ["MAGNEZIUM", "EMEL", "b", 2],
        ["NITRAT", "CSOKKENT", "b", 1],
      ],
    );
  });

  it("phosphate and every other unapproved parameter produce no row, even when the source handed it over", () => {
    for (const parameterCode of ["FOSZFAT", "PH", "AMMONIA", "SOTARTALOM", ""])
      assert.deepEqual(
        toProjectedCandidateRows([
          entry(parameterCode, "EMEL", [candidate("a")]),
        ]),
        [],
        parameterCode,
      );
  });

  it("a candidate without an https maker reference produces no row", () => {
    for (const evidenceRef of [
      "http://gyarto.example/x",
      "gyarto.example/x",
      "",
      "javascript:alert(1)",
      "https://a b",
    ])
      assert.deepEqual(
        toProjectedCandidateRows([
          entry("KH", "EMEL", [candidate("a", { evidenceRef })]),
        ]),
        [],
        evidenceRef,
      );
  });

  it("at most five per move, the first five in the order given; the rank never passes five", () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      candidate(`p${index}`),
    );
    const rows = toProjectedCandidateRows([entry("KH", "EMEL", many)]);
    assert.equal(rows.length, 5);
    assert.deepEqual(
      rows.map((row) => row.productId),
      ["p0", "p1", "p2", "p3", "p4"],
    );
    assert.deepEqual(
      rows.map((row) => row.rank),
      [1, 2, 3, 4, 5],
    );
  });

  it("a skipped row does not leave a hole in the rank, and a product is kept once per move", () => {
    const rows = toProjectedCandidateRows([
      entry("KH", "EMEL", [
        candidate("a", { evidenceRef: "http://x/y" }),
        candidate("b"),
        candidate("b"),
        candidate("c"),
      ]),
    ]);
    assert.deepEqual(
      rows.map((row) => [row.productId, row.rank]),
      [
        ["b", 1],
        ["c", 2],
      ],
    );
  });

  it("the shop address is kept only when it is http or https, else null", () => {
    const rows = toProjectedCandidateRows([
      entry("KH", "EMEL", [
        candidate("a", { shopUrl: "http://shop.example/a" }),
        candidate("b", { shopUrl: "javascript:alert(1)" }),
        candidate("c", { shopUrl: null }),
        candidate("d", { shopUrl: "ftp://x/y" }),
      ]),
    ]);
    assert.deepEqual(
      rows.map((row) => row.shopUrl),
      ["http://shop.example/a", null, null, null],
    );
  });

  it("a row never claims a move the product's own effects do not hold; the effects of the product travel with the row", () => {
    const calciumOnly = candidate("a", {
      effects: [{ parameterCode: "KALCIUM", direction: "EMEL" }],
    });
    const both = candidate("b", {
      effects: [
        { parameterCode: "KALCIUM", direction: "EMEL" },
        { parameterCode: "MAGNEZIUM", direction: "EMEL" },
      ],
    });
    const rows = toProjectedCandidateRows([
      entry("MAGNEZIUM", "EMEL", [calciumOnly, both]),
      entry("KALCIUM", "EMEL", [both]),
      entry("KALCIUM", "CSOKKENT", [both]),
    ]);
    assert.deepEqual(
      rows.map((row) => [
        row.parameterCode,
        row.direction,
        row.productId,
        row.effects,
      ]),
      [
        ["MAGNEZIUM", "EMEL", "b", ["KALCIUM:EMEL", "MAGNEZIUM:EMEL"]],
        ["KALCIUM", "EMEL", "b", ["KALCIUM:EMEL", "MAGNEZIUM:EMEL"]],
      ],
    );
  });

  it("the side effects (a phosphate or pH effect with no approved band) travel with the row in the same KOD:IRANY form, and are an empty list when there is none", () => {
    const rows = toProjectedCandidateRows([
      entry("NITRAT", "CSOKKENT", [
        candidate("a", {
          sideEffects: [
            { parameterCode: "FOSZFAT", direction: "CSOKKENT" },
            { parameterCode: "PH", direction: "EMEL" },
          ],
        }),
        candidate("b"),
      ]),
    ]);
    assert.deepEqual(
      rows.map((row) => [row.productId, row.sideEffects]),
      [
        ["a", ["FOSZFAT:CSOKKENT", "PH:EMEL"]],
        ["b", []],
      ],
    );
  });

  it("an empty input is an empty projection (no recommendation)", () => {
    assert.deepEqual(toProjectedCandidateRows([]), []);
    assert.deepEqual(toProjectedCandidateRows([entry("KH", "EMEL", [])]), []);
  });
});
