import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PartnerScope } from "../auth/partner-scope.util.js";
import {
  DashboardServiceWidgetsRepository,
  type ServiceWidgetViewer,
} from "./dashboard-service-widgets.repository.js";

interface Call {
  model: string;
  method: string;
  args: unknown;
}

/**
 * A database stand-in that records every query and answers from `answers`.
 * The rules under test are in the WHERE clauses, so the calls are the result.
 */
function repositoryWith(answers: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_, method: string) => async (args: unknown) => {
          calls.push({ model: name, method, args });
          const key = `${name}.${method}`;
          const answer = answers[key];
          return typeof answer === "function" ? answer(args) : answer;
        },
      },
    );
  const database = new Proxy(
    {},
    {
      get: (_, name: string) => {
        if (name === "$queryRaw")
          return async (
            strings: TemplateStringsArray,
            ...values: unknown[]
          ) => {
            calls.push({
              model: "$queryRaw",
              method: "raw",
              args: { sql: strings.join("?"), values },
            });
            return answers["$queryRaw"] ?? [];
          };
        return model(name);
      },
    },
  );
  const repository = new DashboardServiceWidgetsRepository();
  (repository as unknown as { database: unknown }).database = database;
  return { repository, calls };
}

const internal: ServiceWidgetViewer = {
  userId: "user-1",
  scope: { kind: "internal" } as PartnerScope,
  assignedUnitIds: [],
};
const customer: ServiceWidgetViewer = {
  userId: "partner-1",
  scope: { kind: "customer", customerId: "customer-1" } as PartnerScope,
  assignedUnitIds: ["unit-1"],
};

const json = (value: unknown) => JSON.stringify(value);

describe("Nyitott hibajegyek", () => {
  it("counts only open, not hidden tickets in the caller's scope, by status", async () => {
    const { repository, calls } = repositoryWith({
      "serviceJob.groupBy": [
        { status: "NEW", _count: { _all: 2 } },
        { status: "WAITING_FOR_PARTS", _count: { _all: 1 } },
        { status: "IN_PROGRESS", _count: { _all: 0 } },
      ],
      "serviceJob.findFirst": { createdAt: new Date("2026-09-20T08:00:00Z") },
    });
    const data = await repository.serviceTickets(customer);

    assert.deepEqual(data, {
      openCount: 3,
      byStatus: { NEW: 2, WAITING_FOR_PARTS: 1 },
      oldestOpenAt: "2026-09-20T08:00:00.000Z",
    });
    const where = json(
      (calls.find((c) => c.method === "groupBy")?.args as { where: unknown })
        .where,
    );
    assert.match(
      where,
      /"hiddenAt":null/,
      "hidden tickets must not be counted",
    );
    assert.match(
      where,
      /"notIn":\["COMPLETED","CANCELLED"\]/,
      "finished tickets must not be counted",
    );
    assert.match(where, /customer-1/, "the partner scope must be applied");
    // the oldest one is read with the same filter
    assert.equal(
      json(
        (
          calls.find((c) => c.method === "findFirst")?.args as {
            where: unknown;
          }
        ).where,
      ),
      where,
    );
  });

  it("nothing open: zero, no status, no age", async () => {
    const { repository } = repositoryWith({
      "serviceJob.groupBy": [],
      "serviceJob.findFirst": null,
    });
    assert.deepEqual(await repository.serviceTickets(internal), {
      openCount: 0,
      byStatus: {},
      oldestOpenAt: null,
    });
  });
});

