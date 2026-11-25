import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CommonServiceStatus } from "@acropora/types";

import { commonStatusWhere } from "./common-status-where.js";
import {
  STATUS_SORT_WITHIN,
  statusSortOrder,
  statusSortSlices,
} from "./service-job-list-sort.js";
import { ServiceJobsRepository } from "./service-jobs.repository.js";

/*
  A HIBAJEGY-LISTA ÁLLAPOT SZERINT (picasso lista-terv 9. pont, Balázs D1, 2026-11-25). Az öt közös állapot felosztja a jegyeket, tehát a
  rendezett lista az állapotok egymás után; a lap a darabszámokból vágódik ki, és szeletenként egy lekérdezés megy a közös állapot
  szűrőjével (`commonStatusWhere`). Hogy a szűrők az adatbázison valóban felosztást adnak-e, és a sorozat egyezik-e a számlálóval, azt a
  `common-status.integration.spec.ts` méri valódi Postgresen; ez a fájl a vágást és a bekötést.
  MI PIROSÍT: ha egy állapothatáron átlógó lap sorai elvesznek vagy kétszer jönnek; ha a `desc` nem fordítja meg az állapotok sorrendjét;
  ha egy üres állapotra is megy lekérdezés; ha a szelet nem a lista szűrőjén belül kérdez; ha a többi rendezés is erre az útra kerül.
*/

describe("az állapot-rendezés vágása", () => {
  it("a folyamat sorrendje növekvőben, fordítva csökkenőben", () => {
    assert.deepEqual(statusSortOrder("asc"), [
      "NEW",
      "IN_PROGRESS",
      "WAITING",
      "DONE",
      "CLOSED",
    ]);
    assert.deepEqual(statusSortOrder(undefined), statusSortOrder("asc"));
    assert.deepEqual(statusSortOrder("desc"), [
      "CLOSED",
      "DONE",
      "WAITING",
      "IN_PROGRESS",
      "NEW",
    ]);
  });

  it("egy 25-ös lap, ahol az Új 20 és a Folyamatban 10: az első lap 20 + 5, a második a maradék 5", () => {
    assert.deepEqual(statusSortSlices([20, 10, 0, 0, 0], 0, 25), [
      { bucket: 0, skip: 0, take: 20 },
      { bucket: 1, skip: 0, take: 5 },
    ]);
    assert.deepEqual(statusSortSlices([20, 10, 0, 0, 0], 25, 25), [
      { bucket: 1, skip: 5, take: 5 },
    ]);
  });

  it("az üres állapot nem kap szeletet, és egy lap több határon is átlóghat", () => {
    assert.deepEqual(statusSortSlices([2, 0, 1, 0, 30], 1, 25), [
      { bucket: 0, skip: 1, take: 1 },
      { bucket: 2, skip: 0, take: 1 },
      { bucket: 4, skip: 0, take: 23 },
    ]);
  });

  it("a lista vége után üres a lap, és a szeletek összege sosem több, mint a kért", () => {
    assert.deepEqual(statusSortSlices([3, 4], 7, 25), []);
    assert.deepEqual(statusSortSlices([0, 0, 0, 0, 0], 0, 25), []);
    const counts = [7, 0, 13, 5, 9];
    const total = counts.reduce((a, b) => a + b, 0);
    for (let skip = 0; skip <= total; skip += 1) {
      const taken = statusSortSlices(counts, skip, 10).reduce(
        (sum, slice) => sum + slice.take,
        0,
      );
      assert.equal(taken, Math.max(0, Math.min(10, total - skip)), `${skip}`);
    }
  });
});

const BUCKET_SIZES: Record<CommonServiceStatus, number> = {
  NEW: 20,
  IN_PROGRESS: 10,
  WAITING: 0,
  DONE: 3,
  CLOSED: 7,
};

/** Melyik közös állapot szelete ez a feltétel (`{ AND: [lista, commonStatusWhere(s)] }`), vagy `null`, ha a lista saját lekérdezése. */
function bucketOf(where: unknown): CommonServiceStatus | null {
  const and = (where as { AND?: unknown[] } | undefined)?.AND;
  if (!and || and.length !== 2) return null;
  const tail = JSON.stringify(and[1]);
  return (
    (Object.keys(BUCKET_SIZES) as CommonServiceStatus[]).find(
      (status) => JSON.stringify(commonStatusWhere(status)) === tail,
    ) ?? null
  );
}

