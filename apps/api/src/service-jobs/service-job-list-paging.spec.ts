import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SERVICE_JOB_LIST_SORT_FIELDS,
  type AuthenticatedUser,
} from "@acropora/types";

import { listOrderBy } from "../common/list-sort.js";
import { SERVICE_JOB_LIST_SORT } from "./service-job-list-sort.js";
import {
  LIST_PAGE_SIZE,
  type ServiceJobListOptions,
  ServiceJobsRepository,
} from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

const ZERO_COUNTS = {
  NEW: 0,
  TRIAGED: 0,
  SCHEDULED: 0,
  IN_PROGRESS: 0,
  WAITING_FOR_PARTS: 0,
  WAITING_FOR_CUSTOMER: 0,
  COMPLETED: 0,
  CANCELLED: 0,
};

/**
 * A HIBAJEGY-LISTA LAPOZÁSA, RENDEZÉSE ÉS ÚJ SZŰRŐI (f0b70dbd, (b) kör). MI PIROSÍT: ha a `page` nélküli kérés is lapozott választ kap
 * (a mobil és a régi lista a `truncated` alakot várja); ha a lapozott válasz oldalszáma nem a találatokból jön; ha a szolgáltatás egy
 * új szűrőt (állapot, partner, helyszín, rendezés) nem ad tovább a repositorynak; ha a rendezés fehér-listája kinyílik.
 */
function serviceWith(totalItems: number | undefined) {
  const calls: ServiceJobListOptions[] = [];
  const visibilities: unknown[] = [];
  const facetCalls: unknown[][] = [];
  const repository = {
    list: async (
      _scope: unknown,
      visibility: unknown,
      _search: unknown,
      _kind: unknown,
      _user: unknown,
      _maintenance: unknown,
      options: ServiceJobListOptions,
    ) => {
      calls.push(options);
      visibilities.push(visibility);
      return {
        rows: [],
        truncated: totalItems === undefined,
        ...(totalItems === undefined ? {} : { totalItems }),
      };
    },
    commonCounts: async () => ({
      NEW: 0,
      IN_PROGRESS: 0,
      WAITING: 0,
      DONE: 0,
      CLOSED: 0,
    }),
    commonWorksheetFacts: async () => new Map(),
    countsByStatus: async () => ZERO_COUNTS,
    listFacets: async (...args: unknown[]) => {
      facetCalls.push(args);
      return { partners: [], locations: [] };
    },
  };
  const service = new ServiceJobsService(
    repository as unknown as ServiceJobsRepository,
  );
  return { service, calls, facetCalls, visibilities };
}

const admin = { id: "office-user", role: "ADMIN" } as AuthenticatedUser;

describe("a hibajegy-lista lapozása", () => {
  it("a `page` nélküli kérés a régi alakot kapja: truncated, lapozás-adat nélkül", async () => {
    const { service, calls } = serviceWith(undefined);
    const response = await service.list({}, admin);
    assert.equal(response.truncated, true);
    assert.equal("pagination" in response, false);
    assert.equal(calls[0]!.page, undefined);
    assert.equal(calls[0]!.pageSize, undefined);
  });

  it("a `page` megadva: oldalszám a találatokból, alap oldalméret 25, nem vágott", async () => {
    const { service, calls } = serviceWith(51);
    const response = await service.list({ page: 2 }, admin);
    assert.equal(LIST_PAGE_SIZE, 25);
    assert.deepEqual(response.pagination, {
      page: 2,
      pageSize: 25,
      totalItems: 51,
      totalPages: 3,
    });
    assert.equal(response.truncated, false);
    assert.equal(calls[0]!.page, 2);
    assert.equal(calls[0]!.pageSize, 25);
  });

  it("a megadott oldalméret érvényes; nulla találatnál is egy oldal van", async () => {
    const { service } = serviceWith(0);
    const response = await service.list({ page: 1, pageSize: 50 }, admin);
    assert.deepEqual(response.pagination, {
      page: 1,
      pageSize: 50,
      totalItems: 0,
      totalPages: 1,
    });
  });

  it("a rendezést, az állapotokat, a partnert és a helyszínt továbbadja a repositorynak", async () => {
    const { service, calls } = serviceWith(3);
    await service.list(
      {
        page: 1,
        sort: "jobNumber",
        direction: "desc",
        statuses: ["NEW", "TRIAGED"],
        commonStatuses: ["DONE"],
        customerId: "cust-1",
        departmentId: "dep-1",
      },
      admin,
    );
    assert.deepEqual(calls[0], {
      statuses: ["NEW", "TRIAGED"],
      commonStatuses: ["DONE"],
      customerId: "cust-1",
      departmentId: "dep-1",
      page: 1,
      pageSize: 25,
      sort: "jobNumber",
      direction: "desc",
    });
  });

  it("a szűrő-lehetőségek az állapot-szűrőt kapják, a partner- és helyszín-szűrőt NEM", async () => {
    const { service, facetCalls } = serviceWith(0);
    await service.listFacets(
      {
        statuses: ["NEW"],
        commonStatuses: ["WAITING"],
        customerId: "cust-1",
        departmentId: "dep-1",
      },
      admin,
    );
    const args = facetCalls[0]!;
    assert.equal(args[0], "open");
    assert.equal(args[3], "REPAIR");
    assert.deepEqual(args[6], ["NEW"]);
    assert.deepEqual(args[7], ["WAITING"]);
    assert.equal(args.length, 8);
  });
});

