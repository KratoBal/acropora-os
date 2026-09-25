import { describe, expect, it } from "vitest";

import {
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from "./measurement-time";

describe("toDatetimeLocalValue", () => {
  it("helyi év/hónap/nap/óra/perc hármast ír, nem UTC-t", () => {
    // KALIBRÁCIÓ: ha ez a függvény `toISOString()`-t hívna, egy este 23
    // órás dátum a szélesebb UTC-eltolású géppel a KÖVETKEZŐ napra esne.
    const date = new Date(2026, 8, 25, 23, 5, 0);
    expect(toDatetimeLocalValue(date)).toBe("2026-09-25T23:05");
  });

  it("egyjegyű hónapot, napot, órát és percet nullával tölt ki", () => {
    const date = new Date(2026, 0, 5, 9, 3, 0);
    expect(toDatetimeLocalValue(date)).toBe("2026-01-05T09:03");
  });
});

describe("fromDatetimeLocalValue", () => {
  it("visszaadja ugyanazt az időpontot, amit toDatetimeLocalValue írt", () => {
    const date = new Date(2026, 8, 25, 23, 5, 0);
    const parsed = fromDatetimeLocalValue(toDatetimeLocalValue(date));
    expect(parsed?.getTime()).toBe(date.getTime());
  });

  it("üres vagy értelmezhetetlen szövegre null-t ad", () => {
    expect(fromDatetimeLocalValue("")).toBeNull();
    expect(fromDatetimeLocalValue("nem dátum")).toBeNull();
  });
});