describe("Munkalapok", () => {
  it("counts the latest versions of the visible, not hidden worksheets, and the certificates without a signed form", async () => {
    const { repository, calls } = repositoryWith({
      "worksheet.findMany": [{ id: "w1" }, { id: "w2" }],
      "completionCertificate.count": 4,
      $queryRaw: [{ draft: 1n, not_sent: 2n, sent: 3n }],
    });
    const data = await repository.worksheets(customer);

    assert.deepEqual(data, {
      draft: 1,
      awaitingSignatureNotSent: 2,
      awaitingSignatureSent: 3,
      certificatesAwaitingSignedForm: 4,
    });
    const worksheetWhere = json(
      (calls.find((c) => c.model === "worksheet")?.args as { where: unknown })
        .where,
    );
    assert.match(
      worksheetWhere,
      /"hiddenAt":null/,
      "hidden worksheets must not be counted",
    );
    assert.match(
      worksheetWhere,
      /unit-1/,
      "the partner's assigned units must narrow the count",
    );
    const raw = calls.find((c) => c.model === "$queryRaw")?.args as {
      sql: string;
      values: unknown[];
    };
    assert.match(
      raw.sql,
      /DISTINCT ON \("worksheetId"\)/,
      "only the LATEST version counts",
    );
    assert.deepEqual(raw.values, [["w1", "w2"]]);
    const certificateWhere = json(
      (
        calls.find((c) => c.model === "completionCertificate")?.args as {
          where: unknown;
        }
      ).where,
    );
    assert.match(certificateWhere, /"none":\{"type":"SIGNED_FORM"\}/);
    assert.match(certificateWhere, /"hiddenAt":null/);
    assert.match(certificateWhere, /customer-1/);
  });

  it("an internal user, who MAY see hidden worksheets on the list page, still does not get them counted", async () => {
    // a partner never sees hidden rows at all, so only the internal viewer
    // can tell "hidden excluded" from "hidden included"
    const { repository, calls } = repositoryWith({
      "worksheet.findMany": [],
      "completionCertificate.count": 0,
    });
    await repository.worksheets(internal);
    const worksheetWhere = json(
      (calls.find((c) => c.model === "worksheet")?.args as { where: unknown })
        .where,
    );
    assert.match(worksheetWhere, /"hiddenAt":null/);
  });

  it("no visible worksheet: no raw query, zeros", async () => {
    const { repository, calls } = repositoryWith({
      "worksheet.findMany": [],
      "completionCertificate.count": 0,
    });
    const data = await repository.worksheets(internal);
    assert.equal(
      data.draft + data.awaitingSignatureNotSent + data.awaitingSignatureSent,
      0,
    );
    assert.ok(!calls.some((c) => c.model === "$queryRaw"));
  });
});

describe("Anyagigények", () => {
  it("counts submitted, not yet received requests and lists the oldest", async () => {
    const { repository, calls } = repositoryWith({
      "materialRequest.count": 2,
      "materialRequest.findMany": [
        {
          id: "m1",
          worksheetId: "w1",
          submittedAt: new Date("2026-09-25T09:00:00Z"),
          worksheet: {
            number: "ML-1",
            customer: { displayName: "Kitalált Kft." },
          },
          _count: { items: 3 },
        },
      ],
    });
    const data = await repository.materialRequests();
    assert.equal(data.openCount, 2);
    assert.equal(data.oldestSubmittedAt, "2026-09-25T09:00:00.000Z");
    assert.equal(data.latest[0]?.itemCount, 3);
    const where = json(
      (calls.find((c) => c.method === "count")?.args as { where: unknown })
        .where,
    );
    assert.equal(where, json({ status: "OPEN", submittedAt: { not: null } }));
  });
});

describe("Karbantartási naptár", () => {
  // 2026-10-01 10:00 UTC = 12:00 in Budapest; the Budapest day starts at 22:00 UTC
  const now = new Date("2026-10-01T10:00:00Z");

  it("splits by Budapest calendar day: overdue, today, the next seven days", async () => {
    const { repository, calls } = repositoryWith({
      "asset.count": (args: {
        where: { AND: [unknown, { nextServiceAt: unknown }] };
      }) => {
        const range = json(args.where.AND[1].nextServiceAt);
        if (
          range.includes('"lt":"2026-09-30T22:00:00.000Z"') &&
          !range.includes("gte")
        )
          return 5;
        if (range.includes('"gte":"2026-09-30T22:00:00.000Z"')) return 1;
        if (range.includes('"gte":"2026-10-01T22:00:00.000Z"')) return 7;
        return -1;
      },
      "asset.findMany": [
        {
          id: "a1",
          name: "Kitalált szivattyú",
          // 23:30 UTC on 30 Sep = 01:30 on 1 Oct in Budapest: TODAY
          nextServiceAt: new Date("2026-09-30T23:30:00Z"),
          customer: null,
          department: { name: "Minta telephely" },
        },
      ],
    });
    const data = await repository.maintenanceCalendar(internal, now);

    assert.deepEqual(
      { overdue: data.overdue, today: data.today, next: data.nextSevenDays },
      { overdue: 5, today: 1, next: 7 },
    );
    assert.deepEqual(data.soonest, [
      {
        assetId: "a1",
        assetName: "Kitalált szivattyú",
        placeName: "Minta telephely",
        nextServiceAt: "2026-10-01",
      },
    ]);
    // the 7-day window ends where the 9th Budapest day starts
    const windowArgs = json(calls.filter((c) => c.method === "count")[2]?.args);
    assert.match(windowArgs, /"lt":"2026-10-08T22:00:00.000Z"/);
    for (const call of calls) {
      const where = json((call.args as { where: unknown }).where);
      assert.match(where, /"status":"ACTIVE"/);
      assert.match(where, /"archivedAt":null/);
    }
  });

  it("applies the partner's asset scope to every query", async () => {
    const { repository, calls } = repositoryWith({
      "asset.count": 0,
      "asset.findMany": [],
    });
    await repository.maintenanceCalendar(customer, now);
    assert.equal(calls.length, 4);
    for (const call of calls) assert.match(json(call.args), /customer-1/);
  });
});
