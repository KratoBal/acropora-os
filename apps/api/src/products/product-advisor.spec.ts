import { describe, expect, it } from "vitest";

import { MissingDataProductAdvisor } from "./product-advisor.js";

describe("MissingDataProductAdvisor", () => {
  it("sosem talál ki ajánlást a vevőnek", async () => {
    const result = await new MissingDataProductAdvisor().advise({
      kind: "PLACEMENT",
      product: { id: "coral", name: "Korall", description: null },
      aquarium: { dimensions: "60×40×40", existingLighting: null, flow: null },
    });

    expect(result).toEqual({ kind: "missingProductFields", fields: [] });
  });
});