/** A tároló egy hamis adatbázison: a szeletek az állapotuk nevét és a sorszámukat kapják azonosítónak (`NEW-0`, `NEW-1`, ...). */
function repositoryWith() {
  const calls: { model: string; method: string; args: unknown }[] = [];
  const repository = new ServiceJobsRepository();
  (repository as unknown as { database: unknown }).database = new Proxy(
    {},
    {
      get: (_, model: string) => ({
        findMany: async (args: {
          where?: unknown;
          skip?: number;
          take?: number;
        }) => {
          calls.push({ model, method: "findMany", args });
          if (model !== "serviceJob" || !args.take) return [];
          const bucket = bucketOf(args.where);
          if (!bucket) return [];
          const from = args.skip ?? 0;
          const to = Math.min(BUCKET_SIZES[bucket], from + args.take);
          return Array.from({ length: Math.max(0, to - from) }, (_, i) => ({
            id: `${bucket}-${from + i}`,
            jobNumber: `SZ-${from + i}`,
            title: "x",
            kind: "REPAIR",
            status: "NEW",
            createdAt: new Date(0),
            hiddenAt: null,
            openedById: null,
            reporterPersonName: null,
            customer: null,
            departmentId: null,
            _count: { worksheets: 0 },
          }));
        },
        count: async (args: { where: unknown }) => {
          calls.push({ model, method: "count", args });
          const bucket = bucketOf(args.where);
          return bucket
            ? BUCKET_SIZES[bucket]
            : Object.values(BUCKET_SIZES).reduce((a, b) => a + b, 0);
        },
        groupBy: async () => [],
      }),
    },
  );
  return { repository, calls };
}

/** The bucket a recorded call asked for, or `null` for the list's own queries. */
const bucketCall = (call: { args: unknown }) =>
  bucketOf((call.args as { where?: unknown } | undefined)?.where);

const ids = (from: CommonServiceStatus, start: number, end: number) =>
  Array.from({ length: end - start }, (_, i) => `${from}-${start + i}`);

async function statusPage(page: number | undefined, direction: "asc" | "desc") {
  const { repository, calls } = repositoryWith();
  const result = await repository.list(
    "all",
    {},
    undefined,
    "REPAIR",
    "user-1",
    undefined,
    {
      ...(page === undefined ? {} : { page, pageSize: 25 }),
      sort: "status",
      direction,
    },
  );
  return { result, calls };
}

describe("a lista állapot szerint, a tárolóban", () => {
  it("növekvőben az első lap 20 Új és 5 Folyamatban, a második a maradék, az üres Vár valamire kimarad", async () => {
    const first = await statusPage(1, "asc");
    assert.deepEqual(
      first.result.rows.map((row) => row.id),
      [...ids("NEW", 0, 20), ...ids("IN_PROGRESS", 0, 5)],
    );
    assert.equal(first.result.totalItems, 40);
    const second = await statusPage(2, "asc");
    assert.deepEqual(
      second.result.rows.map((row) => row.id),
      [
        ...ids("IN_PROGRESS", 5, 10),
        ...ids("DONE", 0, 3),
        ...ids("CLOSED", 0, 7),
      ],
    );
    const queried = second.calls
      .filter((c) => c.method === "findMany" && bucketCall(c))
      .map(bucketCall);
    assert.deepEqual(queried, ["IN_PROGRESS", "DONE", "CLOSED"]);
  });

  it("csökkenőben a Lezárt elöl, az állapoton belül ugyanúgy a legújabb elöl", async () => {
    const { result, calls } = await statusPage(1, "desc");
    assert.deepEqual(
      result.rows.map((row) => row.id),
      [
        ...ids("CLOSED", 0, 7),
        ...ids("DONE", 0, 3),
        ...ids("IN_PROGRESS", 0, 10),
        ...ids("NEW", 0, 5),
      ],
    );
    for (const call of calls.filter(
      (c) => c.method === "findMany" && bucketCall(c),
    ))
      assert.deepEqual(
        (call.args as { orderBy: unknown }).orderBy,
        STATUS_SORT_WITHIN,
      );
  });

  it("minden szelet és darabszám a lista saját szűrőjén belül kérdez: ugyanaz, mint az oldalszám számlálásáé", async () => {
    const { calls } = await statusPage(1, "asc");
    const listCount = calls.find(
      (c) => c.method === "count" && !bucketCall(c),
    )!;
    const listWhere = JSON.stringify(
      (listCount.args as { where: unknown }).where,
    );
    const bucketCalls = calls.filter(bucketCall);
    // five counts and two slices
    assert.equal(bucketCalls.length, 7);
    for (const call of bucketCalls)
      assert.equal(
        JSON.stringify(
          (call.args as { where: { AND: unknown[] } }).where.AND[0],
        ),
        listWhere,
      );
  });

  it("lapozás nélkül a régi alak: legfeljebb 201 sor az állapotokon át, nem vágott", async () => {
    const { result } = await statusPage(undefined, "asc");
    assert.equal(result.rows.length, 40);
    assert.equal(result.rows[0]!.id, "NEW-0");
    assert.equal(result.rows.at(-1)!.id, "CLOSED-6");
    assert.equal(result.truncated, false);
    assert.equal(result.totalItems, undefined);
  });

  it("a többi rendezés nem erre az útra megy: egy lekérdezés, állapot-szelet nélkül", async () => {
    const { repository, calls } = repositoryWith();
    await repository.list("all", {}, undefined, "REPAIR", "user-1", undefined, {
      page: 1,
      sort: "jobNumber",
      direction: "asc",
    });
    assert.equal(calls.filter(bucketCall).length, 0);
    const main = calls.find(
      (c) =>
        c.model === "serviceJob" &&
        c.method === "findMany" &&
        (c.args as { take?: number }).take,
    )!;
    assert.deepEqual((main.args as { orderBy: unknown }).orderBy, [
      { jobNumber: "asc" },
      { id: "asc" },
    ]);
  });
});
