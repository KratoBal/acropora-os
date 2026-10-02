import { describe, expect, it } from "vitest";

import { formatHuNumber } from "./number";

describe("a rendszer számformátuma", () => {
  it("tizedesvessző, és a jóváhagyott csoportosítás", () => {
    expect(formatHuNumber(1, { minimumFractionDigits: 2 })).toBe("1,00");
    expect(formatHuNumber("0.96", { minimumFractionDigits: 2 })).toBe("0,96");
    // the accepted consequence of keeping today's format: no group below 10 000
    expect(formatHuNumber(3000)).toBe("3000");
    expect(formatHuNumber(12500)).toBe("12 500");
    expect(formatHuNumber("2.5")).toBe("2,5");
  });

  it("ami nem szám, azt nem találja ki", () => {
    expect(formatHuNumber("kb 10")).toBe("kb 10");
  });
});
