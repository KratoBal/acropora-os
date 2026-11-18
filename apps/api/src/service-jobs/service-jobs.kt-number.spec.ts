import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

/*
  A LÉTREHOZÁS A FAJTA SZERINTI SOROZATBÓL ADJA A SZÁMOT (Balázs, 2026-11-18; acrobot 55777): a karbantartási lap KT-, a hibajegy HJ-számot kap,
  és a következő szám a SAJÁT sorozat utolsó számából jön (a kiosztás az előtagra kérdez). MI PIROSÍT: ha a MAINTENANCE jegy HJ számot kap; ha a
  kiosztás a másik sorozat utolsó számát kérdezi; ha a hibajegy elveszti a HJ-ját.
*/
function serviceWith(last: (prefix: string) => string | null) {
  const asked: string[] = [];
  const created: { jobNumber: string }[] = [];
  const repository: Pick<
    ServiceJobsRepository,
    | "assetsOutsideDepartment"
    | "departmentBelongsToCustomer"
    | "contractKindForCustomer"
    | "lastNumberOfYear"
    | "create"
  > = {
    assetsOutsideDepartment: async () => [],
    departmentBelongsToCustomer: async () => true,
    contractKindForCustomer: async () => "MAINTENANCE",
    lastNumberOfYear: async (prefix) => {
      asked.push(prefix);
      return last(prefix);
    },
    create: async (input) => {
      created.push(input as { jobNumber: string });
      return { id: "job-1", jobNumber: input.jobNumber } as never;
    },
  };
  return {
    service: new ServiceJobsService(repository as ServiceJobsRepository),
    asked,
    created,
  };
}

const year = new Date().getFullYear();
const body = (kind: "MAINTENANCE" | "REPAIR") =>
  ({
    title: "Éves karbantartás",
    kind,
    ...(kind === "MAINTENANCE" ? { contractId: "contract-1" } : {}),
    customerId: "customer-1",
    departmentId: "dep-1",
  }) as never;

describe("a létrehozás a fajta szerinti sorozatból ad számot", () => {
  it("a karbantartási lap KT-, a hibajegy HJ-számot kap, mindkettő a saját sorozat utolsó számából", async () => {
    const own = (prefix: string) =>
      prefix === `KT-${year}-` ? `KT-${year}-007` : `HJ-${year}-043`;
    const maintenance = serviceWith(own);
    await maintenance.service.create(body("MAINTENANCE"), "user-1");
    assert.deepEqual(maintenance.asked, [`KT-${year}-`]);
    assert.equal(maintenance.created[0]?.jobNumber, `KT-${year}-008`);

    const repair = serviceWith(own);
    await repair.service.create(body("REPAIR"), "user-1");
    assert.deepEqual(repair.asked, [`HJ-${year}-`]);
    assert.equal(repair.created[0]?.jobNumber, `HJ-${year}-044`);
  });

  it("az év első karbantartása KT-001, a HJ sorozattól függetlenül", async () => {
    const { service, created } = serviceWith(() => null);
    await service.create(body("MAINTENANCE"), "user-1");
    assert.equal(created[0]?.jobNumber, `KT-${year}-001`);
  });
});
