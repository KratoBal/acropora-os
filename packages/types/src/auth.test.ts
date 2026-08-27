import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  partnerMembership,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  USER_ROLES,
} from "./auth.js";

describe("role permission mapping", () => {
  it("defines a permission set for every role", () => {
    assert.deepEqual(
      Object.keys(ROLE_PERMISSIONS).sort(),
      [...USER_ROLES].sort(),
    );
  });

  it("grants every permission to owner and admin", () => {
    const permissionCount = Object.keys(PERMISSIONS).length;
    assert.equal(ROLE_PERMISSIONS.OWNER.length, permissionCount);
    assert.equal(ROLE_PERMISSIONS.ADMIN.length, permissionCount);
  });

  it("keeps closed-worksheet amendment away from the service role", () => {
    assert.ok(ROLE_PERMISSIONS.SERVICE.includes(PERMISSIONS.SERVICE_MANAGE));
    assert.ok(
      !ROLE_PERMISSIONS.SERVICE.includes(PERMISSIONS.SERVICE_WORKSHEET_AMEND),
    );
    assert.ok(
      !ROLE_PERMISSIONS.MANAGER.includes(PERMISSIONS.SERVICE_WORKSHEET_AMEND),
    );
    assert.ok(
      ROLE_PERMISSIONS.OWNER.includes(PERMISSIONS.SERVICE_WORKSHEET_AMEND),
    );
  });

  it("lets the service role see partners without editing them", () => {
    assert.ok(ROLE_PERMISSIONS.SERVICE.includes(PERMISSIONS.PARTNERS_VIEW));
    assert.ok(!ROLE_PERMISSIONS.SERVICE.includes(PERMISSIONS.PARTNERS_MANAGE));
  });

  /**
   * Partner access used to hang off the purchasing permissions, and the
   * supplier endpoints were moved onto the new pair. Anyone who could reach
   * partners before must still reach them, otherwise the split quietly takes
   * away access that nobody decided to take away -- and the only symptom would
   * be a colleague locked out of a screen they used yesterday.
   */
  it("takes partner access away from nobody who had it", () => {
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      if (permissions.includes(PERMISSIONS.PURCHASING_VIEW)) {
        assert.ok(
          permissions.includes(PERMISSIONS.PARTNERS_VIEW),
          `${role} could see partners before and cannot now`,
        );
      }
      if (permissions.includes(PERMISSIONS.PURCHASING_MANAGE)) {
        assert.ok(
          permissions.includes(PERMISSIONS.PARTNERS_MANAGE),
          `${role} could edit partners before and cannot now`,
        );
      }
    }
  });

  it("keeps warehouse permissions scoped to warehouse work", () => {
    assert.ok(
      ROLE_PERMISSIONS.WAREHOUSE.includes(PERMISSIONS.INVENTORY_MANAGE),
    );
    assert.ok(!ROLE_PERMISSIONS.WAREHOUSE.includes(PERMISSIONS.FINANCE_MANAGE));
  });
});

describe("permission helpers", () => {
  it("checks one permission", () => {
    assert.equal(hasPermission("SERVICE", PERMISSIONS.SERVICE_MANAGE), true);
    assert.equal(hasPermission("SERVICE", PERMISSIONS.USERS_MANAGE), false);
  });

  it("checks whether any permission is available", () => {
    assert.equal(
      hasAnyPermission("SALES", [
        PERMISSIONS.SETTINGS_MANAGE,
        PERMISSIONS.ORDERS_MANAGE,
      ]),
      true,
    );
    assert.equal(
      hasAnyPermission("VIEWER", [
        PERMISSIONS.SETTINGS_MANAGE,
        PERMISSIONS.USERS_MANAGE,
      ]),
      false,
    );
  });

  it("checks whether every permission is available", () => {
    assert.equal(
      hasAllPermissions("WAREHOUSE", [
        PERMISSIONS.INVENTORY_VIEW,
        PERMISSIONS.INVENTORY_MANAGE,
      ]),
      true,
    );
    assert.equal(
      hasAllPermissions("WAREHOUSE", [
        PERMISSIONS.INVENTORY_MANAGE,
        PERMISSIONS.FINANCE_MANAGE,
      ]),
      false,
    );
  });
});

