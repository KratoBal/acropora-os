import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ServiceJobsRepository } from "./service-jobs.repository.js";

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
});
