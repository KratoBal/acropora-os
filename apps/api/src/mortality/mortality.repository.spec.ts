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

  it("az időszak az elhullás NAPJÁRA szűr, mindkét végén zártan", () => {
    // a `@db.Date` mező napja UTC éjfél: a zóna itt már nem számít
    const where = mortalityWhere({ from: "2026-10-01", to: "2026-10-06" });
    assert.deepEqual(where, {
      AND: [
        { occurredOn: { gte: new Date("2026-10-01T00:00:00.000Z") } },
        { occurredOn: { lte: new Date("2026-10-06T00:00:00.000Z") } },
      ],
    });
  });

  it("a rögzítés idejére nem szűr: egy utólag rögzített elhullás a saját napjánál számít", () => {
    const where = JSON.stringify(mortalityWhere({ from: "2026-12-01" }));
    assert.ok(!where.includes("recordedAt"));
    assert.ok(!where.includes("createdAt"));
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
    // a határok napok (`@db.Date`, UTC éjfél), mert az elhullás napját számolja
    assert.deepEqual(summaryWindows(new Date("2026-10-06T18:00:00Z")), {
      monthStart: new Date("2026-10-01T00:00:00.000Z"),
      weekStart: new Date("2026-09-30T00:00:00.000Z"),
      previousWeekStart: new Date("2026-09-23T00:00:00.000Z"),
    });
  });

  it("a hónap első napján a hónap eleje a mai nap", () => {
    // 2026-11-01 00:30 Budapest (CET): UTC szerint még október 31.
    const { monthStart } = summaryWindows(new Date("2026-10-31T23:30:00Z"));
    assert.deepEqual(monthStart, new Date("2026-11-01T00:00:00.000Z"));
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

  it("a csak halas rackes csoport az összesbe számít, az akváriumok közé nem", () => {
    assert.deepEqual(
      summarizeMonth([
        { aquariumId: null, quantity: 9 },
        { aquariumId: "a", quantity: 2 },
      ]),
      { total: 11, aquariumCount: 1, top: { aquariumId: "a", quantity: 2 } },
    );
    assert.deepEqual(summarizeMonth([{ aquariumId: null, quantity: 3 }]), {
      total: 3,
      aquariumCount: 0,
      top: null,
    });
  });

  it("üres hónapban nincs legérintettebb", () => {
    assert.deepEqual(summarizeMonth([]), {
      total: 0,
      aquariumCount: 0,
      top: null,
    });
  });
});
