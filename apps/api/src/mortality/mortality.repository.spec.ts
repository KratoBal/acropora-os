import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mortalityWhere,
  summarizeMonth,
  summaryWindows,
} from "./mortality.repository.js";

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

  it("a kereső a termék nevében, magyar nevében és a szabad szöveges névben keres", () => {
    assert.deepEqual(mortalityWhere({ q: "  bohóchal " }), {
      AND: [
        {
          OR: [
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
            { productName: { contains: "bohóchal", mode: "insensitive" } },
          ],
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

describe("summaryWindows", () => {
  it("a hónap eleje, az utolsó 7 nap és az előző 7 nap, Budapest szerint", () => {
    // 2026-10-06 20:00 Budapest (CEST)
    assert.deepEqual(summaryWindows(new Date("2026-10-06T18:00:00Z")), {
      monthStart: new Date("2026-09-30T22:00:00.000Z"),
      weekStart: new Date("2026-09-29T22:00:00.000Z"),
      previousWeekStart: new Date("2026-09-22T22:00:00.000Z"),
    });
  });

  it("a hónap első napján a hónap eleje a mai nap", () => {
    // 2026-11-01 00:30 Budapest (CET): UTC szerint még október 31.
    const { monthStart } = summaryWindows(new Date("2026-10-31T23:30:00Z"));
    assert.deepEqual(monthStart, new Date("2026-10-31T23:00:00.000Z"));
  });
});

describe("summarizeMonth", () => {
  it("összesen, hány akváriumban, és a legérintettebb", () => {
    assert.deepEqual(
      summarizeMonth([
        { aquariumId: "a", quantity: 2 },
        { aquariumId: "b", quantity: 6 },
        { aquariumId: "c", quantity: 1 },
      ]),
      { total: 9, aquariumCount: 3, top: { aquariumId: "b", quantity: 6 } },
    );
  });

  it("üres hónapban nincs legérintettebb", () => {
    assert.deepEqual(summarizeMonth([]), {
      total: 0,
      aquariumCount: 0,
      top: null,
    });
  });
});
