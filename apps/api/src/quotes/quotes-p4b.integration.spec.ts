import "reflect-metadata";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
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
import { MARKER_FILE } from "../service-assets/document-store/filesystem-document-store.js";
import { QUOTE_DOCUMENT_ENV } from "./quote-publish.service.js";
import { QuotesModule } from "./quotes.module.js";

const gate = integrationDatabaseGate(process.env);

/** A store of this spec's own: publishing a v2 renders and stores a PDF. */
const storeRoot = mkdtempSync(join(tmpdir(), "quote-p4b-store-"));
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
  PERMISSIONS.QUOTES_ACCEPTANCE_LINK_MANAGE,
];
const WRITER: Permission[] = [
  PERMISSIONS.QUOTES_VIEW,
  PERMISSIONS.QUOTES_MANAGE,
];

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Budapest's today, YYYY-MM-DD. */
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest" }).format(
    new Date(),
  );

describe(
  "Quotes P4b: the public acceptance link",
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
      caller = `10.0.0.${Math.floor(Math.random() * 250) + 1}`,
    ) => {
      perms = as;
      const res = await fetch(url + path, {
        method,
        // each call its own address, unless a test names one (the limiter)
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": caller,
        },
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

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      actorId = (
        await prisma.user.create({
          data: {
            email: `quote-p4b-${suffix}@example.test`,
            displayName: "Quote P4b test",
            role: "ADMIN",
          },
        })
      ).id;
      app = await NestFactory.create(TestQuotesModule, { logger: false });
      app.use(
        (req: { user: AuthenticatedUser }, _res: unknown, next: () => void) => {
          req.user = {
            id: actorId,
            email: `quote-p4b-${suffix}@example.test`,
            displayName: "Quote P4b test",
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

    /** A published quote with a live link: its ids and the token. */
    async function linked(title: string) {
      const q = await publishedQuote(title);
      const issued = await request(
        `/quotes/${q.quoteId}/versions/${q.versionId}/acceptance-link`,
        "POST",
      );
      assert.equal(issued.status, 201);
      const token = (issued.body!.path as string).replace("/ajanlat/", "");
      return { ...q, token, linkId: issued.body!.id as string };
    }

    it("a link is issued once with its token, and only the token's hash is kept", async () => {
      const q = await linked("P4b issue");
      const row = await prisma.quoteAcceptanceLink.findUniqueOrThrow({
        where: { id: q.linkId },
      });
      assert.equal(
        row.tokenHash,
        createHash("sha256").update(q.token).digest("hex"),
      );
      assert.notEqual(row.tokenHash, q.token);
      const current = await request(
        `/quotes/${q.quoteId}/versions/${q.versionId}/acceptance-link`,
      );
      assert.equal(current.body!.link.id, q.linkId);
      assert.equal(JSON.stringify(current.body).includes(q.token), false);
      // without the link permission it is not issued
      const refused = await request(
        `/quotes/${q.quoteId}/versions/${q.versionId}/acceptance-link`,
        "POST",
        undefined,
        WRITER,
      );
      assert.equal(refused.status, 403, "LINK-ISSUE-403");
    });

    it("the public page carries only the allowed keys", async () => {
      const q = await linked("P4b keys");
      const page = await request(`/public/quotes/${q.token}`);
      assert.equal(page.status, 200);
      assert.deepEqual(
        Object.keys(page.body!).sort(),
        [
          "acceptedAt",
          "currency",
          "customerName",
          "items",
          "netTotal",
          "optionalNetTotal",
          "priceDisplay",
          "quoteNumber",
          "state",
          "title",
          "validUntil",
          "versionNumber",
        ],
        "PUBLIC-KEYS",
      );
      assert.deepEqual(Object.keys(page.body!.items[0]).sort(), [
        "id",
        "isOptional",
        "name",
        "netTotal",
        "quantity",
        "unit",
        "unitNetPrice",
        "vatRatePercent",
      ]);
      // only the optional item's id is shown
      assert.deepEqual(
        page.body!.items.map((item: Json) => item.id),
        [null, q.optionalId],
      );
    });

    it("an unknown, a revoked and an expired link are the same 404", async () => {
      const unknown = await request(`/public/quotes/${"x".repeat(43)}`);
      const revoked = await linked("P4b revoked");
      const del = await request(
        `/quotes/${revoked.quoteId}/versions/${revoked.versionId}/acceptance-link`,
        "DELETE",
      );
      assert.equal(del.status, 204);
      const expired = await linked("P4b expired");
      await prisma.quoteAcceptanceLink.update({
        where: { id: expired.linkId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const answers = [
        unknown,
        await request(`/public/quotes/${revoked.token}`),
        await request(`/public/quotes/${expired.token}`),
      ].map((r) => [r.status, r.body!.message]);
      assert.deepEqual(
        answers,
        [
          [404, "Ez az ajánlat-link nem érvényes."],
          [404, "Ez az ajánlat-link nem érvényes."],
          [404, "Ez az ajánlat-link nem érvényes."],
        ],
        "NOT-FOUND-SAME",
      );
    });

    it("the first opening is one LINK_OPENED event, however many follow", async () => {
      const q = await linked("P4b opened");
      await Promise.all([
        request(`/public/quotes/${q.token}`),
        request(`/public/quotes/${q.token}`),
      ]);
      await request(`/public/quotes/${q.token}`);
      assert.equal(
        await prisma.quoteEvent.count({
          where: { quoteId: q.quoteId, kind: "LINK_OPENED" },
        }),
        1,
        "OPENED-ONCE",
      );
    });

    it("the yes on the link gives the state a recorded yes gives", async () => {
      const q = await linked("P4b accept");
      const res = await request(`/public/quotes/${q.token}/accept`, "POST", {
        name: "Kovács Anna",
        email: "anna@example.test",
        selectedOptionalItemIds: [q.optionalId],
      });
      assert.equal(res.status, 200);
      assert.equal(res.body!.state, "ACCEPTED");
      const quote = await prisma.quote.findUniqueOrThrow({
        where: { id: q.quoteId },
        include: { acceptances: true },
      });
      const events = await prisma.quoteEvent.count({
        where: { quoteId: q.quoteId, kind: "ACCEPTED" },
      });
      const domain = await prisma.domainEvent.count({
        where: { aggregateId: q.quoteId, eventType: "quote.accepted" },
      });
      assert.deepEqual(
        [
          quote.status,
          quote.acceptedVersionId,
          quote.acceptances.length,
          quote.acceptances[0]!.source,
          quote.acceptances[0]!.acceptanceLinkId,
          quote.acceptances[0]!.selectedOptionalItemIds,
          quote.acceptances[0]!.recordedByUserId,
          events,
          domain,
        ],
        [
          "ACCEPTED",
          q.versionId,
          1,
          "PUBLIC_LINK",
          q.linkId,
          [q.optionalId],
          null,
          1,
          1,
        ],
        "LINK-ACCEPT-SAME-STATE",
      );
      // the day of the yes is Budapest's today
      assert.equal(
        quote.acceptances[0]!.acceptedAt.toISOString().slice(0, 10),
        today(),
      );
      // a second yes on an accepted quote is refused
      const again = await request(`/public/quotes/${q.token}/accept`, "POST", {
        name: "Kovács Anna",
      });
      assert.equal(again.status, 409);
    });

    it("a link revoked after the page opened accepts nothing", async () => {
      const q = await linked("P4b late");
      await request(`/public/quotes/${q.token}`);
      await request(
        `/quotes/${q.quoteId}/versions/${q.versionId}/acceptance-link`,
        "DELETE",
      );
      const res = await request(`/public/quotes/${q.token}/accept`, "POST", {
        name: "Kovács Anna",
      });
      assert.equal(res.status, 404, "REVOKED-ACCEPT-404");
      assert.equal(
        (await prisma.quote.findUniqueOrThrow({ where: { id: q.quoteId } }))
          .status,
        "DRAFT",
      );
    });

    it("the link serves the version's stored PDF", async () => {
      const q = await linked("P4b pdf");
      const store = app.get<DocumentStore>(DOCUMENT_STORE, { strict: false });
      await store.put(
        { owner: "quote", ownerId: q.quoteId, documentId: "v1-test" },
        new TextEncoder().encode("%PDF-1.4 p4b"),
      );
      const res = await fetch(`${url}/public/quotes/${q.token}/pdf`, {
        headers: { "X-Forwarded-For": "10.1.0.1" },
      });
      assert.deepEqual(
        [res.status, res.headers.get("content-type"), await res.text()],
        [200, "application/pdf", "%PDF-1.4 p4b"],
        "LINK-PDF",
      );
    });

    it("one caller's yes is limited: the sixth in a minute is a 429", async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 6; i += 1)
        statuses.push(
          (
            await request(
              `/public/quotes/${"y".repeat(43)}/accept`,
              "POST",
              { name: "Kovács Anna" },
              ALL,
              "203.0.113.77",
            )
          ).status,
        );
      assert.deepEqual(statuses, [404, 404, 404, 404, 404, 429], "RATE-429");
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await app?.close();
      await prisma.quoteAcceptance.deleteMany({
        where: { quoteId: { in: quoteIds } },
      });
      await prisma.quoteAcceptanceLink.deleteMany({
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
