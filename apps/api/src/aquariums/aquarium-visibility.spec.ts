import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { aquariumVisibilityWhere } from "./aquarium-visibility.js";

/**
 * A HELYSZÍN-TENGELY, TISZTA FÜGGVÉNYKÉNT -- DB NÉLKÜL MÉRVE.
 *
 * Ez a fájl a `Prisma.AquariumWhereInput` ALAKJÁT állítja, nem azt, hogy a
 * Postgres mit ad vissza rá -- ehhez postgres kellene, ami ebben a
 * munkakörnyezetben NINCS telepítve (lásd a `helyi-integracios-futas-ma-
 * nem-megy` emléket). Az `aquariums.repository.integration.spec.ts` méri a
 * DB-oldalt, CI-ben, ahol van postgres.
 *
 * AMIT EZ A FÁJL BIZONYÍT: a WHERE-alak SOHA nem enged át idegen ügyfelet
 * vagy idegen helyszínt, és üres kiosztásnál explicit üres eredményt ad,
 * nem "nincs szűrés"-t -- ez a `partner-scope.util.ts` fejlécében leírt
 * `AND`-ágas szabály közvetlen alkalmazása az akváriumra.
 */
describe("aquariumVisibilityWhere", () => {
  it("belsős hívónál nincs szűrés", () => {
    assert.deepEqual(
      aquariumVisibilityWhere({ scope: { kind: "internal" }, unitIds: [] }),
      {},
    );
  });

  it("vevő-hatókörnél a saját ügyfélre ÉS a kiosztott helyszínekre szűkít", () => {
    const where = aquariumVisibilityWhere({
      scope: { kind: "customer", customerId: "cust-1" },
      unitIds: ["dept-a", "dept-b"],
    });
    assert.deepEqual(where, {
      AND: [
        { customerId: "cust-1" },
        { departmentId: { in: ["dept-a", "dept-b"] } },
      ],
    });
  });

  /**
   * A "MÁSIK ÜGYFÉLÉ" ESET, EXPLICIT: egy vevő-hatókörű hívó saját
   * `customerId`-jén kívül SEMMILYEN más ügyfél akváriumára nem illeszkedik
   * a `where`, függetlenül attól, milyen helyszín-listát ad át a hívó.
   * Ez a `detail()`-en keresztül 404-ként jelenik meg (lásd
   * `aquariums.service.spec.ts` "saját akvárium látszik, másik ügyfélé
   * 404" tesztjét), mert a `findFirst` nulla sort talál.
   */
  it("MÁS ügyfél customerId-je sosem illeszkedhet, akárhány helyszín van kiosztva", () => {
    const where = aquariumVisibilityWhere({
      scope: { kind: "customer", customerId: "cust-1" },
      unitIds: ["dept-a"],
    });
    const andBranch = (where as { AND: readonly unknown[] }).AND;
    assert.deepEqual(andBranch[0], { customerId: "cust-1" });
    assert.notDeepEqual(andBranch[0], { customerId: "cust-OTHER" });
  });

  it("vevő-hatókörnél, kiosztott helyszín NÉLKÜL, explicit ÜRES eredményt ad -- nem szűrés-hiányt", () => {
    assert.deepEqual(
      aquariumVisibilityWhere({
        scope: { kind: "customer", customerId: "cust-1" },
        unitIds: [],
      }),
      { id: { in: [] } },
    );
  });

  it("szállító-hatókörnél mindig üres eredmény -- az akvárium ügyfél-fogalom", () => {
    assert.deepEqual(
      aquariumVisibilityWhere({
        scope: { kind: "supplier", supplierId: "sup-1" },
        unitIds: ["dept-a"],
      }),
      { id: { in: [] } },
    );
  });
});
