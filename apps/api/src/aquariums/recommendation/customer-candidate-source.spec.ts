import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CUSTOMER_CANDIDATE_PARAMETERS,
  CUSTOMER_CANDIDATES_PER_PARAMETER,
  CustomerCandidateSource,
  customerMatchingRows,
  customerWantedMoves,
  limitCustomerCandidates,
  type CustomerRecommendationCandidate,
} from "./customer-candidate-source.js";
import type { JevEffectRow } from "./jev-candidate-source.js";

/**
 * A VEVŐI JELÖLT-FORRÁS (kártya ce6c5cc9, V3.4 S2). MI PIROSÍT: egy UNVERIFIED (saját adatú) hatás a vevő elé kerül, megjelöléssel
 * is; hivatkozás nélküli vagy nem https hatás jelölt; a foszfát (vagy bármely nem jóváhagyott paraméter) bekerül; inaktív vagy nem
 * vásárolható termék jelölt; egy paraméterhez 5-nél több termék megy; a rossz irányba vivő termék jelölt; kívánt mozgás nélkül
 * lekérdez; a belső forrás olyat is átenged, amit ez nem.
 */
const URL = "https://gyarto.example/termek";
const SELLS = [{ channel: "UNAS", externalStatus: "1" }];
const row = (over: Partial<JevEffectRow>): JevEffectRow => ({
  productId: "p",
  status: "VERIFIED",
  value: "KALCIUM:EMEL",
  currentValue: null,
  sourceRef: URL,
  ...over,
});
const low = (parameterCode: string) => ({
  parameterCode,
  direction: "EMEL" as const,
});
const high = (parameterCode: string) => ({
  parameterCode,
  direction: "CSOKKENT" as const,
});

describe("the moves the customer path may act on", () => {
  it("only the four parameters approved for a customer; phosphate and the rest are dropped", () => {
    assert.deepEqual(
      [...CUSTOMER_CANDIDATE_PARAMETERS],
      ["KH", "KALCIUM", "MAGNEZIUM", "NITRAT"],
    );
    const wanted = customerWantedMoves([
      low("KH"),
      high("NITRAT"),
      low("FOSZFAT"),
      high("FOSZFAT"),
      low("PH"),
      low("SOTARTALOM"),
    ]);
    assert.deepEqual(
      [...wanted],
      [
        ["KH", "EMEL"],
        ["NITRAT", "CSOKKENT"],
      ],
    );
    assert.equal(customerWantedMoves([]).size, 0);
    assert.equal(customerWantedMoves([low("FOSZFAT")]).size, 0);
  });
});

