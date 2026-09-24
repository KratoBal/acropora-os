import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthenticatedUser } from "@acropora/types";
import { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

describe("service job kind filtering", () => {
  it("a MAINTENANCE munka a karbantartás-lista feltétele, nem a hibajegyé", async () => {
    const calls: unknown[] = [];
    const repository = new ServiceJobsRepository() as unknown as {
      database: { serviceJob: { groupBy: (input: unknown) => Promise<[]> } };
      countsByStatus: ServiceJobsRepository["countsByStatus"];
    };
    repository.database = {
      serviceJob: {
        groupBy: async (input: unknown) => {
          calls.push(input);
          return [];
        },
      },
    };

    await repository.countsByStatus({}, undefined, "REPAIR");
    await repository.countsByStatus({}, undefined, "MAINTENANCE");

    assert.deepEqual((calls[0] as { where: { AND: unknown[] } }).where.AND[1], {
      kind: "REPAIR",
    });
    assert.deepEqual((calls[1] as { where: { AND: unknown[] } }).where.AND[1], {
      kind: "MAINTENANCE",
    });
  });

  it("a webes alapértelmezett hibajegy-lista nem ad vissza MAINTENANCE sort, az ALL viszont igen", async () => {
    const kapottFajtak: string[] = [];
    const maintenanceRow = {
      id: "maintenance-1",
      jobNumber: "KB-2026-001",
      title: "Negyedéves ellenőrzés",
      kind: "MAINTENANCE" as const,
      status: "SCHEDULED" as const,
      customerName: "Acropora Kft.",
      departmentPath: ["Gépház"],
      departmentCode: "GEP",
      assignees: [],
      createdAt: new Date("2026-09-24T09:00:00.000Z"),
      worksheetCount: 0,
      hiddenAt: null,
    };
    const repository: Pick<ServiceJobsRepository, "list" | "countsByStatus"> = {
      list: async (_scope, _visibility, _search, kind) => {
        kapottFajtak.push(kind);
        return {
          rows: kind === "ALL" ? [maintenanceRow] : [],
          truncated: false,
        };
      },
      countsByStatus: async () => ({
        NEW: 0,
        TRIAGED: 0,
        SCHEDULED: 0,
        IN_PROGRESS: 0,
        WAITING_FOR_PARTS: 0,
        WAITING_FOR_CUSTOMER: 0,
        COMPLETED: 0,
        CANCELLED: 0,
      }),
    };
    const service = new ServiceJobsService(repository as ServiceJobsRepository);
    const user = { id: "office-user", role: "ADMIN" } as AuthenticatedUser;

    const hibajegyek = await service.list({}, user);
    const mindenMunka = await service.list({ kind: "ALL" }, user);

    assert.deepEqual(kapottFajtak, ["REPAIR", "ALL"]);
    assert.deepEqual(hibajegyek.items, []);
    assert.deepEqual(
      mindenMunka.items.map((item) => item.kind),
      ["MAINTENANCE"],
    );
  });
});
