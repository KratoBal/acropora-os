import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { glsXlsx } from "../../testing/gls-xlsx.fixture.js";
import type { GlsGmailClient, GlsGmailMessage } from "./gls-gmail.client.js";
import { GlsGmailSyncService } from "./gls-gmail-sync.service.js";
import { GlsMonthlyReportXlsx } from "./gls-monthly-report.xlsx.js";
import { GlsSettlementRepository } from "./gls-settlement.repository.js";
import { GlsSettlementService } from "./gls-settlement.service.js";

// What only a database can prove about the Gmail pull: a mail is fetched
// once, a file already in counts as a duplicate, a refused file is recorded
// with its reason instead of being retried every hour, and every run leaves
// a row the page can show.
const gate = integrationDatabaseGate(process.env);

const MESSAGE_PREFIX = "gls-sync-it-";
const PARCEL_PREFIX = "9914";
const SUITE_START = new Date();

describe("GLS Gmail sync integration", { skip: gate.mode === "skip" }, () => {
  const suffix = String(Date.now()).slice(-6);
  const id = (n: number) => `${MESSAGE_PREFIX}${suffix}-${n}`;
  const report = glsXlsx({
    WeeklyThu: [
      ["Utalás dátuma: 2026. 09. 03."],
      [
        "Jelentés szám",
        "Csomagszám",
        "Utánvét hivatkozás",
        "Kiszállítási dátum",
        "Utánvét összeg",
        "",
      ],
      [
        "1",
        `${PARCEL_PREFIX}${suffix}1`,
        "2026/00001",
        "2026-08-28",
        700,
        "HUF",
      ],
      [null, null, null, null, 700, "HUF"],
    ],
  });
  const fetched: string[] = [];
  const messages = new Map<string, GlsGmailMessage>([
    [
      id(1),
      {
        id: id(1),
        receivedAt: null,
        subject: "Utánvét",
        xlsx: [{ fileName: "a.xlsx", buffer: report }],
        pdf: [],
      },
    ],
    [
      id(2),
      {
        id: id(2),
        receivedAt: null,
        subject: "Más",
        xlsx: [
          {
            fileName: "arlista.xlsx",
            buffer: glsXlsx({ Arlista: [["Cikkszám"]] }),
          },
        ],
        pdf: [],
      },
    ],
    [
      id(3),
      {
        id: id(3),
        receivedAt: null,
        subject: "Újra",
        xlsx: [{ fileName: "b.xlsx", buffer: report }],
        pdf: [],
      },
    ],
  ]);
  const gmail = {
    listMessageIds: async () => [...messages.keys()],
    getMessage: async (messageId: string) => {
      fetched.push(messageId);
      return messages.get(messageId)!;
    },
  } as unknown as GlsGmailClient;
  // the key the pull checks for, handed in: this spec reads no variable of
  // its own (see integration-spec-inventory.spec.ts)
  const sync = new GlsGmailSyncService(
    gmail,
    new GlsSettlementService(
      new GlsSettlementRepository(),
      new GlsMonthlyReportXlsx(),
    ),
    {
      GMAIL_GLS_CLIENT_ID: "it-client",
      GMAIL_GLS_CLIENT_SECRET: "it-secret",
      GMAIL_GLS_REFRESH_TOKEN: "it-refresh",
    },
  );

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await removeLeftovers();
  });

  after(async () => {
    if (gate.mode !== "run") return;
    await removeLeftovers();
    nincsMaradek([
      {
        nev: "GlsGmailMessage by id prefix",
        darab: await prisma.glsGmailMessage.count({
          where: { gmailMessageId: { startsWith: MESSAGE_PREFIX } },
        }),
      },
      {
        nev: "GlsCodReportLine by parcel prefix",
        darab: await prisma.glsCodReportLine.count({
          where: { parcelNumber: { startsWith: PARCEL_PREFIX } },
        }),
      },
      {
        nev: "GlsSyncRun since the suite started",
        darab: await prisma.glsSyncRun.count({
          where: { startedAt: { gte: SUITE_START } },
        }),
      },
    ]);
  });

  async function removeLeftovers() {
    await prisma.glsGmailMessage.deleteMany({
      where: { gmailMessageId: { startsWith: MESSAGE_PREFIX } },
    });
    const lines = await prisma.glsCodReportLine.findMany({
      where: { parcelNumber: { startsWith: PARCEL_PREFIX } },
      select: { reportId: true },
    });
    await prisma.glsCodReport.deleteMany({
      where: { id: { in: [...new Set(lines.map((line) => line.reportId))] } },
    });
    // integration specs run one at a time: the runs since the start are ours
    await prisma.glsSyncRun.deleteMany({
      where: { startedAt: { gte: SUITE_START } },
    });
  }

  it("reads each new mail once: one document, one duplicate, one refused with its reason", async () => {
    const run = await sync.sync("MANUAL");
    assert.deepEqual(
      [run.status, run.documentsRead, run.duplicateCount, run.failedCount],
      ["APPLIED", 1, 1, 1],
    );
    const recorded = await prisma.glsGmailMessage.findMany({
      where: { gmailMessageId: { startsWith: MESSAGE_PREFIX } },
      orderBy: { gmailMessageId: "asc" },
      select: { gmailMessageId: true, errorCode: true },
    });
    assert.deepEqual(
      recorded.map((message) => message.errorCode),
      [null, "GLS_DOCUMENT_UNKNOWN", null],
    );
  });

  it("does not fetch a known mail again, and the page sees the last run", async () => {
    fetched.length = 0;
    const run = await sync.sync("MANUAL");
    assert.deepEqual(fetched, []);
    assert.equal(run.documentsRead, 0);
    const status = await sync.status();
    assert.equal(status.canRunNow, true);
    assert.equal(status.lastRun?.status, "APPLIED");
  });

  it("keeps the last AUTOMATIC run apart: a button run does not replace it, an unknown one never counts", async () => {
    // A run from before 2026-09-29 has no trigger: it stays unknown, and
    // is never read as automatic.
    await prisma.glsSyncRun.create({
      data: { status: "APPLIED", startedAt: new Date(Date.now() + 60_000) },
    });
    const scheduled = await sync.sync("SCHEDULED");
    assert.equal(scheduled.trigger, "SCHEDULED");
    const manual = await sync.sync("MANUAL");
    assert.equal(manual.trigger, "MANUAL");

    const status = await sync.status();
    assert.equal(status.lastScheduledRun?.trigger, "SCHEDULED");
    assert.equal(status.lastScheduledRun?.startedAt, scheduled.startedAt);
  });
});
