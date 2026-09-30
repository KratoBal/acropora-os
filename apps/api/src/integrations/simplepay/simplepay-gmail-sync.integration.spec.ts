import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import {
  SimplePayGmailError,
  type SimplePayGmailClient,
  type SimplePayGmailMessage,
} from "./simplepay-gmail.client.js";
import { SimplePayGmailSyncService } from "./simplepay-gmail-sync.service.js";
import { SimplePayMonthlyReportXlsx } from "./simplepay-monthly-report.xlsx.js";
import { SimplePaySettlementRepository } from "./simplepay-settlement.repository.js";
import { SimplePaySettlementService } from "./simplepay-settlement.service.js";

// What only a database can prove about the pull: a report mail is stored with
// its mail's period; a SimplePay mail that is not a weekly report is kept out
// and never fetched again; a mail that could not be fetched is tried again;
// a second run does not store anything twice; every run is recorded.
const gate = integrationDatabaseGate(process.env);

const PREFIX = "spgm-it-";
const SUITE_START = new Date();

const HEADER =
  "Tranzakció státusz;Fizetés típusa;SimplePay tranzakció ID;Kereskedői tranzakció ID;Tranzakció dátuma;Teljesítés dátuma;Devizanem;Tranzakciós jutalék;Bankközi díj / Kedvezményalap díj;Kártyatársasági díj és ONUS tranzakció feldolgozási díj / Rendszerhasználati díj;Kereskedői díj;Tranzakció összege;Jutalékkal csökkentett összeg;Partner;Fiók név;Fiók URL;Vásárló;E-mail cím;";

describe(
  "SimplePay Gmail pull integration",
  { skip: gate.mode === "skip" },
  () => {
    const s5 = String(Date.now()).slice(-5);
    const id = (n: number) => `${PREFIX}${s5}-${n}`;
    const csv = Buffer.from(
      [
        HEADER,
        `COMPLETED;Bankkártyás fizetés;8${s5}1;111T9${s5};2026-09-22 14:14:26;2026-09-22 14:16:32;HUF;100,00;10,00;20,00;70,00;1000,00;900,00;X;X;https://example.com;Kitalalt Vevo;vevo@example.com;`,
      ].join("\r\n") + "\r\n",
      "utf8",
    );
    const mail = (
      n: number,
      extra: Partial<SimplePayGmailMessage>,
    ): SimplePayGmailMessage => ({
      id: id(n),
      receivedAt: new Date("2026-09-30T04:59:09Z"),
      subject: "SimplePay - Forgalmi kimutatás",
      sender: "SimplePay <noreply@simplepay.hu>",
      csv: [{ fileName: `${PREFIX}report_20260930.csv`, buffer: csv }],
      body: "2026.09.21 - 2026.09.27 forgalmi időszakról Tranzakciók száma: 1 Tranzakciók végösszege: 1 000 HUF Tranzakciós jutalék: 100 HUF ",
      ...extra,
    });
    const messages = new Map<string, SimplePayGmailMessage | "unreachable">([
      [id(1), mail(1, {})],
      [id(2), mail(2, { subject: "SimplePay - Sikeres fizetés" })],
      [id(3), "unreachable"],
    ]);
    const fetched: string[] = [];
    const client = {
      listMessageIds: async () => [...messages.keys()],
      getMessage: async (messageId: string) => {
        fetched.push(messageId);
        const message = messages.get(messageId)!;
        if (message === "unreachable")
          throw new SimplePayGmailError("SIMPLEPAY_GMAIL_HTTP_500");
        return message;
      },
    } as unknown as SimplePayGmailClient;
    const sync = new SimplePayGmailSyncService(
      client,
      new SimplePaySettlementService(
        new SimplePaySettlementRepository(),
        new SimplePayMonthlyReportXlsx(),
      ),
      {
        GMAIL_SIMPLEPAY_CLIENT_ID: "it-client",
        GMAIL_SIMPLEPAY_CLIENT_SECRET: "it-secret",
        GMAIL_SIMPLEPAY_REFRESH_TOKEN: "it-refresh",
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
          nev: "SimplePayGmailMessage by id prefix",
          darab: await prisma.simplePayGmailMessage.count({
            where: { gmailMessageId: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "SimplePayReport by file prefix",
          darab: await prisma.simplePayReport.count({
            where: { fileName: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "SimplePaySyncRun since the suite started",
          darab: await prisma.simplePaySyncRun.count({
            where: { startedAt: { gte: SUITE_START } },
          }),
        },
      ]);
    });

    async function removeLeftovers() {
      await prisma.simplePayReport.deleteMany({
        where: { fileName: { startsWith: PREFIX } },
      });
      await prisma.simplePayGmailMessage.deleteMany({
        where: { gmailMessageId: { startsWith: PREFIX } },
      });
      // integration specs run one at a time: the runs since the start are ours
      await prisma.simplePaySyncRun.deleteMany({
        where: { startedAt: { gte: SUITE_START } },
      });
    }

    it("stores the report with its mail's period, keeps another SimplePay mail out, and retries the unreachable one", async () => {
      const run = await sync.sync("MANUAL");
      assert.deepEqual(
        [
          run.status,
          run.trigger,
          run.messagesSeen,
          run.documentsRead,
          run.failedCount,
        ],
        ["APPLIED", "MANUAL", 3, 1, 1],
      );
      const report = await prisma.simplePayReport.findFirstOrThrow({
        where: { fileName: { startsWith: PREFIX } },
        select: {
          gmailMessageId: true,
          periodStart: true,
          periodEnd: true,
          warnings: true,
          lineCount: true,
        },
      });
      assert.deepEqual(
        [
          report.gmailMessageId,
          report.periodStart?.toISOString().slice(0, 10),
          report.periodEnd?.toISOString().slice(0, 10),
          report.warnings,
          report.lineCount,
        ],
        [id(1), "2026-09-21", "2026-09-27", [], 1],
      );
      const recorded = await prisma.simplePayGmailMessage.findMany({
        where: { gmailMessageId: { startsWith: PREFIX } },
        orderBy: { gmailMessageId: "asc" },
        select: { gmailMessageId: true, errorCode: true, documentCount: true },
      });
      assert.deepEqual(recorded, [
        { gmailMessageId: id(1), errorCode: null, documentCount: 1 },
        {
          gmailMessageId: id(2),
          errorCode: "SIMPLEPAY_GMAIL_NOT_A_REPORT",
          documentCount: 0,
        },
      ]);
    });

    it("a second run fetches only the mail that was not reached, and stores nothing twice", async () => {
      fetched.length = 0;
      const run = await sync.sync("SCHEDULED");
      assert.deepEqual(fetched, [id(3)]);
      assert.deepEqual([run.documentsRead, run.failedCount], [0, 1]);
      assert.equal(
        await prisma.simplePayReport.count({
          where: { fileName: { startsWith: PREFIX } },
        }),
        1,
      );
      const status = await sync.status();
      assert.deepEqual(
        [status.canRunNow, status.lastScheduledRun?.trigger],
        [true, "SCHEDULED"],
      );
    });
  },
);
