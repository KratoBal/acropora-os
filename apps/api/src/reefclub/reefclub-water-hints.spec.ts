import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CUSTOMER_HINT_DISCLAIMER,
  WATER_HINT_PARAMETERS,
  buildWaterHints,
  sideEffectsText,
  type WaterHintCandidate,
  type WaterHintMeasurement,
  type WaterHintsInput,
} from "./reefclub-water-hints.js";

/**
 * A "MI LÓG KI" SZABÁLYAI (card ce6c5cc9, V3.4 S3). MI PIROSÍT: nem tengeri vízre tanács vagy sáv megy ki; a foszfát sora (vagy bármely
 * nem jóváhagyott paraméteré) megjelenik; a sáv széle kívül esik; a régi érték megítélődik, vagy a régi vetítés termékeket nevez;
 * az "üres lista" ajánlásnak látszik; egy másik eltérést rossz irányba vivő termék bekerül; a mellékhatás kimarad; a hívó a
 * nyilvántartás zárját opcióval nyitja.
 */
const NOW = new Date("2026-11-11T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const m = (
  parameterCode: string,
  value: number,
  days = 0,
): WaterHintMeasurement => ({
  parameterCode,
  value,
  measuredAt: ago(days),
});
const candidate = (
  parameterCode: string,
  direction: "EMEL" | "CSOKKENT",
  productId: string,
  over: Partial<WaterHintCandidate> = {},
): WaterHintCandidate => ({
  parameterCode,
  direction,
  productId,
  productName: `Termék ${productId}`,
  category: "Adalékok",
  shopUrl: `https://shop.example/${productId}`,
  evidenceRef: `https://gyarto.example/${productId}`,
  referenceKind: "MAKER" as const,
  effects: [`${parameterCode}:${direction}`],
  sideEffects: [],
  rank: 1,
  ...over,
});
const input = (over: Partial<WaterHintsInput> = {}): WaterHintsInput => ({
  now: NOW,
  waterType: "TENGERI",
  measurements: [],
  candidates: [],
  candidatesFresh: true,
  ...over,
});

describe("what is not available", () => {
  it("fresh water or no water type: NOT_AVAILABLE with the reason, no rows, no disclaimer, no advice, even with measurements and products", () => {
    for (const waterType of ["EDESVIZI", null] as const) {
      const hints = buildWaterHints(
        input({
          waterType,
          measurements: [m("KH", 5), m("NITRAT", 30)],
          candidates: [candidate("KH", "EMEL", "a")],
        }),
      );
      assert.equal(hints.state, "NOT_AVAILABLE", String(waterType));
      assert.equal(hints.reason, "WATER_TYPE");
      assert.deepEqual(hints.rows, []);
      assert.equal(hints.disclaimer, null);
      assert.equal(hints.productsState, "NONE");
    }
  });

  it("the sea without a measurement of the four parameters: NO_MEASUREMENT; a phosphate or pH value alone makes no row", () => {
    assert.equal(buildWaterHints(input()).state, "NO_MEASUREMENT");
    const only = buildWaterHints(
      input({
        measurements: [m("FOSZFAT", 0.9), m("PH", 7.5), m("SOTARTALOM", 35)],
      }),
    );
    assert.equal(only.state, "NO_MEASUREMENT");
    assert.deepEqual(only.rows, []);
  });

  it("phosphate never has a row, whatever its value, when the four parameters are measured too", () => {
    const hints = buildWaterHints(
      input({ measurements: [m("KH", 8), m("FOSZFAT", 5)] }),
    );
    assert.deepEqual(
      hints.rows.map((row) => row.parameterCode),
      ["KH"],
    );
  });
});

