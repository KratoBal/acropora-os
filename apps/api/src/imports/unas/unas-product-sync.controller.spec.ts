import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { UnasProductSyncQueryDto } from "./dto/unas-product-sync-query.dto.js";
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

    const result = await controller.run(new UnasProductSyncQueryDto());
    assert.equal(receivedToken, "private-token");
    assert.deepEqual(result, { runId: "run-1", status: "APPLIED" });
    assert.equal(JSON.stringify(result).includes("private-token"), false);
  });

  /**
   * A KET ALLITAS EGYUTT MERI A KAPCSOLOT, ES KULON IS ELROMOLHAT.
   *
   * Az elso azt mondja ki, hogy a MAI viselkedes valtozatlan: kapcsolo nelkul a
   * szinkron inkrementalis marad. Enelkul egy olyan valtozat is atmenne, ami
   * MINDIG teljeset futtat -- es az tobbszoros terhelest tenne az UNAS fele
   * olyankor, amikor senki nem kerte.
   *
   * A masodik azt, hogy a keres TENYLEG atmegy. Enelkul a kapcsolo letezne, de
   * nem csinalna semmit, es a hibaja NEMA lenne: a futas lefutna, jelentest is
   * irna, csak epp inkrementalisan.
   */
  it("kapcsolo nelkul a mai viselkedest hagyja: nem ker teljes osszevetest", async () => {
    let kapott: boolean | undefined = true;
    const controller = new UnasProductSyncController(
      { getToken: async () => "t" } as UnasAuthService,
      {
        runIncremental: async (
          _token: string,
          _windowEnd?: Date,
          _pageSize?: number,
          teljes?: boolean,
        ) => {
          kapott = teljes;
          return { runId: "run-1", status: "APPLIED" };
        },
      } as unknown as UnasProductSyncService,
      {} as UnasProductSyncRepository,
    );

    await controller.run(new UnasProductSyncQueryDto());

    assert.equal(kapott, false);
  });

  it("a full=true kerest atadja a szinkronnak", async () => {
    let kapott: boolean | undefined = false;
    const controller = new UnasProductSyncController(
      { getToken: async () => "t" } as UnasAuthService,
      {
        runIncremental: async (
          _token: string,
          _windowEnd?: Date,
          _pageSize?: number,
          teljes?: boolean,
        ) => {
          kapott = teljes;
          return { runId: "run-1", status: "APPLIED" };
        },
      } as unknown as UnasProductSyncService,
      {} as UnasProductSyncRepository,
    );

    const query = new UnasProductSyncQueryDto();
    query.full = true;
    await controller.run(query);

    assert.equal(kapott, true);
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