describe("the rows that may reach a customer", () => {
  const wanted = customerWantedMoves([low("KALCIUM")]);

  it("a VERIFIED value moving the wanted parameter the right way, with an https reference", () => {
    assert.deepEqual(customerMatchingRows([row({})], wanted), [
      {
        productId: "p",
        effects: [{ parameterCode: "KALCIUM", direction: "EMEL" }],
        sideEffects: [],
        evidenceRef: URL,
      },
    ]);
  });

  it("an UNVERIFIED effect (our own data) NEVER reaches a customer, with or without a value of its own, marked or not", () => {
    for (const unverified of [
      row({ status: "UNVERIFIED", value: null, currentValue: "KALCIUM:EMEL" }),
      row({
        status: "UNVERIFIED",
        value: "KALCIUM:EMEL",
        currentValue: "KALCIUM:EMEL",
      }),
      row({
        status: "UNVERIFIED",
        value: null,
        currentValue: "KALCIUM:EMEL",
        sourceRef: URL,
      }),
    ])
      assert.deepEqual(customerMatchingRows([unverified], wanted), []);
  });

  it("every other status is no candidate, and a VERIFIED row without a value is none", () => {
    for (const status of [
      "CONFLICT",
      "SUGGESTED",
      "LIKELY_WRONG",
      "UNKNOWN",
      "",
    ])
      assert.deepEqual(
        customerMatchingRows([row({ status })], wanted),
        [],
        status,
      );
    assert.deepEqual(customerMatchingRows([row({ value: null })], wanted), []);
    assert.deepEqual(customerMatchingRows([row({ value: "" })], wanted), []);
  });

  it("without the maker's reference, or with one that is not https, there is no candidate: the customer would get no source to rely on", () => {
    for (const sourceRef of [
      null,
      "",
      "   ",
      "http://gyarto.example/termek",
      "gyarto.example/termek",
      "ftp://x/y",
      "javascript:alert(1)",
      "https://a b",
    ])
      assert.deepEqual(
        customerMatchingRows([row({ sourceRef })], wanted),
        [],
        String(sourceRef),
      );
  });

  it("the wrong direction, an unwanted parameter and a product that moves another deviation the wrong way are no candidates", () => {
    assert.deepEqual(
      customerMatchingRows([row({ value: "KALCIUM:CSOKKENT" })], wanted),
      [],
    );
    assert.deepEqual(
      customerMatchingRows([row({ value: "MAGNEZIUM:EMEL" })], wanted),
      [],
    );
    const both = customerWantedMoves([low("KALCIUM"), high("MAGNEZIUM")]);
    assert.deepEqual(
      customerMatchingRows(
        [row({ value: "KALCIUM:EMEL;MAGNEZIUM:EMEL" })],
        both,
      ),
      [],
    );
  });

  it("an unreadable value drops only its own row", () => {
    const rows = [
      row({ productId: "bad", value: "nonsense" }),
      row({ productId: "good" }),
    ];
    assert.deepEqual(
      customerMatchingRows(rows, wanted).map((match) => match.productId),
      ["good"],
    );
  });

  it("an effect on a parameter with no approved band (phosphate, pH) is NOT dropped: it goes on as a SIDE EFFECT with its direction, and the effects keep only the approved parameters (barracuda on #2415)", () => {
    const match = customerMatchingRows(
      [row({ value: "KALCIUM:EMEL;FOSZFAT:CSOKKENT;PH:EMEL" })],
      wanted,
    );
    assert.deepEqual(match[0]?.effects, [
      { parameterCode: "KALCIUM", direction: "EMEL" },
    ]);
    assert.deepEqual(match[0]?.sideEffects, [
      { parameterCode: "FOSZFAT", direction: "CSOKKENT" },
      { parameterCode: "PH", direction: "EMEL" },
    ]);
  });

  it("a product with no effect on an unapproved parameter has no side effects (an empty list, not a missing field)", () => {
    const match = customerMatchingRows([row({})], wanted);
    assert.deepEqual(match[0]?.sideEffects, []);
  });
});

describe("the cap per parameter", () => {
  const candidate = (
    productId: string,
    name: string,
    effects: CustomerRecommendationCandidate["effects"],
  ): CustomerRecommendationCandidate => ({
    productId,
    name,
    category: "K",
    effects,
    sideEffects: [],
    evidenceRef: URL,
  });

  it("at most five per parameter; the ones helping more wanted deviations first, then by name", () => {
    assert.equal(CUSTOMER_CANDIDATES_PER_PARAMETER, 5);
    const wanted = customerWantedMoves([low("KALCIUM"), low("MAGNEZIUM")]);
    const calcium = Array.from({ length: 8 }, (_, index) =>
      candidate(`c${index}`, `Kalcium ${String.fromCharCode(65 + index)}`, [
        { parameterCode: "KALCIUM", direction: "EMEL" },
      ]),
    );
    const both = candidate("both", "Zzz kettős", [
      { parameterCode: "KALCIUM", direction: "EMEL" },
      { parameterCode: "MAGNEZIUM", direction: "EMEL" },
    ]);
    const kept = limitCustomerCandidates([...calcium, both], wanted);
    const calciumKept = kept.filter((entry) =>
      entry.effects.some((effect) => effect.parameterCode === "KALCIUM"),
    );
    assert.equal(calciumKept.length, 5);
    // the one helping two deviations survives the cap although its name sorts last
    assert.ok(kept.some((entry) => entry.productId === "both"));
    // the others are the first four by name
    assert.deepEqual(calciumKept.map((entry) => entry.productId).sort(), [
      "both",
      "c0",
      "c1",
      "c2",
      "c3",
    ]);
  });

  it("a product is listed once however many parameters it serves, and the cap is per parameter, not overall", () => {
    const wanted = customerWantedMoves([low("KALCIUM"), low("MAGNEZIUM")]);
    const mg = Array.from({ length: 6 }, (_, index) =>
      candidate(`m${index}`, `Magnézium ${index}`, [
        { parameterCode: "MAGNEZIUM", direction: "EMEL" },
      ]),
    );
    const ca = Array.from({ length: 6 }, (_, index) =>
      candidate(`c${index}`, `Kalcium ${index}`, [
        { parameterCode: "KALCIUM", direction: "EMEL" },
      ]),
    );
    const kept = limitCustomerCandidates([...mg, ...ca], wanted);
    assert.equal(kept.length, 10);
    assert.equal(new Set(kept.map((entry) => entry.productId)).size, 10);
    assert.deepEqual(limitCustomerCandidates([], wanted), []);
    assert.deepEqual(limitCustomerCandidates(ca, wanted, 0), []);
  });
});

