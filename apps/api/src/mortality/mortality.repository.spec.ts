import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mortalityWhere } from "./mortality.repository.js";

describe("mortalityWhere", () => {
  it("szűrő nélkül üres", () => {
    assert.deepEqual(mortalityWhere({}), {});
  });

  it("a dátumot Budapest napja szerint vágja, a végét a nap végéig", () => {
    // 2026-10-06 nyári időben: Budapest napja 2026-10-05T22:00Z-kor kezdődik
    const where = mortalityWhere({ from: "2026-10-06", to: "2026-10-06" });
    assert.deepEqual(where, {
      AND: [
        { recordedAt: { gte: new Date("2026-10-05T22:00:00.000Z") } },
        { recordedAt: { lt: new Date("2026-10-06T22:00:00.000Z") } },
      ],
    });
  });

  it("téli időben egy órával később", () => {
    const where = mortalityWhere({ from: "2026-12-01" });
    assert.deepEqual(where, {
      AND: [{ recordedAt: { gte: new Date("2026-11-30T23:00:00.000Z") } }],
    });
  });

  it("a kereső a termék nevében és magyar nevében keres", () => {
    assert.deepEqual(mortalityWhere({ q: "  bohóchal " }), {
      AND: [
        {
          product: {
            OR: [
              { name: { contains: "bohóchal", mode: "insensitive" } },
              {
                datasheet: {
                  magyarNev: { contains: "bohóchal", mode: "insensitive" },
                },
              },
            ],
          },
        },
      ],
    });
  });

  it("a többi szűrő egyenlőség", () => {
    assert.deepEqual(
      mortalityWhere({
        sourceType: "SUPPLIER",
        supplierId: "s",
        aquariumId: "a",
        recordedById: "u",
      }),
      {
        AND: [
          { sourceType: "SUPPLIER" },
          { supplierId: "s" },
          { aquariumId: "a" },
          { recordedById: "u" },
        ],
      },
    );
  });
});