describe("the rows: the approved bands, in a fixed order", () => {
  it("one row per measured parameter in the order KH, calcium, magnesium, nitrate, with label, unit, value, time and the band", () => {
    assert.deepEqual(
      [...WATER_HINT_PARAMETERS],
      ["KH", "KALCIUM", "MAGNEZIUM", "NITRAT"],
    );
    const hints = buildWaterHints(
      input({
        measurements: [
          m("NITRAT", 4),
          m("KH", 6.5),
          m("MAGNEZIUM", 1300),
          m("KALCIUM", 400),
        ],
      }),
    );
    assert.equal(hints.state, "OK");
    assert.equal(hints.disclaimer, CUSTOMER_HINT_DISCLAIMER);
    assert.deepEqual(
      hints.rows.map((row) => [row.parameterCode, row.status]),
      [
        ["KH", "ALATTA"],
        ["KALCIUM", "TARTOMANYBAN"],
        ["MAGNEZIUM", "TARTOMANYBAN"],
        ["NITRAT", "TARTOMANYBAN"],
      ],
    );
    const kh = hints.rows[0]!;
    assert.equal(kh.label, "KH");
    assert.equal(kh.unit, "dKH");
    assert.equal(kh.value, 6.5);
    assert.deepEqual(kh.range, { min: 7, max: 9 });
    assert.equal(kh.measuredAt, ago(0).toISOString());
    assert.equal(
      kh.text,
      "A(z) KH mért értéke 6,5 dKH, az ajánlott tartomány (7 és 9 dKH) alatt van.",
    );
  });

  it("the kind of the reference goes to the product as it is, so the page can tell a shop text from a maker's page", () => {
    const hints = buildWaterHints(
      input({
        measurements: [m("KH", 6.5)],
        candidates: [
          candidate("KH", "EMEL", "maker", { rank: 1 }),
          candidate("KH", "EMEL", "shop", {
            rank: 2,
            referenceKind: "SHOP_TEXT",
          }),
        ],
      }),
    );
    assert.deepEqual(
      hints.rows[0]!.products.map((product) => [
        product.productId,
        product.referenceKind,
      ]),
      [
        ["maker", "MAKER"],
        ["shop", "SHOP_TEXT"],
      ],
    );
  });

  it("the band's ends are inside, a hair outside is outside, and the sentence says which side", () => {
    const status = (parameter: string, value: number) =>
      buildWaterHints(input({ measurements: [m(parameter, value)] })).rows[0]!;
    assert.equal(status("KH", 7).status, "TARTOMANYBAN");
    assert.equal(status("KH", 9).status, "TARTOMANYBAN");
    assert.equal(status("KH", 9.01).status, "FELETTE");
    assert.match(status("KH", 9.01).text, /felett van\.$/);
    assert.equal(status("NITRAT", 0).status, "TARTOMANYBAN");
    assert.equal(status("KALCIUM", 379.9).status, "ALATTA");
    assert.match(status("MAGNEZIUM", 1250).text, /belül van\.$/);
  });

  it("the latest value per parameter is used, whatever the order; a value that is not a number is ignored", () => {
    const hints = buildWaterHints(
      input({
        measurements: [
          m("KH", 6, 2),
          m("KH", 8, 0),
          m("KH", 5, 1),
          m("NITRAT", Number.NaN),
        ],
      }),
    );
    assert.deepEqual(
      hints.rows.map((row) => [row.parameterCode, row.value]),
      [["KH", 8]],
    );
  });
});

describe("a value that is too old is not judged", () => {
  it("KH and calcium: 3 days, magnesium and nitrate: 7 days; exactly at the limit is still fresh; older is TUL_REGI with no band and no products", () => {
    const fresh = buildWaterHints(
      input({
        measurements: [
          m("KH", 6, 3),
          m("KALCIUM", 300, 3),
          m("MAGNEZIUM", 1000, 7),
          m("NITRAT", 30, 7),
        ],
      }),
    );
    assert.deepEqual(
      fresh.rows.map((row) => row.status),
      ["ALATTA", "ALATTA", "ALATTA", "FELETTE"],
    );
    const old = buildWaterHints(
      input({
        measurements: [
          m("KH", 6, 3.5),
          m("KALCIUM", 300, 4),
          m("MAGNEZIUM", 1000, 7.5),
          m("NITRAT", 30, 8),
        ],
        candidates: [
          candidate("KH", "EMEL", "a"),
          candidate("NITRAT", "CSOKKENT", "b"),
        ],
      }),
    );
    assert.deepEqual(
      old.rows.map((row) => row.status),
      ["TUL_REGI", "TUL_REGI", "TUL_REGI", "TUL_REGI"],
    );
    for (const row of old.rows) {
      assert.equal(row.range, null);
      assert.deepEqual(row.products, []);
      assert.match(row.text, /mérj újra\.$/);
    }
    assert.equal(old.productsState, "NONE");
  });

  it("a stale value does not count as a deviation for the product filter of another row (unknown is not a reason to drop a product)", () => {
    const hints = buildWaterHints(
      input({
        measurements: [m("KALCIUM", 300), m("MAGNEZIUM", 1400, 9)],
        candidates: [
          candidate("KALCIUM", "EMEL", "both", {
            effects: ["KALCIUM:EMEL", "MAGNEZIUM:EMEL"],
          }),
        ],
      }),
    );
    assert.deepEqual(
      hints.rows[0]!.products.map((product) => product.productId),
      ["both"],
    );
  });
});

