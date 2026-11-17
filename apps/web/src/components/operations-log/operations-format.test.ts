import { describe, expect, it } from "vitest";

import { targetLabel } from "./operations-format";

describe("targetLabel", () => {
  it("egy eszköznél a szám és a név, több eszköznél a darabszám, kategóriánál a kategória neve", () => {
    expect(
      targetLabel({
        kind: "ASSETS",
        assets: [{ assetId: "a1", assetNumber: "V2196", name: "Homokszűrő" }],
      }),
    ).toBe("Eszköz · V2196 Homokszűrő");
    expect(
      targetLabel({
        kind: "ASSETS",
        assets: [
          { assetId: "a1", assetNumber: "V1", name: "Egy" },
          { assetId: "a2", assetNumber: "V2", name: "Kettő" },
          { assetId: "a3", assetNumber: "V3", name: "Három" },
        ],
      }),
    ).toBe("Eszközlista · 3 eszköz");
    expect(
      targetLabel({ kind: "CATEGORY", categoryId: "c1", name: "Vízkezelés" }),
    ).toBe("Kategória · Vízkezelés");
  });
});
