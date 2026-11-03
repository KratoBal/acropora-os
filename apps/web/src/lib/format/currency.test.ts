import { describe, expect, it } from "vitest";

import { currencyLabel } from "./currency";

// What must fail: the forint shown as the ISO code ("HUF") beside "Ft" elsewhere; another
// currency changed or lost; a missing currency becoming the word "null"; case and spaces mattering.
describe("currencyLabel", () => {
  it("writes the forint as Ft, whatever the case or spacing of the code", () => {
    expect(currencyLabel("HUF")).toBe("Ft");
    expect(currencyLabel(" huf ")).toBe("Ft");
  });

  it("leaves another currency as its code", () => {
    expect(currencyLabel("EUR")).toBe("EUR");
    expect(currencyLabel("usd")).toBe("USD");
  });

  it("gives an empty label for a missing currency, not the word null", () => {
    expect(currencyLabel(null)).toBe("");
    expect(currencyLabel(undefined)).toBe("");
    expect(currencyLabel("")).toBe("");
  });
});