describe("AI_TEST_VIEW", () => {
  it("is held by every role, because that is what was asked for", () => {
    /**
     * "Most kapja meg mindenki" (Balázs, 2026-08-26), és ez NEM ugyanaz, mint
     * nem tenni semmit.
     *
     * A MANAGER az összes jogot megkapja egy tiltólista kivételével, tehát egy
     * új kulcs magától az OWNER, ADMIN és MANAGER kezébe kerül - a többi
     * szerepkör tételes listát kap. Ha csak az alapértelmezésre hagyatkoznánk,
     * a "mindenki" csendben háromra szűkülne, és senki nem venné észre, mert
     * a menüpont ott is látszana, ahol nézzük.
     *
     * A szűkítés feltételét is ő mondta ki: amikor a felhasználói
     * jogosultságokat rendezzük. Addig ez a sor őrzi a döntést.
     */
    for (const role of USER_ROLES) {
      assert.equal(
        hasPermission(role, PERMISSIONS.AI_TEST_VIEW),
        true,
        `${role} nem kapta meg az AI teszt-felület jogát`,
      );
    }
  });
});

/**
 * Minden teszthez oda van irva, MI PIROSITANA. Enelkul egy zold sor csak annyit
 * mond, hogy a kod lefutott -- nem azt, hogy megfog valamit. Ahol a hiba iranya
 * szamit, az is ki van irva: a "szeles" irany az, ami tobb sort engedne at.
 */
describe("partnerMembership", () => {
  it("a sajat kollegank egyik partnerhez sem tartozik", () => {
    // PIROSIT: ha a fuggveny egy hianyzo azonositot partner-hovatartozasnak
    // olvasna, vagy ha a ket NULL-t ketertelmunek nezne.
    assert.deepEqual(
      partnerMembership({ customerId: null, supplierId: null }),
      { kind: "internal" },
    );
  });

  it("a vevo-oldali fiok a vevo azonositojat viszi tovabb", () => {
    // PIROSIT: ha az azonosito elveszne az uton, vagy ha a masik oszlopot
    // olvasna. Az azonositora azert allitunk, es nem csak a kind-ra, mert a
    // szuro EZT az erteket fogja hasznalni.
    assert.deepEqual(
      partnerMembership({ customerId: "cus_1", supplierId: null }),
      { kind: "customer", customerId: "cus_1" },
    );
  });

  it("a partner-oldali fiok a partner azonositojat viszi tovabb", () => {
    // PIROSIT: ha a supplier ag atesne az internal agra. Ez a SZELES irany:
    // egy partner-fiok igy a mi kollegankent viselkedne.
    assert.deepEqual(
      partnerMembership({ customerId: null, supplierId: "sup_1" }),
      { kind: "supplier", supplierId: "sup_1" },
    );
  });

  it("mindket oszlop kitoltve: ketertelmu, es NEM valaszt egyet sem", () => {
    // PIROSIT: ha a fuggveny csendben valasztana az egyiket, vagy ha
    // internal-ra esne. Az adatbazis CHECK constraintje ezt az allapotot
    // tiltja, tehat ide jutni annyit tesz, hogy a megszoritas nincs meg vagy
    // az ertek nem az adatbazisbol jott -- es ilyenkor a legrosszabb valasz
    // az internal, mert egy torott sorbol a legszelesebb hozzaferest csinalna.
    assert.deepEqual(
      partnerMembership({ customerId: "cus_1", supplierId: "sup_1" }),
      { kind: "ambiguous" },
    );
  });

  it("az ures azonosito NEM olvasodik hianynak", () => {
    // PIROSIT: ha a fuggveny igazsagertek szerint dontene (`if (id)`), mert
    // akkor az ures sztring hianynak latszana, a hianyzo hovatartozas pedig a
    // mi kollegankat jelenti -- vagyis a legszelesebb hozzaferest. Jelenletre
    // vizsgalva olyan hovatartozas lesz belole, amire egy partner sem
    // illeszkedik, tehat a szuro semmit nem ad vissza. Mindket olvasat teved
    // az ertekrol; csak az egyik teved a BIZTONSAGOS iranyba.
    assert.deepEqual(partnerMembership({ customerId: "", supplierId: null }), {
      kind: "customer",
      customerId: "",
    });
  });

  it("a hianyzo mezo (undefined) hianynak szamit", () => {
    // PIROSIT: ha egy JSON-hataron atjott, mezo nelkuli objektum kivetelt
    // dobna, vagy ha a ket hianyzo mezot ketertelmunek nezne. A tipus nem
    // engedi az undefined-et, a futasido viszont talalkozhat vele.
    assert.deepEqual(
      partnerMembership({
        customerId: undefined,
        supplierId: undefined,
      } as unknown as { customerId: string | null; supplierId: string | null }),
      { kind: "internal" },
    );
  });
});
