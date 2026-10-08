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
      await prisma.quote.updateMany({
        where: { id: { in: quoteIds } },
        data: { status: "DRAFT" },
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
