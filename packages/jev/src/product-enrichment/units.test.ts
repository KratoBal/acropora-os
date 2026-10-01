import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseQuantity, type Dimension } from "./units.js";

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