describe("a lista és a szűrő-lehetőségek közös láthatósági szűrője", () => {
  it("a lista és a facets UGYANAZT a láthatósági feltételt kapja: rejtés és a létrehozás napja is benne van", async () => {
    const { service, visibilities, facetCalls } = serviceWith(0);
    const query = {
      includeHidden: true,
      createdFrom: "2026-11-01",
      createdTo: "2026-11-02",
    };
    await service.list({ ...query, page: 1 }, admin);
    await service.listFacets(query, admin);
    assert.deepEqual(facetCalls[0]![1], visibilities[0]);
    // and it is not an empty condition: the day range reached it
    assert.match(JSON.stringify(visibilities[0]), /createdAt/);
  });

  it("a nap-tartomány nélküli és a rejtés nélküli kérés más feltételt ad, tehát a közös szűrő tényleg a lekérdezésből épül", async () => {
    const { service, visibilities } = serviceWith(0);
    await service.list({ page: 1 }, admin);
    await service.list(
      { page: 1, createdFrom: "2026-11-01", createdTo: "2026-11-02" },
      admin,
    );
    assert.notDeepEqual(visibilities[0], visibilities[1]);
    // the hidden-rows switch changes it too (the partner portal never honours it; the internal admin does)
    await service.list({ page: 1, includeHidden: true }, admin);
    assert.notDeepEqual(visibilities[0], visibilities[2]);
  });
});

describe("a hibajegy-lista rendezése", () => {
  it("rendezés nélkül a létrehozás ideje, a legújabb elöl, azonosító", () => {
    assert.deepEqual(listOrderBy(SERVICE_JOB_LIST_SORT, undefined, undefined), [
      { createdAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("a kód és a létrehozás a saját mezőjére rendez, a kért irányra", () => {
    for (const direction of ["asc", "desc"] as const) {
      assert.deepEqual(
        listOrderBy(SERVICE_JOB_LIST_SORT, "jobNumber", direction)[0],
        { jobNumber: direction },
      );
      assert.deepEqual(
        listOrderBy(SERVICE_JOB_LIST_SORT, "createdAt", direction)[0],
        { createdAt: direction },
      );
    }
  });

  it("az állapot nem `orderBy` (a saját útja van, `service-job-list-status-sort.spec.ts`), az öröklött kulcs nincs a fehér-listán: az alapsorrend jön", () => {
    assert.ok(SERVICE_JOB_LIST_SORT_FIELDS.includes("status"));
    assert.equal(Object.hasOwn(SERVICE_JOB_LIST_SORT.fields, "status"), false);
    for (const bad of ["status", "title", "constructor"])
      assert.deepEqual(
        listOrderBy(SERVICE_JOB_LIST_SORT, bad as never, "asc"),
        listOrderBy(SERVICE_JOB_LIST_SORT, undefined, undefined),
        bad,
      );
  });
});
