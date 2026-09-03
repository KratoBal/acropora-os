import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthenticatedUser } from "@acropora/types";
import type { Prisma } from "@acropora/database";

import { expandAssignedUnits } from "./assigned-units.js";
import type { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

/**
 * A BEKOTES MERESE: eljut-e a szuro a LEKERDEZESIG.
 *
 * A `service-job-visibility.spec.ts` azt meri, hogy a szuro ALAKJA helyes. Ez a
 * fajl azt, hogy a szolgaltatas TENYLEG atadja a tarolonak -- a ketto kulon
 * romolhat el, es a masodik romlasa NEMA: a lekerdezes lefut, tobb sort ad, es
 * szabalyos valasznak latszik.
 */
function serviceWith(kapott: { where?: Prisma.ServiceJobWhereInput }) {
  const repository: Pick<ServiceJobsRepository, "list" | "assignedUnitIds"> = {
    assignedUnitIds: async () => ["u1"],
    list: async (_scope, visibility) => {
      kapott.where = visibility;
      return [];
    },
  };
  return new ServiceJobsService(repository as ServiceJobsRepository);
}

const belsos = { id: "user-1" } as AuthenticatedUser;
const partner = {
  id: "user-2",
  supplierId: "sup-1",
} as unknown as AuthenticatedUser;

describe("a láthatóság eljut a lekérdezésig", () => {
  it("belsős hívónál üres a szűrő", async () => {
    const kapott: { where?: Prisma.ServiceJobWhereInput } = {};
    await serviceWith(kapott).list({}, belsos);
    assert.deepEqual(kapott.where, {});
  });

  /**
   * A LENYEG: partner-oldali hivonal a szuro NEM ures, es MINDKET tengelyt viszi.
   * Ha a bekotes elmarad, ez a sor ures objektumot lat -- vagyis pontosan azt,
   * amit a belsos ag ad, es a ket eset megkulonboztethetetlenne valna.
   */
  it("partner hívónál mindkét tengely eljut a tárolóig", async () => {
    const kapott: { where?: Prisma.ServiceJobWhereInput } = {};
    await serviceWith(kapott).list({}, partner);
    assert.deepEqual(kapott.where, {
      OR: [
        { openedById: "user-2" },
        {
          customer: { worksheetDepartments: { some: { id: { in: ["u1"] } } } },
        },
      ],
    });
  });
});

describe("a részfa kibontása", () => {
  const units = [
    { id: "fank", name: "Fank", parentId: null },
    { id: "palmahaz", name: "Palmahaz", parentId: "fank" },
    { id: "akvarium", name: "Akvarium", parentId: "palmahaz" },
    { id: "biodom", name: "Biodom", parentId: null },
  ];

  it("a hozzárendelt csomópont alatti mindent hozza, feljebb semmit", () => {
    assert.deepEqual(
      expandAssignedUnits({ assignedIds: ["palmahaz"], units }),
      ["palmahaz", "akvarium"],
    );
  });

  it("két hozzárendelés egyesítve, ismétlés nélkül", () => {
    assert.deepEqual(
      expandAssignedUnits({ assignedIds: ["palmahaz", "biodom"], units }),
      ["palmahaz", "akvarium", "biodom"],
    );
  });

  /**
   * ISMERT POZITIV KONTROLL A FORDITOTT IRANYRA: a Biodomhoz rendelt ember NEM
   * latja a Fank agat. Enelkul a fenti ket allitas akkor is zold lenne, ha a
   * bejaras MINDENT visszaadna.
   */
  it("a testvér ág nem kerül bele", () => {
    const ids = expandAssignedUnits({ assignedIds: ["biodom"], units });
    assert.deepEqual(ids, ["biodom"]);
    assert.ok(!ids.includes("fank"));
    assert.ok(!ids.includes("palmahaz"));
  });
});
