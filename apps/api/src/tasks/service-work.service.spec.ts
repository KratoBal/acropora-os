import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { ServiceWorkRepository } from "./service-work.repository.js";
import { ServiceWorkService } from "./service-work.service.js";

/*
  A FELADATAIM A SZERVIZES SZEMSZÖGÉBŐL (kártya 041a3dd5). MI PIROSÍT:
  - a lista nem a delegálás tábláján keres (`assignees`), vagy rejtett tételt
    is hoz, vagy a nyitott nézet lezárt jegyet kér le;
  - a hibajegy vagy a munkalap rossz csoportba kerül, vagy a lejárt nem áll
    elöl;
  - a munkalap lejáratot kap (feladat-határideje nincs);
  - a változat nélküli munkalap megjelenik;
  - a lezárt nézet nyitottat mutat, vagy a nyitott-szám a nézettel változik;
  - partnerfiók megkapja a listát.
*/
const tech = {
  id: "szerelo",
  email: "szerelo@example.invalid",
  displayName: "Szerelő",
  role: "SERVICE",
  customerId: null,
  supplierId: null,
} as AuthenticatedUser;

// 2026-10-06 18:00 Budapest
const now = new Date("2026-10-06T16:00:00.000Z");

const jobRow = (
  id: string,
  status: string,
  scheduledAt: string | null = null,
  createdAt = "2026-09-01T08:00:00.000Z",
) => ({
  id,
  jobNumber: id,
  status,
  title: `Jegy ${id}`,
  scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
  createdAt: new Date(createdAt),
  customer: { displayName: "Fánk" },
  department: { name: "Biodóm" },
});

const sheetRow = (
  id: string,
  status: string | null,
  sentForSignatureAt: string | null = null,
  lines = 1,
) => ({
  id,
  number: id,
  createdAt: new Date("2026-09-10T08:00:00.000Z"),
  customer: { displayName: "Fánk" },
  department: { name: "PP Üzemeltetés" },
  versions: status
    ? [
        {
          status,
          sentForSignatureAt: sentForSignatureAt
            ? new Date(sentForSignatureAt)
            : null,
          _count: { lines },
        },
      ]
    : [],
});

const service = (rows: {
  open?: unknown[];
  closed?: unknown[];
  sheets?: unknown[];
}) => {
  const asked: { closed: boolean }[] = [];
  const repository = {
    jobs: async (_userId: string, closed: boolean) => {
      asked.push({ closed });
      return (closed ? rows.closed : rows.open) ?? [];
    },
    worksheets: async () => rows.sheets ?? [],
  };
  return {
    asked,
    service: new ServiceWorkService(repository as never),
  };
};

