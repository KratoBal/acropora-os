import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROLE_PERMISSIONS, USER_ROLES, PERMISSIONS } from "@acropora/types";

import {
  mortalityChanges,
  mortalitySourceProblem,
  normalizedSource,
  occurredOnProblem,
  quantityProblem,
} from "./mortality.policy.js";

describe("mortalitySourceProblem", () => {
  it("beszállítói forrásnál a beszállító VAGY a neve, pontosan az egyik", () => {
    assert.match(
      mortalitySourceProblem({ sourceType: "SUPPLIER" }) ?? "",
      /válaszd ki a beszállítót, vagy írd be a nevét/,
    );
    assert.match(
      mortalitySourceProblem({ sourceType: "SUPPLIER", sourceNote: "  " }) ??
        "",
      /válaszd ki a beszállítót, vagy írd be a nevét/,
    );
    assert.equal(
      mortalitySourceProblem({ sourceType: "SUPPLIER", supplierId: "s1" }),
      null,
    );
    // Balázs 2026-10-07: a rendszerben nem szereplő beszállító is megadható
    assert.equal(
      mortalitySourceProblem({ sourceType: "SUPPLIER", sourceNote: "Kis Pál" }),
      null,
    );
    assert.match(
      mortalitySourceProblem({
        sourceType: "SUPPLIER",
        supplierId: "s1",
        sourceNote: "Kis Pál",
      }) ?? "",
      /a kettőt együtt nem/,
    );
  });

  it("beszállítónál a tárolt alak: a beszállító, vagy ha nincs, a név", () => {
    assert.deepEqual(
      normalizedSource({ sourceType: "SUPPLIER", supplierId: "s1" }),
      { sourceType: "SUPPLIER", supplierId: "s1", sourceNote: null },
    );
    assert.deepEqual(
      normalizedSource({ sourceType: "SUPPLIER", sourceNote: " Kis Pál " }),
      { sourceType: "SUPPLIER", supplierId: null, sourceNote: "Kis Pál" },
    );
  });

  it("nem beszállítói forrásnál beszállító nem adható meg", () => {
    assert.match(
      mortalitySourceProblem({ sourceType: "TRADE", supplierId: "s1" }) ?? "",
      /csak beszállítói/,
    );
  });

  it("az „Egyéb” forrásnak megnevezés kell, a szóköz nem az", () => {
    assert.match(
      mortalitySourceProblem({ sourceType: "OTHER", sourceNote: "  " }) ?? "",
      /meg kell nevezni/,
    );
    assert.equal(
      mortalitySourceProblem({ sourceType: "OTHER", sourceNote: "Pista" }),
      null,
    );
  });

  it("a többi nem beszállítói forrás megnevezés nélkül is jó", () => {
    for (const sourceType of [
      "LOCAL_BREEDER",
      "TRADE",
      "OWN_BREEDING",
    ] as const)
      assert.equal(mortalitySourceProblem({ sourceType }), null);
  });

  it("a megnevezés legfeljebb 200 karakter", () => {
    assert.match(
      mortalitySourceProblem({
        sourceType: "OTHER",
        sourceNote: "x".repeat(201),
      }) ?? "",
      /200/,
    );
  });
});

describe("normalizedSource", () => {
  it("beszállítónál eldobja a megnevezést", () => {
    assert.deepEqual(
      normalizedSource({
        sourceType: "SUPPLIER",
        supplierId: "s1",
        sourceNote: "x",
      }),
      { sourceType: "SUPPLIER", supplierId: "s1", sourceNote: null },
    );
  });

  it("máshol a megnevezést vágva tartja, az üreset null-ra teszi", () => {
    assert.deepEqual(
      normalizedSource({ sourceType: "TRADE", sourceNote: "  Béla  " }),
      { sourceType: "TRADE", supplierId: null, sourceNote: "Béla" },
    );
    assert.deepEqual(
      normalizedSource({ sourceType: "TRADE", sourceNote: " " }),
      {
        sourceType: "TRADE",
        supplierId: null,
        sourceNote: null,
      },
    );
  });
});

describe("quantityProblem", () => {
  it("csak pozitív egész", () => {
    assert.equal(quantityProblem(1), null);
    assert.equal(quantityProblem(12), null);
    for (const bad of [0, -1, 1.5, "2", null, undefined])
      assert.notEqual(quantityProblem(bad), null, String(bad));
  });
});

describe("mortalityChanges", () => {
  it("csak a megváltozott mezőket adja, régi és új értékkel", () => {
    assert.deepEqual(
      mortalityChanges(
        { quantity: 2, note: null, aquariumId: "a1" },
        { quantity: 3, note: null, aquariumId: "a1" },
      ),
      { quantity: { from: 2, to: 3 } },
    );
  });

  it("változás nélkül üres", () => {
    assert.deepEqual(mortalityChanges({ note: "x" }, { note: "x" }), {});
  });

  it("a null és a hiányzó egyformának számít", () => {
    assert.deepEqual(
      mortalityChanges({ supplierId: null }, { supplierId: undefined }),
      {},
    );
  });

  it("az elhullás napja napként hasonlít és naplózódik", () => {
    const day = (key: string) => new Date(`${key}T00:00:00Z`);
    // két külön Date példány ugyanarra a napra: nem változás
    assert.deepEqual(
      mortalityChanges(
        { occurredOn: day("2026-10-05") },
        { occurredOn: day("2026-10-05") },
      ),
      {},
    );
    assert.deepEqual(
      mortalityChanges(
        { occurredOn: day("2026-10-05") },
        { occurredOn: day("2026-10-03") },
      ),
      { occurredOn: { from: "2026-10-05", to: "2026-10-03" } },
    );
  });
});

describe("occurredOnProblem", () => {
  it("a mai és a múltbeli nap jó", () => {
    assert.equal(occurredOnProblem("2026-10-07", "2026-10-07"), null);
    assert.equal(occurredOnProblem("2025-12-31", "2026-10-07"), null);
  });

  it("a jövőbeli nap nem", () => {
    assert.equal(
      occurredOnProblem("2026-10-08", "2026-10-07"),
      "Az elhullás napja nem lehet a jövőben.",
    );
  });

  it("nem létező naptári nap vagy más alak nem", () => {
    for (const day of ["2026-02-30", "2026-13-01", "2026.10.07", "", "x"])
      assert.equal(
        occurredOnProblem(day, "2026-10-07"),
        "Az elhullás napja érvénytelen dátum.",
        day,
      );
  });
});

describe("a jogkörök (acrobot döntése, 27141)", () => {
  const expected: Record<string, string[]> = {
    OWNER: ["view", "manage"],
    ADMIN: ["view", "manage"],
    MANAGER: ["view", "manage"],
    SERVICE: ["view", "manage"],
    VIEWER: ["view"],
  };
  for (const role of USER_ROLES)
    it(`${role}: ${(expected[role] ?? []).join("+") || "semmi"}`, () => {
      const perms = ROLE_PERMISSIONS[role];
      const got = [
        perms.includes(PERMISSIONS.MORTALITY_VIEW) ? "view" : null,
        perms.includes(PERMISSIONS.MORTALITY_MANAGE) ? "manage" : null,
      ].filter(Boolean);
      assert.deepEqual(got, expected[role] ?? []);
    });
});
