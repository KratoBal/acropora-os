import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

/**
 * KARBANTARTÁSI LAPHOZ CSAK KARBANTARTÁSI SZERZŐDÉS KAPCSOLHATÓ (karbantartási
 * felmérés S4, barracuda 31612).
 *
 * A beszerzési szerződésből számla készül, a javításiból (felmérés S0/3)
 * semmilyen karbantartási lap. Eddig a lap-létrehozás csak azt nézte, hogy a
 * szerződés a partneré-e, a fajtáját nem. MI PIROSÍT: ha egy beszerzési vagy
 * javítási szerződés karbantartási lapra kerül; ha a karbantartási szerződés
 * mégsem kapcsolható; ha az idegen szerződés üzenete összecsúszik a fajtáéval.
 */
function serviceWith(kind: "MAINTENANCE" | "PURCHASE" | "REPAIR" | null) {
  const created: unknown[] = [];
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
    contractKindForCustomer: async () => kind,
    lastNumberOfYear: async () => null,
    create: async (input) => {
      created.push(input);
      return { id: "job-1", jobNumber: "HJ-2026-001" } as never;
    },
  };
  return {
    service: new ServiceJobsService(repository as ServiceJobsRepository),
    created,
  };
}

const body = {
  title: "Éves karbantartás",
  kind: "MAINTENANCE",
  contractId: "contract-1",
  customerId: "customer-1",
  departmentId: "dep-1",
} as never;

describe("karbantartási laphoz csak karbantartási szerződés", () => {
  it("a négy eset: karbantartási, beszerzési, javítási, idegen", async () => {
    const outcome = async (
      kind: "MAINTENANCE" | "PURCHASE" | "REPAIR" | null,
    ) => {
      const { service, created } = serviceWith(kind);
      return service.create(body, "user-1").then(
        () => `létrejött (${created.length})`,
        (error: unknown) => (error as Error).message,
      );
    };
    assert.deepEqual(
      [
        await outcome("MAINTENANCE"),
        await outcome("PURCHASE"),
        await outcome("REPAIR"),
        await outcome(null),
      ],
      [
        "létrejött (1)",
        "Csak karbantartási szerződés kapcsolható karbantartási laphoz.",
        "Csak karbantartási szerződés kapcsolható karbantartási laphoz.",
        "A megadott szerződés nem ehhez a partnerhez tartozik.",
      ],
    );
  });
});
