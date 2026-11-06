import { describe, expect, it } from "vitest";

import { budapestInstant } from "./budapest-time";

/**
 * WHAT TURNS THIS RED: a nyitás a böngésző zónájában számolva (a teszt UTC-n és más zónán is ugyanazt várja); a téli
 * (CET, +1) és a nyári (CEST, +2) eltolás felcserélve; a nyári időszámítás váltásának napja eggyel elcsúszva; egy nem létező
 * nap vagy óra elfogadva (a `Date` magától átgörgetné a következő hónapra).
 */
describe("a budapesti fali idő pillanatként", () => {
  it("télen egy órával, nyáron két órával jár az UTC előtt", () => {
    expect(budapestInstant("2026-11-07", "21:00")).toBe(
      "2026-11-07T20:00:00.000Z",
    );
    expect(budapestInstant("2026-07-01", "12:30")).toBe(
      "2026-07-01T10:30:00.000Z",
    );
  });

  it("éjfél és a nap vége: a régi űrlap értékei (00:00 és 23:59)", () => {
    expect(budapestInstant("2026-11-07", "00:00")).toBe(
      "2026-11-06T23:00:00.000Z",
    );
    expect(budapestInstant("2026-11-07", "23:59")).toBe(
      "2026-11-07T22:59:00.000Z",
    );
  });

  it("az időszámítás-váltás napján a váltás előtti és utáni óra a saját eltolásával", () => {
    // 2026-10-25: 03:00 CEST-ből 02:00 CET lesz; 2026-03-29: 02:00 CET-ből 03:00 CEST
    expect(budapestInstant("2026-10-25", "01:30")).toBe(
      "2026-10-24T23:30:00.000Z",
    );
    expect(budapestInstant("2026-10-25", "04:00")).toBe(
      "2026-10-25T03:00:00.000Z",
    );
    expect(budapestInstant("2026-03-29", "01:30")).toBe(
      "2026-03-29T00:30:00.000Z",
    );
    expect(budapestInstant("2026-03-29", "04:00")).toBe(
      "2026-03-29T02:00:00.000Z",
    );
  });

  it("nem létező napot vagy órát nem fogad el, és rossz alakot sem", () => {
    for (const [day, time] of [
      ["2026-02-30", "10:00"],
      ["2026-13-01", "10:00"],
      ["2026-11-07", "24:00"],
      ["2026-11-07", "10:60"],
      ["2026-11-7", "10:00"],
      ["2026-11-07", "9:00"],
      ["", ""],
    ] as const)
      expect(budapestInstant(day, time), `${day} ${time}`).toBeNull();
  });
});
