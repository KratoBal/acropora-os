import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthenticatedUser } from "@acropora/types";

import { MAINTENANCE_DONE, maintenanceStateWhere } from "./maintenance-done.js";
import { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

/*
  A KARBANTARTÁS LISTA FÜLEI A SZERVEREN SZŰRNEK (f4590db6; barracuda a #2710-en). A lista a legújabb kétszázat adja, és a karbantartási
  lap sosem zárul: a kliensoldali szűrésnél épp a régi, beragadt "Folyamatban" lap esett volna ki elsőként. A "kész" szabály egy helyen
  áll (`MAINTENANCE_DONE`: van munkalap, és mindegyik legutolsó verziója aláírt), a jelvény, a szűrő és a számláló ugyanazt használja.
  2026-11-18 óta (a9db2779, barracuda a #2711-en) a szabály SZŰRŐ, nem azonosító-lista: EXISTS / NOT EXISTS részlekérdezés a fő
  lekérdezésben. Hogy a szűrő az adatbázison azt adja-e, amit a szabály mond, azt a `maintenance-done.integration.spec.ts` méri valódi
  Postgresen; ez a fájl a bekötést.
  MI PIROSÍT: ha a lista a fülre nem a szabállyal szűr a fő lekérdezésben; ha a tároló a fő lekérdezés előtt azonosítókat gyűjt (a régi
  `in` / `notIn` út); ha a számláló más szabállyal vagy azonosító-listával számol; ha a hibajegy-lista vagy a fül nélküli lista szűrőt kap.
*/

const STATUSES = {
  NEW: 0,
  TRIAGED: 0,
  SCHEDULED: 0,
  IN_PROGRESS: 0,
  WAITING_FOR_PARTS: 0,
  WAITING_FOR_CUSTOMER: 0,
  COMPLETED: 0,
  CANCELLED: 0,
};

describe("a karbantartási lap kész-szabálya, szűrőként", () => {
  it("kész: van munkalapja, és egyiknek sincs hiányzó vagy nem aláírt legutolsó verziója", () => {
    assert.deepEqual(MAINTENANCE_DONE, {
      worksheets: {
        some: {},
        none: {
          OR: [
            { latestVersion: { is: null } },
            { latestVersion: { is: { status: { not: "SIGNED" } } } },
          ],
        },
      },
    });
  });

  it("a Kész fül maga a szabály, a Folyamatban fül a tagadása", () => {
    assert.equal(maintenanceStateWhere("done"), MAINTENANCE_DONE);
    assert.deepEqual(maintenanceStateWhere("progress"), {
      NOT: MAINTENANCE_DONE,
    });
  });
});

/** A tároló egy hamis adatbázison: minden hívás bekerül a naplóba; a `count` a szabályra 1-et, enélkül 3-at ad. */
function repositoryWith() {
  const calls: { model: string; method: string; args: unknown }[] = [];
  const repository = new ServiceJobsRepository();
  (repository as unknown as { database: unknown }).database = new Proxy(
    {},
    {
      get: (_, model: string) => ({
        findMany: async (args: unknown) => {
          calls.push({ model, method: "findMany", args });
          return [];
        },
        count: async (args: { where: { AND: unknown[] } }) => {
          calls.push({ model, method: "count", args });
          return args.where.AND.includes(MAINTENANCE_DONE) ? 1 : 3;
        },
        groupBy: async () => [],
      }),
    },
  );
  return { repository, calls };
}

/** Van-e a szűrőben a lapok számával növő azonosító-lista (`id: { in }` vagy `id: { notIn }`). */
const hasIdList = (where: unknown): boolean =>
  JSON.stringify(where).includes('"id":{"in"') ||
  JSON.stringify(where).includes('"notIn"');

describe("a karbantartás fülei a szerveren", () => {
  it("a számláló két számlálás, a második a szabállyal: kész 1, folyamatban 2, azonosító-lista nélkül", async () => {
    const { repository, calls } = repositoryWith();
    assert.deepEqual(await repository.maintenanceStateCounts({}, undefined), {
      progress: 2,
      done: 1,
    });
    assert.deepEqual(
      calls.map((c) => `${c.model}.${c.method}`),
      ["serviceJob.count", "serviceJob.count"],
    );
    for (const call of calls) assert.equal(hasIdList(call.args), false);
  });

  it("a Kész és a Folyamatban fül a szabállyal szűr a fő lekérdezésben, és előtte nem gyűjt azonosítót", async () => {
    for (const state of ["done", "progress"] as const) {
      const { repository, calls } = repositoryWith();
      await repository.list(
        "all",
        {},
        undefined,
        "MAINTENANCE",
        "user-1",
        state,
      );
      const first = calls[0];
      assert.ok(
        first &&
          first.model === "serviceJob" &&
          (first.args as { take?: number }).take,
        `${state}: the list's own query is the first call`,
      );
      const and = (first.args as { where: { AND: unknown[] } }).where.AND;
      assert.deepEqual(and.at(-1), maintenanceStateWhere(state), state);
      assert.equal(hasIdList(first.args), false, state);
    }
  });

  it("fül nélkül és a hibajegy-listán nincs ilyen szűrő", async () => {
    for (const kind of ["MAINTENANCE", "REPAIR"] as const) {
      const { repository, calls } = repositoryWith();
      await repository.list(
        "all",
        {},
        undefined,
        kind,
        "user-1",
        kind === "REPAIR" ? "done" : undefined,
      );
      const main = calls.find(
        (c) => c.model === "serviceJob" && (c.args as { take?: number }).take,
      )!;
      assert.equal(
        JSON.stringify(main.args).includes('"latestVersion"'),
        false,
        kind,
      );
    }
  });
});

describe("a szolgáltatás a fület továbbadja, és a számlálót csak a karbantartásnak adja", () => {
  it("MAINTENANCE: a fül a tárolóhoz megy, a válaszban maintenanceCounts; REPAIR: nincs", async () => {
    const kapott: unknown[] = [];
    const repository: Pick<
      ServiceJobsRepository,
      | "list"
      | "countsByStatus"
      | "commonCounts"
      | "commonWorksheetFacts"
      | "maintenanceStateCounts"
    > = {
      list: async (_scope, _visibility, _search, _kind, _viewer, state) => {
        kapott.push(state);
        return { rows: [], truncated: false };
      },
      commonCounts: async () => ({
        NEW: 0,
        IN_PROGRESS: 0,
        WAITING: 0,
        DONE: 0,
        CLOSED: 0,
      }),
      commonWorksheetFacts: async () => new Map(),
      countsByStatus: async () => STATUSES,
      maintenanceStateCounts: async () => ({ progress: 3, done: 4 }),
    };
    const service = new ServiceJobsService(repository as ServiceJobsRepository);
    const user = { id: "office-user", role: "ADMIN" } as AuthenticatedUser;

    const maintenance = await service.list(
      { kind: "MAINTENANCE", scope: "all", maintenanceState: "done" },
      user,
    );
    assert.deepEqual(kapott, ["done"]);
    assert.deepEqual(maintenance.maintenanceCounts, { progress: 3, done: 4 });

    const repair = await service.list({ kind: "REPAIR" }, user);
    assert.equal("maintenanceCounts" in repair, false);
  });
});
