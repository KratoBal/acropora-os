import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthenticatedUser } from "@acropora/types";

import { doneMaintenanceJobIds } from "./maintenance-done.js";
import { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

/*
  A KARBANTARTÁS LISTA FÜLEI A SZERVEREN SZŰRNEK (f4590db6; barracuda a #2710-en). A lista a legújabb kétszázat adja, és a karbantartási
  lap sosem zárul: a kliensoldali szűrésnél épp a régi, beragadt "Folyamatban" lap esett volna ki elsőként. A "kész" szabály egy helyen
  áll (`doneMaintenanceJobIds`: van munkalap, és mindegyik legutolsó verziója aláírt), a jelvény, a szűrő és a számláló ugyanazt használja.
  MI PIROSÍT: ha a munkalap nélküli lap késznek számít; ha egy aláíratlan munkalap mellett a lap kész; ha a lista a fülre nem szűr a
  szerveren (in / notIn a kész lapokra); ha a számláló más szabállyal számol; ha a hibajegy-lista számlálót kap.
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

describe("a karbantartási lap kész-szabálya", () => {
  it("kész: van munkalapja, és mindegyik legutolsó verziója aláírt", () => {
    const done = doneMaintenanceJobIds(
      ["mind-alairt", "egy-piszkozat", "munkalap-nelkul"],
      [
        { serviceJobId: "mind-alairt", latestStatus: "SIGNED" },
        { serviceJobId: "mind-alairt", latestStatus: "SIGNED" },
        { serviceJobId: "egy-piszkozat", latestStatus: "SIGNED" },
        { serviceJobId: "egy-piszkozat", latestStatus: "DRAFT" },
        { serviceJobId: null, latestStatus: "SIGNED" },
      ],
    );
    assert.deepEqual([...done], ["mind-alairt"]);
  });

  it("a verzió nélküli munkalap nem aláírt", () => {
    assert.equal(
      doneMaintenanceJobIds(
        ["kt"],
        [{ serviceJobId: "kt", latestStatus: undefined }],
      ).size,
      0,
    );
  });
});

/** A tároló egy hamis adatbázison: minden `findMany` a modell szerinti választ adja, és a hívás bekerül a naplóba. */
function repositoryWith(answers: {
  jobs: { id: string }[];
  sheets: { serviceJobId: string; versions: { status: string }[] }[];
}) {
  const calls: { model: string; args: unknown }[] = [];
  const repository = new ServiceJobsRepository();
  (repository as unknown as { database: unknown }).database = new Proxy(
    {},
    {
      get: (_, model: string) => ({
        findMany: async (args: unknown) => {
          calls.push({ model, args });
          if (model === "serviceJob") {
            // the main list query asks for the rows (`take`); the id lookups do not
            return (args as { take?: number }).take ? [] : answers.jobs;
          }
          if (model === "worksheet") return answers.sheets;
          return [];
        },
        groupBy: async () => [],
      }),
    },
  );
  return { repository, calls };
}

const ANSWERS = {
  jobs: [{ id: "kesz" }, { id: "fut" }, { id: "ures" }],
  sheets: [
    { serviceJobId: "kesz", versions: [{ status: "SIGNED" }] },
    { serviceJobId: "fut", versions: [{ status: "DRAFT" }] },
  ],
};

describe("a karbantartás fülei a szerveren", () => {
  it("a számláló a kész-szabály szerint számol: kész 1, folyamatban 2 (a munkalap nélküli is)", async () => {
    const { repository } = repositoryWith(ANSWERS);
    assert.deepEqual(await repository.maintenanceStateCounts({}, undefined), {
      progress: 2,
      done: 1,
    });
  });

  it("a Kész fül a kész lapokra, a Folyamatban fül a többire szűr, a fő lekérdezésben", async () => {
    for (const [state, expected] of [
      ["done", { in: ["kesz"] }],
      ["progress", { notIn: ["kesz"] }],
    ] as const) {
      const { repository, calls } = repositoryWith(ANSWERS);
      await repository.list(
        "all",
        {},
        undefined,
        "MAINTENANCE",
        "user-1",
        state,
      );
      const main = calls.find(
        (c) => c.model === "serviceJob" && (c.args as { take?: number }).take,
      );
      assert.ok(main, "the list's own query ran");
      const and = (main.args as { where: { AND: unknown[] } }).where.AND;
      assert.deepEqual(and.at(-1), { id: expected }, state);
    }
  });

  it("fül nélkül és a hibajegy-listán nincs ilyen szűrő", async () => {
    for (const kind of ["MAINTENANCE", "REPAIR"] as const) {
      const { repository, calls } = repositoryWith(ANSWERS);
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
      const and = (main.args as { where: { AND: unknown[] } }).where.AND;
      assert.equal(
        and.some(
          (part) => typeof part === "object" && part !== null && "id" in part,
        ),
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
      "list" | "countsByStatus" | "maintenanceStateCounts"
    > = {
      list: async (_scope, _visibility, _search, _kind, _viewer, state) => {
        kapott.push(state);
        return { rows: [], truncated: false };
      },
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
