import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthenticatedUser } from "@acropora/types";

import type { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

const PARTNER = {
  id: "partner-user",
  role: "PARTNER_SERVICE",
  customerId: "customer-a",
  supplierId: null,
} as AuthenticatedUser;

function serviceWithCreateSpy() {
  let created = false;
  let createdInput: Parameters<ServiceJobsRepository["create"]>[0] | null =
    null;
  const repository: Pick<ServiceJobsRepository, "create" | "lastNumberOfYear"> =
    {
      lastNumberOfYear: async () => null,
      create: async (input) => {
        created = true;
        createdInput = input;
        return { id: "job-1", jobNumber: input.jobNumber };
      },
    };
  return {
    service: new ServiceJobsService(repository as ServiceJobsRepository),
    wasCreated: () => created,
    createdInput: () => createdInput,
  };
}

describe("partner által nyitott hibajegy", () => {
  it("nem engedi, hogy a partner másik partner hibajegysorát hozza létre", async () => {
    const { service, wasCreated } = serviceWithCreateSpy();

    await assert.rejects(
      () =>
        service.create(
          { title: "Nem indul a szivattyú", customerId: "customer-b" },
          PARTNER,
        ),
      /csak a saját cégéhez lehet nyitni/,
    );
    assert.equal(wasCreated(), false);
  });

  it("a partnerhez köti a vevőazonosító nélkül nyitott hibajegyet", async () => {
    const { createdInput, service } = serviceWithCreateSpy();
    const created = await service.create(
      { title: "Nem indul a szivattyú" },
      PARTNER,
      new Date("2026-01-01T00:00:00.000Z"),
    );

    assert.equal(created.jobNumber, "HJ-2026-001");
    assert.equal(createdInput()?.customerId, "customer-a");
  });
});
