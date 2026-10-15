import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/client";
import {
  keepsContractJobOperationId,
  newContractJobOperationId,
} from "./contract-job-operation";

describe("contract job operation id", () => {
  it("két hívás két különböző, a szerver hosszhatárán belüli kulcsot ad", () => {
    const first = newContractJobOperationId();
    const second = newContractJobOperationId();
    expect(first).not.toBe(second);
    // CreateContractJobDto: @MinLength(8) @MaxLength(100)
    expect(first.length).toBeGreaterThanOrEqual(8);
    expect(first.length).toBeLessThanOrEqual(100);
  });

  it("válasz nélküli hiba és 5xx után a kulcs marad, 4xx után új kell", () => {
    expect(keepsContractJobOperationId(new TypeError("Failed to fetch"))).toBe(
      true,
    );
    expect(keepsContractJobOperationId(new ApiError("Belső hiba", 500))).toBe(
      true,
    );
    expect(
      keepsContractJobOperationId(new ApiError("Elfogyott az alkalom", 409)),
    ).toBe(false);
    expect(keepsContractJobOperationId(new ApiError("Hibás tétel", 400))).toBe(
      false,
    );
  });
});
