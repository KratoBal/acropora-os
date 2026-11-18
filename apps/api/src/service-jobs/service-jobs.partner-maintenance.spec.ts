import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import type { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

/*
  A PARTNER NEM NYITHAT KARBANTARTÁSI LAPOT (hibajegy-maradek lista, S-jelű eset, acrobot 56144): a PARTNER_SERVICE szerep a `service.manage` jogot is viseli, ezért a `POST /service-jobs`
  `kind: "MAINTENANCE"` kéréssel ma karbantartási lapot hozna létre, és a felelősök "Új hibajegyet nyitott..." push-t kapnának róla. A karbantartási lap belső tétel (a Karbantartás menü, a
  szerződés, a TIG): a partner a javítási hibajegyet nyithatja. MI PIROSÍT: ha a partner `MAINTENANCE` kérése létrejön; ha az elutasítás nem 400; ha a partner hibajegye (REPAIR) vagy a belső
  felhasználó karbantartási lapja is elutasul (a kontroll: a tiltás szűk).
*/
function serviceWith() {
  const created: unknown[] = [];
  const repository: Pick<ServiceJobsRepository, "lastNumberOfYear" | "create"> =
    {
      lastNumberOfYear: async () => null,
      create: async (input) => {
        created.push(input);
        return { id: "job-1", jobNumber: "HJ-2026-0001" } as never;
      },
    };
  return {
    service: new ServiceJobsService(repository as ServiceJobsRepository),
    created,
  };
}

const PARTNER = {
  id: "partner-user",
  customerId: "customer-1",
  supplierId: null,
} as AuthenticatedUser;
const SZALLITO = {
  id: "supplier-user",
  customerId: null,
  supplierId: "supplier-1",
} as AuthenticatedUser;
const BELSOS = { id: "user-1" } as AuthenticatedUser;
const torzs = (over: Record<string, unknown> = {}) =>
  ({ title: "Szivattyú zúg", ...over }) as never;

describe("a partner nem nyithat karbantartási lapot", () => {
  it("a partner MAINTENANCE kérése 400, és nem jön létre semmi", async () => {
    const { service, created } = serviceWith();
    await assert.rejects(
      () => service.create(torzs({ kind: "MAINTENANCE" }), PARTNER),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /Karbantartási lapot csak a szerviz nyithat/.test(error.message),
    );
    assert.deepEqual(created, []);
  });

  it("kontroll: a partner hibajegye (kind nélkül és REPAIR) létrejön", async () => {
    for (const over of [{}, { kind: "REPAIR" }]) {
      const { service, created } = serviceWith();
      await service.create(torzs(over), PARTNER);
      assert.equal(created.length, 1);
    }
  });

  it("kontroll: a belső felhasználó karbantartási lapja létrejön", async () => {
    const { service, created } = serviceWith();
    await service.create(torzs({ kind: "MAINTENANCE" }), BELSOS);
    assert.equal(created.length, 1);
  });

  // barracuda, #2708: a szállítónak a létrehozás maga nem létezik (404, mint eddig), és a 400-as mondat ("a partner javítási hibajegyet nyithat") rá nem volna igaz
  it("a szállító MAINTENANCE kérése 404 marad, nem 400", async () => {
    const { service, created } = serviceWith();
    await assert.rejects(
      () => service.create(torzs({ kind: "MAINTENANCE" }), SZALLITO),
      NotFoundException,
    );
    assert.deepEqual(created, []);
  });
});
