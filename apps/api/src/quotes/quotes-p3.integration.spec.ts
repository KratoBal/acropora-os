import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { Global, Module, type INestApplication } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { prisma } from "@acropora/database";
import {
  PERMISSIONS,
  type AuthenticatedUser,
  type Permission,
} from "@acropora/types";
import { integrationDatabaseGate } from "../common/integration-database.js";
import { configureApp } from "../app.configuration.js";
import { PermissionGuard } from "../auth/guards/permission.guard.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import { DOCUMENT_STORE } from "../service-assets/document-store/document-store.provider.js";
import { TicketMailError } from "../notifications/mail/gmail-mail.sender.js";
import type {
  MailSender,
  OutgoingMail,
} from "../notifications/mail/mail.port.js";
import { QuoteMailService } from "./quote-mail.service.js";
import { MARKER_FILE } from "../service-assets/document-store/filesystem-document-store.js";
import { QUOTE_DOCUMENT_ENV } from "./quote-publish.service.js";
import { QuotesModule } from "./quotes.module.js";

const gate = integrationDatabaseGate(process.env);

/** A store of this spec's own: publishing a v2 renders and stores a PDF. */
const storeRoot = mkdtempSync(join(tmpdir(), "quote-p3-store-"));
writeFileSync(join(storeRoot, MARKER_FILE), "");
const storeEnv: NodeJS.ProcessEnv = { DOCUMENT_STORE_ROOT: storeRoot };

@Global()
@Module({
  providers: [{ provide: QUOTE_DOCUMENT_ENV, useValue: storeEnv }],
  exports: [QUOTE_DOCUMENT_ENV],
})
class TestStoreEnvModule {}

@Module({
  imports: [TestStoreEnvModule, QuotesModule],
  providers: [{ provide: APP_GUARD, useClass: PermissionGuard }],
})
class TestQuotesModule {}