describe("the service view of Feladataim", () => {
  it("sorts the open jobs and sheets into yours and someone else's, as the blueprint does", async () => {
    const { service: s } = service({
      open: [
        jobRow("HJ-besorolva", "TRIAGED"),
        jobRow("HJ-alkatresz", "WAITING_FOR_PARTS"),
        jobRow("HJ-jovobeli", "SCHEDULED", "2026-10-09T08:00:00.000Z"),
        jobRow("HJ-ma", "SCHEDULED", "2026-10-06T07:00:00.000Z"),
      ],
      sheets: [
        sheetRow("M-piszkozat", "DRAFT"),
        sheetRow("M-helyben", "AWAITING_SIGNATURE"),
        sheetRow("M-tavoli", "AWAITING_SIGNATURE", "2026-10-05T10:00:00.000Z"),
        sheetRow("M-alairt", "SIGNED"),
        sheetRow("M-valtozat-nelkul", null),
      ],
    });
    const result = await s.list(tech, "OPEN", now);
    assert.deepEqual(result.mine.map((i) => i.id).sort(), [
      "HJ-besorolva",
      "HJ-ma",
      "M-helyben",
      "M-piszkozat",
    ]);
    assert.deepEqual(result.others.map((i) => i.id).sort(), [
      "HJ-alkatresz",
      "HJ-jovobeli",
      "M-tavoli",
    ]);
    assert.deepEqual(result.closed, []);
    assert.equal(result.openCount, 7);
  });

  it("an overdue job stands first in its group with its date; a sheet never gets one", async () => {
    const { service: s } = service({
      open: [
        jobRow("HJ-uj", "NEW", null, "2026-08-01T08:00:00.000Z"),
        jobRow(
          "HJ-lejart",
          "SCHEDULED",
          "2026-08-31T07:00:00.000Z",
          "2026-09-20T08:00:00.000Z",
        ),
      ],
      sheets: [sheetRow("M-piszkozat", "DRAFT")],
    });
    const result = await s.list(tech, "OPEN", now);
    assert.equal(result.mine[0]!.id, "HJ-lejart");
    assert.equal(result.mine[0]!.overdueSince, "2026-08-31T07:00:00.000Z");
    assert.equal(
      result.mine.find((i) => i.id === "M-piszkozat")!.overdueSince,
      null,
    );
    assert.equal(result.mine.find((i) => i.id === "HJ-uj")!.overdueSince, null);
  });

  it("the sheet carries its display status; the job its own status and title", async () => {
    const { service: s } = service({
      open: [jobRow("HJ-1", "IN_PROGRESS")],
      sheets: [sheetRow("M-ures", "DRAFT", null, 0)],
    });
    const result = await s.list(tech, "OPEN", now);
    const sheet = result.mine.find((i) => i.kind === "WORKSHEET")!;
    const job = result.mine.find((i) => i.kind === "SERVICE_JOB")!;
    assert.equal(sheet.status, "NEW");
    assert.equal(sheet.unitName, "PP Üzemeltetés");
    assert.equal(job.status, "IN_PROGRESS");
    assert.equal(job.title, "Jegy HJ-1");
  });

  it("the open view asks no closed jobs; the closed view shows only the closed, with the open count unchanged", async () => {
    const open = service({
      open: [jobRow("HJ-nyitott", "NEW")],
      closed: [jobRow("HJ-kesz", "COMPLETED")],
      sheets: [sheetRow("M-alairt", "SIGNED")],
    });
    await open.service.list(tech, "OPEN", now);
    assert.deepEqual(open.asked, [{ closed: false }]);

    const closed = service({
      open: [jobRow("HJ-nyitott", "NEW")],
      closed: [jobRow("HJ-kesz", "COMPLETED")],
      sheets: [sheetRow("M-alairt", "SIGNED")],
    });
    const result = await closed.service.list(tech, "CLOSED", now);
    assert.deepEqual(result.mine, []);
    assert.deepEqual(result.others, []);
    assert.deepEqual(result.closed.map((i) => i.id).sort(), [
      "HJ-kesz",
      "M-alairt",
    ]);
    assert.equal(result.openCount, 1);
  });

  it("a partner account gets no list", async () => {
    const { service: s, asked } = service({});
    await assert.rejects(
      s.list({ ...tech, customerId: "cust1" }, "OPEN", now),
      (error: unknown) =>
        (error as { getStatus?: () => number }).getStatus?.() === 403,
    );
    assert.deepEqual(asked, []);
  });
});

describe("the service view's queries", () => {
  const original = {
    jobs: prisma.serviceJob.findMany,
    sheets: prisma.worksheet.findMany,
  };
  const asked: { op: string; args: { where?: unknown } }[] = [];
  beforeEach(() => {
    asked.length = 0;
    prisma.serviceJob.findMany = (async (args: { where?: unknown }) => {
      asked.push({ op: "jobs", args });
      return [];
    }) as unknown as typeof original.jobs;
    prisma.worksheet.findMany = (async (args: { where?: unknown }) => {
      asked.push({ op: "sheets", args });
      return [];
    }) as unknown as typeof original.sheets;
  });
  afterEach(() => {
    prisma.serviceJob.findMany = original.jobs;
    prisma.worksheet.findMany = original.sheets;
  });

  it("asks by the delegation tables, never the dead assignedUserId, and never a hidden item", async () => {
    const repository = new ServiceWorkRepository();
    await repository.jobs("szerelo", false);
    await repository.jobs("szerelo", true);
    await repository.worksheets("szerelo");
    assert.deepEqual(
      asked.map((a) => a.args.where),
      [
        {
          hiddenAt: null,
          assignees: { some: { userId: "szerelo" } },
          status: { notIn: ["COMPLETED", "CANCELLED"] },
        },
        {
          hiddenAt: null,
          assignees: { some: { userId: "szerelo" } },
          status: { in: ["COMPLETED", "CANCELLED"] },
        },
        { hiddenAt: null, assignees: { some: { userId: "szerelo" } } },
      ],
    );
  });
});