describe("the products of a deviation", () => {
  const sea = (
    measurements: WaterHintMeasurement[],
    candidates: WaterHintCandidate[],
    over: Partial<WaterHintsInput> = {},
  ) => buildWaterHints(input({ measurements, candidates, ...over }));

  it("only for a deviation, in the right direction, best rank first, at most five, with the shop page and the maker's reference", () => {
    const many = Array.from({ length: 7 }, (_, index) =>
      candidate("KALCIUM", "EMEL", `p${index}`, { rank: index + 1 }),
    );
    const hints = sea(
      [m("KALCIUM", 300), m("KH", 8)],
      [
        ...many.reverse(),
        candidate("KALCIUM", "CSOKKENT", "wrong-way"),
        candidate("KH", "EMEL", "kh-in-range"),
      ],
    );
    const calcium = hints.rows.find((row) => row.parameterCode === "KALCIUM")!;
    assert.deepEqual(
      calcium.products.map((product) => product.productId),
      ["p0", "p1", "p2", "p3", "p4"],
    );
    assert.equal(calcium.products[0]!.shopUrl, "https://shop.example/p0");
    assert.equal(
      calcium.products[0]!.referenceUrl,
      "https://gyarto.example/p0",
    );
    assert.deepEqual(
      hints.rows.find((row) => row.parameterCode === "KH")!.products,
      [],
    );
    assert.equal(hints.productsState, "OK");
  });

  it("a deviation with no product is NONE: the empty list is not a recommendation, and the row still says what the value is", () => {
    const hints = sea([m("KH", 6)], []);
    assert.equal(hints.productsState, "NONE");
    assert.deepEqual(hints.rows[0]!.products, []);
    assert.equal(hints.rows[0]!.status, "ALATTA");
  });

  it("a projection that is too old names no product, and says STALE only when a deviation wanted one", () => {
    const stale = sea([m("KH", 6)], [candidate("KH", "EMEL", "a")], {
      candidatesFresh: false,
    });
    assert.equal(stale.productsState, "STALE");
    assert.deepEqual(stale.rows[0]!.products, []);
    const nothingWanted = sea([m("KH", 8)], [candidate("KH", "EMEL", "a")], {
      candidatesFresh: false,
    });
    assert.equal(nothingWanted.productsState, "NONE");
  });

  it("a product that moves ANOTHER fresh deviation the wrong way is named for neither row (low calcium, high magnesium, a product raising both)", () => {
    const hints = sea(
      [m("KALCIUM", 300), m("MAGNEZIUM", 1400)],
      [
        candidate("KALCIUM", "EMEL", "both", {
          effects: ["KALCIUM:EMEL", "MAGNEZIUM:EMEL"],
        }),
        candidate("KALCIUM", "EMEL", "calcium-only", { rank: 2 }),
        candidate("MAGNEZIUM", "CSOKKENT", "mg-down", { rank: 1 }),
      ],
    );
    assert.deepEqual(
      hints.rows
        .find((row) => row.parameterCode === "KALCIUM")!
        .products.map((product) => product.productId),
      ["calcium-only"],
    );
    assert.deepEqual(
      hints.rows
        .find((row) => row.parameterCode === "MAGNEZIUM")!
        .products.map((product) => product.productId),
      ["mg-down"],
    );
  });

  it("a product that also moves a parameter that is IN RANGE (or one the customer did not measure) is not dropped", () => {
    const hints = sea(
      [m("KALCIUM", 300), m("MAGNEZIUM", 1300)],
      [
        candidate("KALCIUM", "EMEL", "both", {
          effects: ["KALCIUM:EMEL", "MAGNEZIUM:EMEL", "NITRAT:EMEL"],
        }),
      ],
    );
    assert.deepEqual(
      hints.rows[0]!.products.map((product) => product.productId),
      ["both"],
    );
  });

  it("the product's effect on a parameter with no approved band is printed as a side effect, with its direction and no advice; none is null", () => {
    const hints = sea(
      [m("NITRAT", 30)],
      [
        candidate("NITRAT", "CSOKKENT", "a", {
          sideEffects: ["FOSZFAT:CSOKKENT", "PH:EMEL"],
        }),
        candidate("NITRAT", "CSOKKENT", "b", { rank: 2 }),
      ],
    );
    const [a, b] = hints.rows[0]!.products;
    assert.equal(
      a!.sideEffectsText,
      "Emellett hat: foszfát (csökkenti), pH (emeli).",
    );
    assert.equal(b!.sideEffectsText, null);
    assert.equal(sideEffectsText([]), null);
    assert.equal(sideEffectsText(["broken", "FOSZFAT:SIDEWAYS"]), null);
  });
});

describe("the register is called as it is, with no options (barracuda on #2414)", () => {
  it("no source of the hints passes `ranges` or `phosphateNamedApproval` to the register: the phosphate lock and the sea-only rule stay the register's own", () => {
    for (const file of [
      "reefclub-water-hints.ts",
      "reefclub-water-hints.service.ts",
      "reefclub-water-hints.controller.ts",
    ]) {
      const text = readFileSync(
        new URL(`../../src/reefclub/${file}`, import.meta.url),
        "utf8",
      );
      const code = text
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n");
      assert.ok(
        !/phosphateNamedApproval/.test(code),
        `${file} passes phosphateNamedApproval`,
      );
      assert.ok(
        !/customerRangeFor\(/.test(code),
        `${file} calls customerRangeFor directly`,
      );
      assert.ok(
        !/customerDeviation\([^)]*\{/.test(code.replace(/\n/g, " ")),
        `${file} passes options to customerDeviation`,
      );
    }
  });
});