describe("the source", () => {
  const source = (
    rows: JevEffectRow[],
    products: unknown[],
    counters = { queries: 0, products: 0 },
  ) => {
    const instance = new CustomerCandidateSource();
    (instance as unknown as { database: unknown }).database = {
      $queryRaw: async () => {
        counters.queries++;
        return rows;
      },
      product: {
        findMany: async () => {
          counters.products++;
          return products;
        },
      },
    };
    return instance;
  };
  const product = (
    id: string,
    name: string,
    over: Record<string, unknown> = {},
  ) => ({
    id,
    name,
    categories: [{ category: { name: "Adalékok" } }],
    channelListings: SELLS,
    unasSnapshot: null,
    ...over,
  });

  it("no wanted move, or only an unapproved parameter, makes no query at all", async () => {
    const counters = { queries: 0, products: 0 };
    const instance = source([row({})], [product("p", "Kalcium")], counters);
    assert.deepEqual(await instance.candidates({ moves: [] }), []);
    assert.deepEqual(
      await instance.candidates({ moves: [low("FOSZFAT")] }),
      [],
    );
    assert.equal(counters.queries, 0);
  });

  it("returns the active, purchasable product with its category and the maker's reference, and nothing about 'unverified' or a basis", async () => {
    const instance = source([row({})], [product("p", "Kalcium adalék")]);
    assert.deepEqual(await instance.candidates({ moves: [low("KALCIUM")] }), [
      {
        productId: "p",
        name: "Kalcium adalék",
        category: "Adalékok",
        effects: [{ parameterCode: "KALCIUM", direction: "EMEL" }],
        sideEffects: [],
        evidenceRef: URL,
      },
    ]);
  });

  it("an UNVERIFIED match does not reach the customer, so the product query is not even made", async () => {
    const counters = { queries: 0, products: 0 };
    const instance = source(
      [
        row({
          status: "UNVERIFIED",
          value: null,
          currentValue: "KALCIUM:EMEL",
        }),
      ],
      [product("p", "Saját adatú")],
      counters,
    );
    assert.deepEqual(
      await instance.candidates({ moves: [low("KALCIUM")] }),
      [],
    );
    assert.equal(counters.queries, 1);
    assert.equal(counters.products, 0);
  });

  it("an inactive product (the query asks for active ones) and the ones one cannot buy drop out", async () => {
    let where: unknown;
    const instance = new CustomerCandidateSource();
    (instance as unknown as { database: unknown }).database = {
      $queryRaw: async () => [
        row({ productId: "ok" }),
        row({ productId: "status3" }),
        row({ productId: "inquire" }),
        row({ productId: "nolisting" }),
      ],
      product: {
        findMany: async (args: { where: unknown }) => {
          where = args.where;
          return [
            product("ok", "Megvehető"),
            product("status3", "Nem vásárolható", {
              channelListings: [{ channel: "UNAS", externalStatus: "3" }],
            }),
            product("inquire", "Csak érdeklődés", {
              unasSnapshot: { rawPayload: { Inquire: "1" } },
            }),
            product("nolisting", "Nincs UNAS sor", { channelListings: [] }),
          ];
        },
      },
    };
    const result = await instance.candidates({ moves: [low("KALCIUM")] });
    assert.deepEqual(
      result.map((entry) => entry.productId),
      ["ok"],
    );
    assert.deepEqual(where, {
      id: { in: ["ok", "status3", "inquire", "nolisting"] },
      isActive: true,
    });
  });

  it("applies the per-parameter cap", async () => {
    const rows = Array.from({ length: 9 }, (_, index) =>
      row({ productId: `p${index}` }),
    );
    const products = rows.map((entry, index) =>
      product(entry.productId, `Termék ${index}`),
    );
    const result = await source(rows, products).candidates({
      moves: [low("KALCIUM")],
    });
    assert.equal(result.length, CUSTOMER_CANDIDATES_PER_PARAMETER);
  });
});
