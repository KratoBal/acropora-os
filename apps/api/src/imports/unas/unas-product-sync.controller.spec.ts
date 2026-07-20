import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UnasAuthService } from "./unas-auth.service.js";
import { UnasProductSyncController } from "./unas-product-sync.controller.js";
import type { UnasProductSyncRepository } from "./unas-product-sync.repository.js";
import type { UnasProductSyncService } from "./unas-product-sync.service.js";

describe("UnasProductSyncController", () => {
  it("obtains the token internally and returns only the sync result", async () => {
    let receivedToken = "";
    const controller = new UnasProductSyncController(
      { getToken: async () => "private-token" } as UnasAuthService,
      {
        runIncremental: async (token: string) => {
          receivedToken = token;
          return { runId: "run-1", status: "APPLIED" };
        },
      } as unknown as UnasProductSyncService,
      {} as UnasProductSyncRepository,
    );

    const result = await controller.run();
    assert.equal(receivedToken, "private-token");
    assert.deepEqual(result, { runId: "run-1", status: "APPLIED" });
    assert.equal(JSON.stringify(result).includes("private-token"), false);
  });

  it("returns a requested run status", async () => {
    const expected = { id: "run-1", status: "RUNNING" };
    const controller = new UnasProductSyncController(
      {} as UnasAuthService,
      {} as UnasProductSyncService,
      { getRun: async () => expected } as unknown as UnasProductSyncRepository,
    );
    assert.equal(await controller.getRun("run-1"), expected);
  });

  it("lists only the requested number of recent runs", async () => {
    let receivedLimit = 0;
    const expected = [{ id: "run-2", status: "APPLIED" }];
    const controller = new UnasProductSyncController(
      {} as UnasAuthService,
      {} as UnasProductSyncService,
      {
        listRuns: async (limit: number) => {
          receivedLimit = limit;
          return expected;
        },
      } as unknown as UnasProductSyncRepository,
    );
    assert.equal(await controller.listRuns({ limit: 10 }), expected);
    assert.equal(receivedLimit, 10);
  });
});
