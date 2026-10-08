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
import { MARKER_FILE } from "../service-assets/document-store/filesystem-document-store.js";
import { QUOTE_DOCUMENT_ENV } from "./quote-publish.service.js";
import { QuotesModule } from "./quotes.module.js";

const gate = integrationDatabaseGate(process.env);

/** A store of this spec's own: publishing a v2 renders and stores a PDF. */
const storeRoot = mkdtempSync(join(tmpdir(), "quote-p4a-store-"));
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
  PERMISSIONS.QUOTES_ACCEPTANCE_RECORD,
];
const WRITER: Permission[] = [
  PERMISSIONS.QUOTES_VIEW,
  PERMISSIONS.QUOTES_MANAGE,
];

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Budapest's today and a day relative to it, YYYY-MM-DD. */
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest" }).format(
    new Date(),
  );
const shift = (days: number) =>
  new Date(Date.parse(`${today()}T12:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

describe(
  "Quotes P4a: acceptance by hand, revocation, reject, postpone, cancel",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = randomUUID();
    const quoteIds: string[] = [];
    let app: INestApplication, url: string, actorId: string;
    let perms: Permission[] = ALL;

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

    /** A version with one offered and one optional item, straight to the database. */
    async function addVersion(
      quoteId: string,
      versionNumber: number,
      status: "DRAFT" | "PUBLISHED" | "SUPERSEDED",
      existingId?: string,
    ) {
      const published =
        status === "DRAFT"
          ? {}
          : {
              pdfStorageKey: `v${versionNumber}-test`,
              pdfSha256: "0".repeat(64),
              pageCount: 1,
              publishedAt: new Date(),
            };
      const version = existingId
        ? await prisma.quoteVersion.update({
            where: { id: existingId },
            data: { status, ...published },
          })
        : await prisma.quoteVersion.create({
            data: {
              quoteId,
              versionNumber,
              status,
              validUntil: new Date("2099-12-31T00:00:00Z"),
              priceDisplay: "NET",
              ...published,
            },
          });
      const block = await prisma.quoteBlock.create({
        data: {
          versionId: version.id,
          position: 0,
          kind: "SECTION",
          title: "Rendszer",
        },
      });
      const items = await Promise.all(
        [false, true].map((isOptional, position) =>
          prisma.quoteItem.create({
            data: {
              versionId: version.id,
              blockId: block.id,
              position,
              source: "STANDALONE",
              name: isOptional ? "Opcionális fedőlap" : "Akvárium",
              quantity: "1",
              unit: "db",
              unitNetPrice: "100000",
              vatRatePercent: "27",
              isOptional,
            },
          }),
        ),
      );
      return {
        versionId: version.id,
        offeredId: items[0]!.id,
        optionalId: items[1]!.id,
      };
    }

    /** A quote whose v1 (the draft the creation made) is published. */
    async function publishedQuote(title: string) {
      const created = await request("/quotes", "POST", {
        title: `${title} ${suffix}`,
        validUntil: "2099-12-31",
      });
      assert.equal(created.status, 201);
      const quoteId = created.body!.id as string;
      quoteIds.push(quoteId);
      return {
        quoteId,
        ...(await addVersion(
          quoteId,
          1,
          "PUBLISHED",
          created.body!.latestVersion.id as string,
        )),
      };
    }

    const acceptBody = (versionId: string, extra: Json = {}) => ({
      versionId,
      source: "PHONE",
      acceptedAt: today(),
      acceptedByName: "Kovács Anna",
      ...extra,
    });

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      actorId = (
        await prisma.user.create({
          data: {
            email: `quote-p4a-${suffix}@example.test`,
            displayName: "Quote P4a test",
            role: "ADMIN",
          },
        })
      ).id;
      app = await NestFactory.create(TestQuotesModule, { logger: false });
      app.use(
        (req: { user: AuthenticatedUser }, _res: unknown, next: () => void) => {
          req.user = {
            id: actorId,
            email: `quote-p4a-${suffix}@example.test`,
            displayName: "Quote P4a test",
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
    });

    it("an acceptance records the version, the asked options, an event and a domain event", async () => {
      const q = await publishedQuote("P4a accept");
      const res = await request(
        `/quotes/${q.quoteId}/acceptances`,
        "POST",
        acceptBody(q.versionId, { selectedOptionalItemIds: [q.optionalId] }),
      );
      assert.equal(res.status, 200);
      assert.equal(res.body!.status, "ACCEPTED");
      assert.equal(res.body!.acceptedVersionId, q.versionId);
      assert.deepEqual(res.body!.acceptances[0].selectedOptionalItemIds, [
        q.optionalId,
      ]);
      assert.equal(
        await prisma.quoteEvent.count({
          where: { quoteId: q.quoteId, kind: "ACCEPTED" },
        }),
        1,
      );
      assert.equal(
        await prisma.domainEvent.count({
          where: { aggregateId: q.quoteId, eventType: "quote.accepted" },
        }),
        1,
      );
    });

    it("without quotes.acceptance.record the acceptance is refused", async () => {
      const q = await publishedQuote("P4a perm");
      const res = await request(
        `/quotes/${q.quoteId}/acceptances`,
        "POST",
        acceptBody(q.versionId),
        WRITER,
      );
      assert.equal(res.status, 403, "ACCEPT-403");
    });

    it("a double acceptance gives one row: two people at once, or one retry", async () => {
      const q = await publishedQuote("P4a double");
      const both = await Promise.all([
        request(
          `/quotes/${q.quoteId}/acceptances`,
          "POST",
          acceptBody(q.versionId),
        ),
        request(
          `/quotes/${q.quoteId}/acceptances`,
          "POST",
          acceptBody(q.versionId),
        ),
      ]);
      assert.deepEqual(
        both.map((r) => r.status).sort(),
        [200, 409],
        "ONE-LIVE",
      );
      assert.equal(
        await prisma.quoteAcceptance.count({ where: { quoteId: q.quoteId } }),
        1,
      );

      const r = await publishedQuote("P4a retry");
      const requestId = `retry-${suffix}`;
      const retried = await Promise.all([
        request(
          `/quotes/${r.quoteId}/acceptances`,
          "POST",
          acceptBody(r.versionId, { requestId }),
        ),
        request(
          `/quotes/${r.quoteId}/acceptances`,
          "POST",
          acceptBody(r.versionId, { requestId }),
        ),
      ]);
      assert.deepEqual(
        retried.map((x) => x.status),
        [200, 200],
        "SAME-REQUEST",
      );
      assert.equal(
        await prisma.quoteAcceptance.count({ where: { quoteId: r.quoteId } }),
        1,
      );
    });

    it("a superseded or draft version cannot be accepted, nor another version's option", async () => {
      const q = await publishedQuote("P4a superseded");
      await prisma.quoteVersion.update({
        where: { id: q.versionId },
        data: { status: "SUPERSEDED" },
      });
      const v2 = await addVersion(q.quoteId, 2, "PUBLISHED");
      const old = await request(
        `/quotes/${q.quoteId}/acceptances`,
        "POST",
        acceptBody(q.versionId),
      );
      assert.equal(old.status, 409, "SUPERSEDED-409");
      const foreign = await request(
        `/quotes/${q.quoteId}/acceptances`,
        "POST",
        acceptBody(v2.versionId, { selectedOptionalItemIds: [q.optionalId] }),
      );
      assert.equal(foreign.status, 400, "FOREIGN-OPTION-400");
      const offered = await request(
        `/quotes/${q.quoteId}/acceptances`,
        "POST",
        acceptBody(v2.versionId, { selectedOptionalItemIds: [v2.offeredId] }),
      );
      assert.equal(offered.status, 400);

      const d = await publishedQuote("P4a draft");
      const draft = await addVersion(d.quoteId, 2, "DRAFT");
      const res = await request(
        `/quotes/${d.quoteId}/acceptances`,
        "POST",
        acceptBody(draft.versionId),
      );
      assert.equal(res.status, 409, "DRAFT-409");
      const future = await request(
        `/quotes/${d.quoteId}/acceptances`,
        "POST",
        acceptBody(d.versionId, { acceptedAt: shift(2) }),
      );
      assert.equal(future.status, 400);
    });

    it("after an acceptance no new version is published until it is revoked", async () => {
      const q = await publishedQuote("P4a publish");
      const accepted = await request(
        `/quotes/${q.quoteId}/acceptances`,
        "POST",
        acceptBody(q.versionId),
      );
      assert.equal(accepted.status, 200);
      const v2 = await addVersion(q.quoteId, 2, "DRAFT");
      const blocked = await request(
        `/quotes/${q.quoteId}/versions/${v2.versionId}/publish`,
        "POST",
      );
      assert.equal(blocked.status, 409, "PUBLISH-AFTER-ACCEPT");

      const acceptanceId = accepted.body!.acceptances[0].id as string;
      const noReason = await request(
        `/quotes/${q.quoteId}/acceptances/${acceptanceId}/revoke`,
        "POST",
        {},
      );
      assert.equal(noReason.status, 400);
      const revoked = await request(
        `/quotes/${q.quoteId}/acceptances/${acceptanceId}/revoke`,
        "POST",
        { reason: "Az ügyfél módosítást kért." },
      );
      assert.equal(revoked.status, 200);
      assert.equal(revoked.body!.status, "DRAFT", "REVOKE-STATUS");
      assert.equal(revoked.body!.acceptedVersionId, null);
      assert.ok(revoked.body!.acceptances[0].revokedAt);
      const published = await request(
        `/quotes/${q.quoteId}/versions/${v2.versionId}/publish`,
        "POST",
      );
      assert.equal(published.status, 200);
      // the revoked one stays as history; a new yes is a second row
      const again = await request(
        `/quotes/${q.quoteId}/acceptances`,
        "POST",
        acceptBody(v2.versionId),
      );
      assert.equal(again.status, 200, "ACCEPT-AFTER-REVOKE");
      assert.equal(again.body!.acceptances.length, 2);
    });

    it("after the project started, the acceptance cannot be revoked", async () => {
      const q = await publishedQuote("P4a handoff");
      const accepted = await request(
        `/quotes/${q.quoteId}/acceptances`,
        "POST",
        acceptBody(q.versionId),
      );
      // P6 writes this event; here it stands for the started project
      await prisma.quoteEvent.create({
        data: { quoteId: q.quoteId, kind: "HANDOFF_EXECUTED" },
      });
      const res = await request(
        `/quotes/${q.quoteId}/acceptances/${accepted.body!.acceptances[0].id}/revoke`,
        "POST",
        { reason: "próba" },
      );
      assert.equal(res.status, 409, "HANDOFF-409");
      const quote = await prisma.quote.findUniqueOrThrow({
        where: { id: q.quoteId },
      });
      assert.equal(quote.status, "ACCEPTED");
    });

    it("reject needs a reason and is final; postpone takes a date; an accepted quote must be revoked first", async () => {
      const q = await publishedQuote("P4a reject");
      assert.equal(
        (await request(`/quotes/${q.quoteId}/reject`, "POST", {})).status,
        400,
      );
      const rejected = await request(`/quotes/${q.quoteId}/reject`, "POST", {
        reason: "COMPETITOR",
        note: "Olcsóbb ajánlatot kapott.",
      });
      assert.equal(rejected.status, 200);
      assert.equal(rejected.body!.status, "REJECTED");
      assert.equal(rejected.body!.closeReason, "COMPETITOR");
      const late = await request(
        `/quotes/${q.quoteId}/acceptances`,
        "POST",
        acceptBody(q.versionId),
      );
      assert.equal(late.status, 409, "REJECTED-FINAL");

      const p = await publishedQuote("P4a postpone");
      assert.equal(
        (
          await request(`/quotes/${p.quoteId}/postpone`, "POST", {
            until: shift(-1),
          })
        ).status,
        400,
      );
      const postponed = await request(`/quotes/${p.quoteId}/postpone`, "POST", {
        until: shift(30),
      });
      assert.equal(postponed.body!.status, "POSTPONED");
      assert.equal(postponed.body!.postponedUntil, shift(30));
      const accepted = await request(
        `/quotes/${p.quoteId}/acceptances`,
        "POST",
        acceptBody(p.versionId),
      );
      assert.equal(accepted.status, 200, "ACCEPT-FROM-POSTPONED");
      assert.equal(accepted.body!.postponedUntil, null);
      const cancel = await request(`/quotes/${p.quoteId}/cancel`, "POST", {});
      assert.equal(cancel.status, 409, "CANCEL-ACCEPTED-409");

      const c = await publishedQuote("P4a cancel");
      const cancelled = await request(`/quotes/${c.quoteId}/cancel`, "POST", {
        reason: "PROJECT_CANCELLED",
      });
      assert.equal(cancelled.body!.status, "CANCELLED");
      assert.deepEqual(cancelled.body!.events.at(-1).payload, {
        closeReason: "PROJECT_CANCELLED",
      });
    });

    it("the database itself refuses an accepted quote without its version, and a second live acceptance", async () => {
      const q = await publishedQuote("P4a checks");
      await assert.rejects(
        prisma.quote.update({
          where: { id: q.quoteId },
          data: { status: "ACCEPTED" },
        }),
        /Quote_accepted_version_check/,
        "CHECK-ACCEPTED",
      );
      const live = {
        quoteId: q.quoteId,
        quoteVersionId: q.versionId,
        source: "PHONE" as const,
        acceptedAt: new Date(),
      };
      await prisma.quoteAcceptance.create({ data: live });
      await assert.rejects(
        prisma.quoteAcceptance.create({ data: live }),
        /Unique constraint/,
        "LIVE-INDEX",
      );
      const other = await publishedQuote("P4a foreign version");
      await assert.rejects(
        prisma.quoteAcceptance.create({
          data: { ...live, quoteId: other.quoteId },
        }),
        /Foreign key constraint/,
        "COMPOSITE-FK",
      );
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await app?.close();
      await prisma.quoteAcceptance.deleteMany({
        where: { quoteId: { in: quoteIds } },
      });
      await prisma.quote.updateMany({
        where: { id: { in: quoteIds } },
        data: {
          status: "DRAFT",
          acceptedVersionId: null,
          postponedUntil: null,
          closeReason: null,
        },
      });
      await prisma.domainEvent.deleteMany({
        where: { aggregateId: { in: quoteIds } },
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
