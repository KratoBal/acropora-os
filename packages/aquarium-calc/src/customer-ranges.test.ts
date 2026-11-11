import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CUSTOMER_RANGES,
  CUSTOMER_RANGES_VERSION,
  CUSTOMER_RANGE_PARAMETERS,
  PHOSPHATE_NAMED_APPROVAL,
  customerDeviation,
  customerDeviations,
  customerRangeFor,
  type CustomerRange,
} from "./customer-ranges.js";

/**
 * THE APPROVED BANDS THE CUSTOMER MAY SEE (card ce6c5cc9, V3.4 S1). WHAT TURNS IT RED: a band other than the approved four; the
 * phosphate band usable by flipping its state alone; a proposal, an approval with no named approver, fresh water, or a parameter
 * outside the register giving a band or a deviation; a band end counted as outside; an unusable value read as "in the band";
 * a deviation computed when there is no approved band.
 */
const SEA = "TENGERI";

describe("the register: what Balázs approved on 2026-11-11 (msg 1570041598300004414)", () => {
  it("holds exactly the four approved sea-water bands, with their numbers and units", () => {
    const approved = CUSTOMER_RANGES.filter(
      (range) => range.approval === "JOVAHAGYVA",
    ).map(({ parameter, min, max, unit }) => ({ parameter, min, max, unit }));
    assert.deepEqual(approved, [
      { parameter: "KH", min: 7, max: 9, unit: "dKH" },
      { parameter: "KALCIUM", min: 380, max: 450, unit: "mg/l" },
      { parameter: "MAGNEZIUM", min: 1250, max: 1350, unit: "mg/l" },
      { parameter: "NITRAT", min: 0, max: 10, unit: "mg/l" },
    ]);
  });

  it("every approved band names who approved it, when and where; the proposal names nobody", () => {
    for (const range of CUSTOMER_RANGES) {
      if (range.approval === "JOVAHAGYVA") {
        assert.match(range.approvedBy ?? "", /Balázs 2026-11-11 11:44:46 UTC/);
        assert.match(range.approvedBy ?? "", /1570041598300004414/);
      } else assert.equal(range.approvedBy, null, range.parameter);
    }
  });

  it("phosphate is a PROPOSAL, only the sea has entries, and each band has min below max", () => {
    const phosphate = CUSTOMER_RANGES.find(
      (range) => range.parameter === "FOSZFAT",
    )!;
    assert.equal(phosphate.approval, "JAVASLAT");
    assert.equal(PHOSPHATE_NAMED_APPROVAL, null);
    for (const range of CUSTOMER_RANGES) {
      assert.equal(range.waterType, SEA);
      assert.ok(range.min < range.max, range.parameter);
    }
    assert.deepEqual(
      CUSTOMER_RANGES.map((range) => range.parameter).sort(),
      [...CUSTOMER_RANGE_PARAMETERS].sort(),
    );
  });

  it("has a version that names the register", () => {
    assert.match(
      CUSTOMER_RANGES_VERSION,
      /^vevoi-savok-\d{4}-\d{2}-\d{2}-v\d+$/,
    );
  });
});

