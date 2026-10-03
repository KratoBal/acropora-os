import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseDose, parseQuantity, type Dimension } from "./units.js";

function canonical(raw: string, dimension: Dimension): string {
  const r = parseQuantity(raw, dimension);
  assert.ok(r.ok, `${raw}: ${r.ok ? "" : r.reason}`);
  return r.canonical;
}

function rejected(raw: string, dimension: Dimension): string {
  const r = parseQuantity(raw, dimension);
  assert.equal(
    r.ok,
    false,
    `${raw} should be rejected, got ${r.ok ? r.canonical : ""}`,
  );
  return r.ok ? "" : r.reason;
}

describe("unit normalization (Tier C)", () => {
  it("flow: l/h, L/h, lph, l/óra and m³/h all land on l/h", () => {
    assert.equal(canonical("3000 l/h", "flow"), "3000 l/h");
    assert.equal(canonical("3000L/h", "flow"), "3000 l/h");
    assert.equal(canonical("3000 lph", "flow"), "3000 l/h");
    assert.equal(canonical("3000 l/óra", "flow"), "3000 l/h");
    assert.equal(canonical("3 m³/h", "flow"), "3000 l/h");
    assert.equal(canonical("2,5 m3/h", "flow"), "2500 l/h");
  });

  it("power and voltage: W, kW, V, with AC/DC kept", () => {
    assert.equal(canonical("24 W", "power"), "24 W");
    assert.equal(canonical("1.5 kW", "power"), "1500 W");
    assert.equal(canonical("230 V", "voltage"), "230 V");
    assert.equal(canonical("12 V DC", "voltage"), "12 V DC");
    assert.notEqual(
      canonical("12 V", "voltage"),
      canonical("12 V DC", "voltage"),
    );
  });

  it("volume, length and mass: ml/l, mm/cm/m, g/kg, exact decimals", () => {
    assert.equal(canonical("500 ml", "volume"), "500 ml");
    assert.equal(canonical("1.1 l", "volume"), "1100 ml");
    assert.equal(canonical("0,5 L", "volume"), "500 ml");
    assert.equal(canonical("25 cm", "length"), "250 mm");
    assert.equal(canonical("2.5 cm", "length"), "25 mm");
    assert.equal(canonical("0.5 mm", "length"), "0.5 mm");
    assert.equal(canonical("1.2 m", "length"), "1200 mm");
    assert.equal(canonical("1,25 kg", "mass"), "1250 g");
    assert.equal(canonical("0.250 kg", "mass"), "250 g");
    assert.equal(canonical("3 000 l/h", "flow"), "3000 l/h");
  });

  it("rejects a value without a unit", () => {
    assert.match(rejected("3000", "flow"), /no unit/);
    assert.match(rejected("1,5", "volume"), /no unit/);
  });

  it("rejects ranges and multiples", () => {
    const cases: [string, Dimension][] = [
      ["2000-3000 l/h", "flow"],
      ["2000 – 3000 l/h", "flow"],
      ["2 x 24 W", "power"],
      ["2×24 W", "power"],
      ["100-240 V", "voltage"],
      ["5 ml/100 l", "volume"],
    ];
    for (const [raw, dimension] of cases)
      assert.match(rejected(raw, dimension), /range or multiple/);
  });

  it("rejects qualified values (max / min / approx)", () => {
    for (const raw of [
      "max. 3000 l/h",
      "~3000 l/h",
      "ca. 3000 l/h",
      "kb. 3000 l/h",
      "up to 3000 l/h",
      "<3000 l/h",
      "akár 3000 l/h",
    ])
      assert.match(rejected(raw, "flow"), /qualified/);
  });

  it("rejects a separator followed by three digits as locale-ambiguous", () => {
    assert.match(rejected("1.500 l/h", "flow"), /ambiguous/);
    assert.match(rejected("1,500 l/h", "flow"), /ambiguous/);
    assert.match(rejected("2.000 W", "power"), /ambiguous/);
  });

  it("rejects unknown units and units of another dimension", () => {
    assert.match(rejected("3000 gph", "flow"), /unknown unit/);
    assert.match(rejected("24 w", "power"), /unknown unit/);
    assert.match(
      rejected("3000 l", "flow"),
      /is volume, the field expects flow/,
    );
    assert.match(rejected("24 W", "voltage"), /is power/);
    assert.match(rejected("24 W DC", "power"), /only applies to a voltage/);
  });

  it("rejects zero, negatives, empty and trailing text", () => {
    rejected("0 W", "power");
    rejected("0.0 l", "volume");
    rejected("-5 V", "voltage");
    rejected("", "power");
    rejected("24 W (nominal)", "power");
    rejected("24 W 30 W", "power");
  });
});

function dose(raw: string): string {
  const r = parseDose(raw);
  assert.ok(r.ok, `${raw}: ${r.ok ? "" : r.reason}`);
  return r.canonical;
}

function doseRejected(raw: string): string {
  const r = parseDose(raw);
  assert.equal(
    r.ok,
    false,
    `${raw} should be rejected, got ${r.ok ? r.canonical : ""}`,
  );
  return r.ok ? "" : r.reason;
}

describe("dose normalization", () => {
  it("drops per litres per period, in one canonical spelling", () => {
    assert.equal(dose("1 drop/100 L/day"), "1 drop/100 L/day");
    assert.equal(dose("1 drops / 100 l / d"), "1 drop/100 L/day");
    assert.equal(dose("2 drop/100000 ml/week"), "2 drop/100 L/week");
    assert.equal(dose("1 drop/50 L/day"), "1 drop/50 L/day");
  });

  it("a volume amount lands in ml, a water volume in L", () => {
    assert.equal(dose("5 ml/100 L/week"), "5 ml/100 L/week");
    assert.equal(dose("0,5 l/1000 L/day"), "500 ml/1000 L/day");
    assert.equal(dose("1 ml/500 ml/day"), "1 ml/0.5 L/day");
  });

  it("a frequency or a frequency range per period; a frequency of 1 is the plain form", () => {
    assert.equal(dose("1 drop/100 L, 1-2/week"), "1 drop/100 L, 1-2/week");
    assert.equal(dose("1 drop/100 L, 3/week"), "1 drop/100 L, 3/week");
    assert.equal(dose("1 drop/100 L, 1/day"), "1 drop/100 L/day");
    assert.equal(dose("1 drop/100 L, 1-1/day"), "1 drop/100 L/day");
    assert.notEqual(dose("1 drop/100 L/week"), dose("1 drop/100 L, 1-2/week"));
  });

  it("rejects what a human would have to interpret", () => {
    assert.match(doseRejected("1-2 drop/100 L/day"), /not a dose/);
    assert.match(doseRejected("max. 1 drop/100 L/day"), /qualified/);
    assert.match(doseRejected("1 drop/100 L"), /not a dose/);
    assert.match(doseRejected("1 drop/100 L/month"), /unknown period/);
    assert.match(doseRejected("1 cup/100 L/day"), /unknown dose unit/);
    assert.match(doseRejected("1 drop/100 W/day"), /volume unit/);
    assert.match(doseRejected("1,5 drop/100 L/day"), /whole number/);
    assert.match(doseRejected("1 drop/1.000 L/day"), /ambiguous/);
    assert.match(doseRejected("0 drop/100 L/day"), /zero/);
    assert.match(doseRejected("1 drop/100 L, 2-1/week"), /reversed/);
    assert.match(doseRejected("1 drop/100 L, 0/week"), /starts at 1/);
    assert.match(doseRejected("1 Tropfen je 100 Liter /Tag"), /not a dose/);
    assert.match(doseRejected(""), /empty/);
  });
});
