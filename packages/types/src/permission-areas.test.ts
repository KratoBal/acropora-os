import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PERMISSIONS, ROLE_PERMISSIONS, type Permission } from "./auth.js";
import {
  areaLevel,
  areaLevels,
  overridesForDesired,
  PERMISSION_AREAS,
  withAreaLevel,
} from "./permission-areas.js";
import {
  ALL_PERMISSION_VALUES,
  MANAGE_VIEW_PAIRS,
  permissionsWithOverrides,
} from "./permission-overrides.js";

/**
 * A JOGOK TERÜLETENKÉNTI TÁBLÁZATA (3. lépés).
 *
 * MI PIROSÍT: ha egy jog kimarad a táblázatból, vagy kétszer szerepel; ha a
 * Kezelés nem viszi a Megtekintést; ha a táblázatból számolt eltérések nem
 * pontosan a kívánt halmazt adják vissza.
 */
describe("PERMISSION_AREAS", () => {
  it("minden jognak pontosan egy helye van", () => {
    const placed = PERMISSION_AREAS.flatMap((area) => [
      ...(area.view ? [area.view] : []),
      ...(area.manage ? [area.manage] : []),
      ...area.extras.map((extra) => extra.permission),
    ]);
    assert.deepEqual([...placed].sort(), [...ALL_PERMISSION_VALUES].sort());
  });

  it("a Számlázás saját sor, a Pénzügytől külön", () => {
    const billing = PERMISSION_AREAS.find((area) => area.key === "billing")!;
    assert.equal(billing.view, PERMISSIONS.BILLING_VIEW);
    const finance = PERMISSION_AREAS.find((area) => area.key === "finance")!;
    assert.notEqual(finance.view, billing.view);
  });
});

describe("a táblázat és a szerver párjai", () => {
  it("minden kétszintű terület kezelés-megtekintés párja a szerver szabályában áll", () => {
    // a táblázat a két jogot együtt állítja, de az API-ból bármi küldhető: a
    // szerver szabálya csak a MANAGE_VIEW_PAIRS-ben álló párokat őrzi
    for (const area of PERMISSION_AREAS)
      if (area.view && area.manage)
        assert.ok(
          MANAGE_VIEW_PAIRS.some(
            ([manage, view]) => manage === area.manage && view === area.view,
          ),
          `${area.key}: ${area.manage} -> ${area.view}`,
        );
  });
});

describe("szintek", () => {
  const service = PERMISSION_AREAS.find((area) => area.key === "service")!;
  const settings = PERMISSION_AREAS.find((area) => area.key === "settings")!;

  it("csak a létező szintek választhatók", () => {
    assert.deepEqual(areaLevels(service), ["none", "view", "manage"]);
    assert.deepEqual(areaLevels(settings), ["none", "manage"]);
  });

  it("a Kezelés a Megtekintést is adja, a Nincs mindkettőt veszi el", () => {
    const empty = new Set<Permission>();
    const managed = withAreaLevel(service, empty, "manage");
    assert.ok(managed.has(PERMISSIONS.SERVICE_VIEW));
    assert.ok(managed.has(PERMISSIONS.SERVICE_MANAGE));
    assert.equal(areaLevel(service, managed), "manage");
    const viewed = withAreaLevel(service, managed, "view");
    assert.deepEqual([...viewed].sort(), [PERMISSIONS.SERVICE_VIEW]);
    assert.equal(
      areaLevel(service, withAreaLevel(service, managed, "none")),
      "none",
    );
  });

  it("a szint-váltás a terület extráihoz nem nyúl", () => {
    const start = new Set<Permission>([PERMISSIONS.SERVICE_HIDE]);
    assert.ok(
      withAreaLevel(service, start, "manage").has(PERMISSIONS.SERVICE_HIDE),
    );
  });
});

describe("overridesForDesired", () => {
  it("a sablonból számolt eltérések pontosan a kívánt halmazt adják vissza", () => {
    let desired = new Set<Permission>(ROLE_PERMISSIONS.SERVICE);
    const finance = PERMISSION_AREAS.find((area) => area.key === "finance")!;
    const service = PERMISSION_AREAS.find((area) => area.key === "service")!;
    desired = withAreaLevel(finance, desired, "view");
    desired = withAreaLevel(service, desired, "view");
    const overrides = overridesForDesired("SERVICE", desired);
    assert.deepEqual(
      new Set(permissionsWithOverrides("SERVICE", overrides)),
      desired,
    );
  });

  it("a sablonnal azonos halmazhoz nincs eltérés", () => {
    assert.deepEqual(
      overridesForDesired("MANAGER", new Set(ROLE_PERMISSIONS.MANAGER)),
      [],
    );
  });
});