const ALL: Permission[] = [
  PERMISSIONS.QUOTES_VIEW,
  PERMISSIONS.QUOTES_MANAGE,
  PERMISSIONS.QUOTES_PUBLISH,
  PERMISSIONS.QUOTES_SEND,
  // P8: the outcome steps close the follow-ups
  PERMISSIONS.QUOTES_ACCEPTANCE_RECORD,
];
const NO_SEND: Permission[] = [
  PERMISSIONS.QUOTES_VIEW,
  PERMISSIONS.QUOTES_MANAGE,
  PERMISSIONS.QUOTES_PUBLISH,
];
const OPEN_GATE = {
  TICKET_MAIL_MODE: "live",
  TICKET_MAIL_QUOTE: "live",
  TICKET_MAIL_REDIRECT_TO: "off",
};

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe(
  "Quotes P3: sending a published version by email",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = randomUUID();
    const quoteIds: string[] = [];
    let app: INestApplication, url: string, actorId: string;
    let perms: Permission[] = ALL;
    /** what the fake sender got; `fail` makes the next send throw */
    const mails: OutgoingMail[] = [];
    let fail: Error | null = null;
    let slow: Promise<void> | null = null;
    let mailService: QuoteMailService;

    const setGate = (environment: Record<string, string>) => {
      (mailService as unknown as { environment: unknown }).environment =
        environment;
    };

    const request = async (
      path: string,
      method = "GET",
      body?: unknown,
      as: Permission[] = ALL,
    ) => {
      perms = as;
      const res = await fetch(url + path, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      perms = ALL;
      const text = await res.text();
      return {
        status: res.status,
        body: text ? (JSON.parse(text) as Json) : null,
      };
    };

    /** A quote with a version published through the real endpoint (stored PDF). */
    async function publishedQuote(title: string) {
      const created = await request("/quotes", "POST", {
        title: `${title} ${suffix}`,
        validUntil: "2099-12-31",
      });
      assert.equal(created.status, 201);
      const quoteId = created.body!.id as string;
      quoteIds.push(quoteId);
      const versionId = created.body!.latestVersion.id as string;
      const block = await prisma.quoteBlock.create({
        data: { versionId, position: 0, kind: "SECTION", title: "Rendszer" },
      });
      await prisma.quoteItem.create({
        data: {
          versionId,
          blockId: block.id,
          position: 0,
          source: "STANDALONE",
          name: "Akvárium",
          quantity: "1",
          unit: "db",
          unitNetPrice: "100000",
          vatRatePercent: "27",
          isOptional: false,
        },
      });
      const published = await request(
        `/quotes/${quoteId}/versions/${versionId}/publish`,
        "POST",
      );
      assert.equal(published.status, 200);
      return { quoteId, versionId };
    }

    const sendBody = (extra: Json = {}) => ({
      requestId: randomUUID(),
      to: ["ugyfel@example.test"],
      subject: "Acropora árajánlat",
      body: "Csatoltan küldjük az ajánlatunkat.",
      ...extra,
    });

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      actorId = (
        await prisma.user.create({
          data: {
            email: `quote-p3-${suffix}@example.test`,
            displayName: "Quote P3 test",
            role: "ADMIN",
          },
        })
      ).id;
      app = await NestFactory.create(TestQuotesModule, { logger: false });
      app.use(
        (req: { user: AuthenticatedUser }, _res: unknown, next: () => void) => {
          req.user = {
            id: actorId,
            email: `quote-p3-${suffix}@example.test`,
            displayName: "Quote P3 test",
            role: "ADMIN",
            customerId: null,
            supplierId: null,
            permissions: perms,
          };
          next();
        },
      );
      configureApp(app);
      await app.listen(0, "127.0.0.1");
      url = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
      mailService = app.get(QuoteMailService, { strict: false });
      const sender: MailSender = {
        send: async (mail) => {
          if (slow) await slow;
          if (fail) {
            const error = fail;
            fail = null;
            throw error;
          }
          mails.push(mail);
        },
      };
      (mailService as unknown as { sender: unknown }).sender = sender;
      setGate(OPEN_GATE);
    });

    it("a send mails the STORED PDF once, records it, and the quote becomes SENT", async () => {
      const q = await publishedQuote("P3 send");
      const before = mails.length;
      const res = await request(
        `/quotes/${q.quoteId}/versions/${q.versionId}/send`,
        "POST",
        sendBody(),
      );
      assert.equal(res.status, 200);
      assert.equal(mails.length, before + 1, "SENT-ONE");
      const mail = mails.at(-1)!;
      const store = app.get<DocumentStore>(DOCUMENT_STORE, { strict: false });
      const version = await prisma.quoteVersion.findUniqueOrThrow({
        where: { id: q.versionId },
      });
      const stored = await store.get({
        owner: "quote",
        ownerId: q.quoteId,
        documentId: version.pdfStorageKey!,
      });
      assert.deepEqual(
        Buffer.from(mail.attachments![0]!.bytes),
        Buffer.from(stored!),
        "STORED-PDF",
      );
      assert.equal(version.sendingSince, null);
      assert.equal(res.body!.status, "SENT");
      assert.equal(res.body!.deliveries[0].outcome, "SENT");
      assert.deepEqual(res.body!.deliveries[0].to, ["ugyfel@example.test"]);
    });

    it("without quotes.send it is refused, and nothing goes out", async () => {
      const q = await publishedQuote("P3 perm");
      const before = mails.length;
      const res = await request(
        `/quotes/${q.quoteId}/versions/${q.versionId}/send`,
        "POST",
        sendBody(),
        NO_SEND,
      );
      assert.equal(res.status, 403);
      assert.equal(mails.length, before);
    });

    it("the same request twice gives one mail and one row; a later retry gets the recorded attempt", async () => {
      const q = await publishedQuote("P3 double");
      const before = mails.length;
      const body = sendBody();
      const same = await Promise.all([
        request(
          `/quotes/${q.quoteId}/versions/${q.versionId}/send`,
          "POST",
          body,
        ),
        request(
          `/quotes/${q.quoteId}/versions/${q.versionId}/send`,
          "POST",
          body,
        ),
      ]);
      // the second either finds the recorded attempt (200) or the running one (409)
      assert.ok(same.some((r) => r.status === 200));
      assert.ok(same.every((r) => r.status === 200 || r.status === 409));
      assert.equal(mails.length, before + 1, "SAME-REQUEST-ONE-MAIL");
      const retry = await request(
        `/quotes/${q.quoteId}/versions/${q.versionId}/send`,
        "POST",
        body,
      );
      assert.equal(retry.status, 200, "RETRY-200");
      assert.equal(mails.length, before + 1);
      assert.equal(
        await prisma.quoteMailDelivery.count({
          where: { quoteVersionId: q.versionId },
        }),
        1,
      );
    });

    it("two different requests at once: one sends, the other is a 409", async () => {
      const r = await publishedQuote("P3 parallel");
      let release: () => void = () => {};
      slow = new Promise((resolve) => (release = resolve));
      const first = request(
        `/quotes/${r.quoteId}/versions/${r.versionId}/send`,
        "POST",
        sendBody(),
      );
      // the first holds the claim while its mail is "in flight"
      await new Promise((resolve) => setTimeout(resolve, 150));
      let second;
      try {
        // bounded: if the claim let it through, it would wait on the same
        // slow sender, and the test would hang instead of failing
        second = await Promise.race([
          request(
            `/quotes/${r.quoteId}/versions/${r.versionId}/send`,
            "POST",
            sendBody(),
          ),
          new Promise<{ status: number; body: null }>((resolve) =>
            setTimeout(() => resolve({ status: -1, body: null }), 3000),
          ),
        ]);
      } finally {
        slow = null;
        release();
      }
      assert.equal(second.status, 409, "PARALLEL-409");
      assert.equal((await first).status, 200);
    });

    it("a sent version goes again only by resend", async () => {
      const q = await publishedQuote("P3 resend");
      await request(
        `/quotes/${q.quoteId}/versions/${q.versionId}/send`,
        "POST",
        sendBody(),
      );
      const again = await request(
        `/quotes/${q.quoteId}/versions/${q.versionId}/send`,
        "POST",
        sendBody(),
      );
      assert.equal(again.status, 409, "SEND-TWICE-409");
      const resent = await request(
        `/quotes/${q.quoteId}/versions/${q.versionId}/resend`,
        "POST",
        sendBody(),
      );
      assert.equal(resent.status, 200);
      assert.equal(resent.body!.deliveries[0].isResend, true);
    });

    /** P8: the quote's follow-up tasks, by their key's kind, oldest key first */
    const followUps = (quoteId: string) =>
      prisma.task.findMany({
        where: {
          source: "QUOTE",
          sourceRef: { startsWith: `quote:${quoteId}:` },
        },
        orderBy: { sourceRef: "asc" },
        select: {
          sourceRef: true,
          status: true,
          dueAt: true,
          assigneeId: true,
        },
      });
    const budapestDay = (offsetDays = 0) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest" }).format(
        new Date(Date.now() + offsetDays * 86_400_000),
      );

    it("P8: a send opens two follow-ups once; a resend adds nothing", async () => {
      const q = await publishedQuote("P8 follow-up");
      const sentAt = Date.now();
      await request(
        `/quotes/${q.quoteId}/versions/${q.versionId}/send`,
        "POST",
        sendBody(),
      );
      await request(
        `/quotes/${q.quoteId}/versions/${q.versionId}/resend`,
        "POST",
        sendBody(),
      );
      const tasks = await followUps(q.quoteId);
      const afterSendDays = (tasks[0]!.dueAt!.getTime() - sentAt) / 86_400_000;
      assert.deepEqual(
        [
          tasks.map((t) => [
            t.sourceRef!.slice(`quote:${q.quoteId}:`.length),
            t.status,
            t.assigneeId === actorId,
          ]),
          afterSendDays > 4.99 && afterSendDays < 5.01,
          tasks[1]!.dueAt!.toISOString().slice(0, 10),
        ],
        [
          [
            ["after-send", "OPEN", true],
            ["before-expiry", "OPEN", true],
          ],
          true,
          "2099-12-28",
        ],
        "FOLLOW-UP-ONCE",
      );
    });

    it("P8: an acceptance and a rejection close the open follow-ups", async () => {
      const accepted = await publishedQuote("P8 accepted");
      const rejected = await publishedQuote("P8 rejected");
      for (const q of [accepted, rejected])
        await request(
          `/quotes/${q.quoteId}/versions/${q.versionId}/send`,
          "POST",
          sendBody(),
        );
      const acceptRes = await request(
        `/quotes/${accepted.quoteId}/acceptances`,
        "POST",
        {
          versionId: accepted.versionId,
          source: "PHONE",
          acceptedAt: budapestDay(),
          acceptedByName: "Teszt Vevő",
        },
      );
      const rejectRes = await request(
        `/quotes/${rejected.quoteId}/reject`,
        "POST",
        { reason: "PRICE" },
      );
      assert.deepEqual(
        [
          acceptRes.status,
          rejectRes.status,
          (await followUps(accepted.quoteId)).map((t) => t.status),
          (await followUps(rejected.quoteId)).map((t) => t.status),
        ],
        [200, 200, ["DONE", "DONE"], ["DONE", "DONE"]],
        "OUTCOME-CLOSES-FOLLOW-UPS",
      );
    });

    it("P8: a postponement closes the open follow-ups and opens one for its day", async () => {
      const q = await publishedQuote("P8 postponed");
      await request(
        `/quotes/${q.quoteId}/versions/${q.versionId}/send`,
        "POST",
        sendBody(),
      );
      const first = budapestDay(20);
      const second = budapestDay(30);
      const statuses = [
        (
          await request(`/quotes/${q.quoteId}/postpone`, "POST", {
            until: first,
          })
        ).status,
        (
          await request(`/quotes/${q.quoteId}/postpone`, "POST", {
            until: second,
          })
        ).status,
      ];
      const tasks = await followUps(q.quoteId);
      assert.deepEqual(
        [
          statuses,
          tasks.map((t) => [
            t.sourceRef!.slice(`quote:${q.quoteId}:`.length),
            t.status,
          ]),
          tasks
            .find((t) => t.status === "OPEN")
            ?.dueAt?.toISOString()
            .slice(0, 10),
        ],
        [
          [200, 200],
          [
            ["after-send", "DONE"],
            ["before-expiry", "DONE"],
            [`postponed:${first}`, "DONE"],
            [`postponed:${second}`, "OPEN"],
          ],
          second,
        ],
        "POSTPONE-FOLLOW-UP",
      );
    });

    it("P8: a sent quote whose version ran out is listed as expired, and stays SENT", async () => {
      const expired = await publishedQuote("P8 expired");
      const valid = await publishedQuote("P8 valid");
      for (const q of [expired, valid])
        await request(
          `/quotes/${q.quoteId}/versions/${q.versionId}/send`,
          "POST",
          sendBody(),
        );
      await prisma.quoteVersion.update({
        where: { id: expired.versionId },
        data: { validUntil: new Date(`${budapestDay(-1)}T00:00:00Z`) },
      });
      const list = await request(
        `/quotes?expired=1&pageSize=100&q=${encodeURIComponent(`P8 `)}`,
      );
      const detail = await request(`/quotes/${expired.quoteId}`);
      const ids = (list.body!.items as Json[])
        .filter((i) => [expired.quoteId, valid.quoteId].includes(i.id))
        .map((i) => [i.id === expired.quoteId, i.isExpired]);
      assert.deepEqual(
        [ids, detail.body!.isExpired, detail.body!.status],
        [[[true, true]], true, "SENT"],
        "EXPIRED-COMPUTED",
      );
    });

    it("a superseded version is not sent, not even by resend", async () => {
      const q = await publishedQuote("P3 superseded");
      await request(
        `/quotes/${q.quoteId}/versions/${q.versionId}/send`,
        "POST",
        sendBody(),
      );
      await prisma.quoteVersion.update({
        where: { id: q.versionId },
        data: { status: "SUPERSEDED" },
      });
      const old = await request(
        `/quotes/${q.quoteId}/versions/${q.versionId}/resend`,
        "POST",
        sendBody(),
      );
      assert.equal(old.status, 409, "SUPERSEDED-409");
    });

    it("a closed gate is a 503 with no row and no claim", async () => {
      const q = await publishedQuote("P3 gate");
      setGate({ ...OPEN_GATE, TICKET_MAIL_QUOTE: "off" });
      let res;
      try {
        res = await request(
          `/quotes/${q.quoteId}/versions/${q.versionId}/send`,
          "POST",
          sendBody(),
        );
      } finally {
        setGate(OPEN_GATE);
      }
      assert.equal(res.status, 503, "GATE-503");
      assert.match(res.body!.message, /TICKET_MAIL_QUOTE/);
      assert.equal(
        await prisma.quoteMailDelivery.count({
          where: { quoteVersionId: q.versionId },
        }),
        0,
      );
      const version = await prisma.quoteVersion.findUniqueOrThrow({
        where: { id: q.versionId },
      });
      assert.equal(version.sendingSince, null);
    });

    it("an unanswered send is recorded as INDETERMINATE, the quote stays a draft, and the claim is released", async () => {
      const q = await publishedQuote("P3 indeterminate");
      fail = new TicketMailError("TICKET_MAIL_SEND_INDETERMINATE");
      const res = await request(
        `/quotes/${q.quoteId}/versions/${q.versionId}/send`,
        "POST",
        sendBody(),
      );
      const row = await prisma.quoteMailDelivery.findFirstOrThrow({
        where: { quoteVersionId: q.versionId },
      });
      assert.equal(row.outcome, "INDETERMINATE", "INDETERMINATE-ROW");
      assert.equal(res.status, 503);
      const quote = await prisma.quote.findUniqueOrThrow({
        where: { id: q.quoteId },
      });
      assert.equal(quote.status, "DRAFT");
      const version = await prisma.quoteVersion.findUniqueOrThrow({
        where: { id: q.versionId },
      });
      assert.equal(version.sendingSince, null);
      assert.equal(
        await prisma.quoteEvent.count({
          where: { quoteId: q.quoteId, kind: "SEND_FAILED" },
        }),
        1,
      );
    });

    it("after an unanswered send, the plain send is refused and only a resend goes", async () => {
      const q = await publishedQuote("P3 unsure then");
      fail = new TicketMailError("TICKET_MAIL_SEND_INDETERMINATE");
      await request(
        `/quotes/${q.quoteId}/versions/${q.versionId}/send`,
        "POST",
        sendBody(),
      );
      // the customer may have it already: a second plain send could mail twice
      const again = await request(
        `/quotes/${q.quoteId}/versions/${q.versionId}/send`,
        "POST",
        sendBody(),
      );
      assert.equal(again.status, 409, "INDETERMINATE-BLOCKS-SEND");
      const resent = await request(
        `/quotes/${q.quoteId}/versions/${q.versionId}/resend`,
        "POST",
        sendBody(),
      );
      assert.equal(resent.status, 200);
    });

    it("a mail sent to the test address says so in its row", async () => {
      const q = await publishedQuote("P3 redirect");
      setGate({ ...OPEN_GATE, TICKET_MAIL_REDIRECT_TO: "proba@example.test" });
      let res;
      try {
        res = await request(
          `/quotes/${q.quoteId}/versions/${q.versionId}/send`,
          "POST",
          sendBody(),
        );
      } finally {
        setGate(OPEN_GATE);
      }
      assert.equal(res.status, 200);
      assert.equal(
        res.body!.deliveries[0].redirectedTo,
        "proba@example.test",
        "REDIRECT-RECORDED",
      );
      const direct = await publishedQuote("P3 direct");
      const plain = await request(
        `/quotes/${direct.quoteId}/versions/${direct.versionId}/send`,
        "POST",
        sendBody(),
      );
      assert.equal(plain.body!.deliveries[0].redirectedTo, null);
    });

    it("the draft fills the template and says whether the version already went out", async () => {
      const q = await publishedQuote("P3 draft");
      const draft = await request(
        `/quotes/${q.quoteId}/versions/${q.versionId}/send-draft`,
      );
      assert.equal(draft.status, 200);
      assert.doesNotMatch(draft.body!.subject + draft.body!.body, /\{\{/);
      assert.equal(draft.body!.alreadySent, false);
      assert.match(draft.body!.fileName, /-v1\.pdf$/);
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await app?.close();
      await prisma.quoteMailDelivery.deleteMany({
        where: { quoteId: { in: quoteIds } },
      });
      // P8: these quotes were also accepted, rejected and postponed
      await prisma.quoteAcceptance.deleteMany({
        where: { quoteId: { in: quoteIds } },
      });
      await prisma.quote.updateMany({
        where: { id: { in: quoteIds } },
        data: {
          status: "DRAFT",
          acceptedVersionId: null,
          closeReason: null,
          postponedUntil: null,
        },
      });
      const versions = (
        await prisma.quoteVersion.findMany({
          where: { quoteId: { in: quoteIds } },
          select: { id: true },
        })
      ).map((x) => x.id);
      await prisma.quoteEvent.deleteMany({
        where: { quoteId: { in: quoteIds } },
      });
      await prisma.quoteItem.deleteMany({
        where: { versionId: { in: versions } },
      });
      await prisma.quoteBlock.deleteMany({
        where: { versionId: { in: versions } },
      });
      await prisma.quotePaymentMilestone.deleteMany({
        where: { versionId: { in: versions } },
      });
      await prisma.quoteVersion.deleteMany({
        where: { quoteId: { in: quoteIds } },
      });
      await prisma.quote.deleteMany({ where: { id: { in: quoteIds } } });
      if (actorId) {
        await prisma.auditLog.deleteMany({ where: { userId: actorId } });
        await prisma.user.deleteMany({ where: { id: actorId } });
      }
      rmSync(storeRoot, { recursive: true, force: true });
      await prisma.$disconnect();
    });
  },
);