describe("customerRangeFor: only an approved, named, well-formed sea band", () => {
  it("returns the four approved bands for the sea", () => {
    for (const parameter of ["KH", "KALCIUM", "MAGNEZIUM", "NITRAT"])
      assert.ok(customerRangeFor(parameter, SEA), parameter);
  });

  it("returns nothing for fresh water, no water type, or another water type string", () => {
    for (const water of ["EDESVIZI", null, undefined, "", "tengeri", "Tengeri"])
      assert.equal(customerRangeFor("KH", water), null, String(water));
  });

  it("returns nothing for phosphate (a proposal), and nothing for a parameter outside the register", () => {
    assert.equal(customerRangeFor("FOSZFAT", SEA), null);
    for (const parameter of ["PH", "AMMONIA", "ORP", "SOTARTALOM", "", "kh"])
      assert.equal(customerRangeFor(parameter, SEA), null, parameter);
  });

  it("phosphate does NOT open by flipping its state alone: the named approval is a second lock", () => {
    const flipped: CustomerRange[] = CUSTOMER_RANGES.map((range) =>
      range.parameter === "FOSZFAT"
        ? { ...range, approval: "JOVAHAGYVA", approvedBy: "Balázs, valamikor" }
        : range,
    );
    assert.equal(customerRangeFor("FOSZFAT", SEA, { ranges: flipped }), null);
    assert.equal(
      customerRangeFor("FOSZFAT", SEA, {
        ranges: flipped,
        phosphateNamedApproval: "",
      }),
      null,
    );
    assert.equal(
      customerRangeFor("FOSZFAT", SEA, {
        ranges: flipped,
        phosphateNamedApproval: "   ",
      }),
      null,
    );
    // both locks open: the band comes out (a test of the mechanism, with made-up approval text)
    const opened = customerRangeFor("FOSZFAT", SEA, {
      ranges: flipped,
      phosphateNamedApproval:
        "Balázs 2026-12-01, a foszfát-sáv a vevő felé (teszt-szöveg)",
    });
    assert.equal(opened?.max, 0.1);
    // the named approval alone, with the entry still a proposal, opens nothing
    assert.equal(
      customerRangeFor("FOSZFAT", SEA, { phosphateNamedApproval: "x" }),
      null,
    );
  });

  it("a fresh-water entry added to the list is NOT used: the sea is the only water type with approved bands", () => {
    const freshWater = {
      parameter: "KH",
      waterType: "EDESVIZI",
      min: 3,
      max: 6,
      unit: "dKH",
      approval: "JOVAHAGYVA",
      approvedBy: "Balázs, valamikor",
    } as unknown as CustomerRange;
    assert.equal(
      customerRangeFor("KH", "EDESVIZI", { ranges: [freshWater] }),
      null,
    );
    assert.equal(
      customerDeviation("KH", 4, "EDESVIZI", { ranges: [freshWater] }).status,
      "NINCS_JOVAHAGYOTT_TARTOMANY",
    );
  });

  it("a band with no named approver, or with a bad shape, is not used, whatever its state says", () => {
    const base: CustomerRange = {
      parameter: "KH",
      waterType: SEA,
      min: 7,
      max: 9,
      unit: "dKH",
      approval: "JOVAHAGYVA",
      approvedBy: "Balázs",
    };
    assert.ok(customerRangeFor("KH", SEA, { ranges: [base] }));
    for (const broken of [
      { ...base, approvedBy: null },
      { ...base, approvedBy: "  " },
      { ...base, approval: "JAVASLAT" as const },
      { ...base, min: 9, max: 7 },
      { ...base, min: 8, max: 8 },
      { ...base, min: Number.NaN },
      { ...base, max: Number.POSITIVE_INFINITY },
    ])
      assert.equal(
        customerRangeFor("KH", SEA, { ranges: [broken] }),
        null,
        JSON.stringify(broken),
      );
  });
});

describe("customerDeviation: only from an approved band, ends inside, no value is no answer", () => {
  it("below, above and inside, with the band that was used", () => {
    assert.deepEqual(customerDeviation("KH", 6.5, SEA), {
      parameter: "KH",
      status: "ALATTA",
      value: 6.5,
      range: { min: 7, max: 9, unit: "dKH" },
    });
    assert.equal(customerDeviation("KALCIUM", 451, SEA).status, "FELETTE");
    assert.equal(
      customerDeviation("MAGNEZIUM", 1300, SEA).status,
      "TARTOMANYBAN",
    );
    assert.equal(customerDeviation("NITRAT", 12, SEA).status, "FELETTE");
  });

  it("the band's ends are inside it, and a hair outside is outside", () => {
    assert.equal(customerDeviation("KH", 7, SEA).status, "TARTOMANYBAN");
    assert.equal(customerDeviation("KH", 9, SEA).status, "TARTOMANYBAN");
    assert.equal(customerDeviation("KH", 6.99, SEA).status, "ALATTA");
    assert.equal(customerDeviation("KH", 9.01, SEA).status, "FELETTE");
    assert.equal(customerDeviation("NITRAT", 0, SEA).status, "TARTOMANYBAN");
    assert.equal(customerDeviation("NITRAT", -0.1, SEA).status, "ALATTA");
  });

  it("without an approved band the status is 'no approved band', with no direction and no band, even for a value far out", () => {
    for (const [parameter, water] of [
      ["FOSZFAT", SEA],
      ["FOSZFAT", "EDESVIZI"],
      ["KH", "EDESVIZI"],
      ["KH", null],
      ["PH", SEA],
    ] as const) {
      assert.deepEqual(customerDeviation(parameter, 1000, water), {
        parameter,
        status: "NINCS_JOVAHAGYOTT_TARTOMANY",
        value: null,
        range: null,
      });
    }
  });

  it("a value that is not a finite number is 'no value', never 'in the band'", () => {
    for (const value of [
      null,
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "8" as unknown as number,
    ])
      assert.equal(
        customerDeviation("KH", value, SEA).status,
        "NINCS_ERTEK",
        String(value),
      );
  });

  it("customerDeviations keeps the input order and mixes approved and unapproved parameters", () => {
    const result = customerDeviations(
      [
        { parameter: "FOSZFAT", value: 0.3 },
        { parameter: "KH", value: 8 },
        { parameter: "NITRAT", value: 20 },
        { parameter: "PH", value: 8.2 },
      ],
      SEA,
    );
    assert.deepEqual(
      result.map((entry) => [entry.parameter, entry.status]),
      [
        ["FOSZFAT", "NINCS_JOVAHAGYOTT_TARTOMANY"],
        ["KH", "TARTOMANYBAN"],
        ["NITRAT", "FELETTE"],
        ["PH", "NINCS_JOVAHAGYOTT_TARTOMANY"],
      ],
    );
    assert.deepEqual(customerDeviations([], SEA), []);
  });
});
