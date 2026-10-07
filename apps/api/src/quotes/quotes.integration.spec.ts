import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Module, type INestApplication } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { prisma, Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";
import { integrationDatabaseGate } from "../common/integration-database.js";
import { configureApp } from "../app.configuration.js";
import { PermissionGuard } from "../auth/guards/permission.guard.js";
import { QuotesModule } from "./quotes.module.js";
import { QuotesRepository } from "./quotes.repository.js";
const gate = integrationDatabaseGate(process.env);
@Module({
  imports: [QuotesModule],
  providers: [{ provide: APP_GUARD, useClass: PermissionGuard }],
})
class TestQuotesModule {}
describe(
  "Quotes P0: constraints and HTTP API",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = randomUUID(),
      ids: string[] = [];
    let app: INestApplication,
      url: string,
      actorId: string,
      customerId: string,
      quoteId: string,
      versionId: string,
      blockId: string,
      itemId: string,
      productId: string,
      variantId: string,
      snippetId: string;
    const repo = new QuotesRepository();
    let role: AuthenticatedUser["role"] = "ADMIN";
    const user = (): AuthenticatedUser => ({
      id: actorId,
      email: `quote-${suffix}@example.test`,
      displayName: "Quote test",
      role,
      customerId: null,
      supplierId: null,
    });
    const request = (path: string, method = "GET", body?: unknown) =>
      fetch(url + path, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      actorId = (
        await prisma.user.create({
          data: {
            email: `quote-${suffix}@example.test`,
            displayName: "Quote test",
            role: "ADMIN",
          },
        })
      ).id;
      customerId = (
        await prisma.customer.create({
          data: {
            customerNumber: `QP0-${suffix}`,
            displayName: "Quote customer",
            type: "COMPANY",
          },
        })
      ).id;
      const product = await prisma.product.create({
        data: {
          name: `Quote identity ${suffix}`,
          variants: { create: { sku: `QP0-${suffix}` } },
        },
        include: { variants: true },
      });
      productId = product.id;
      variantId = product.variants[0]!.id;
      app = await NestFactory.create(TestQuotesModule, { logger: false });
      app.use(
        (req: { user: AuthenticatedUser }, _res: unknown, next: () => void) => {
          req.user = user();
          next();
        },
      );
      configureApp(app);
      await app.listen(0, "127.0.0.1");
      url = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    });
    it("POST creates a numbered DRAFT with v1, exact fields, event and audit", async () => {
      const res = await request("/quotes", "POST", {
        title: " Aquarium quote ",
        customerId,
        ownerUserId: actorId,
        validUntil: "2026-11-30",
      });
      assert.equal(res.status, 201);
      const dto = await res.json();
      quoteId = dto.id;
      ids.push(quoteId);
      versionId = dto.latestVersion.id;
      assert.match(dto.quoteNumber, /^AJ-\d{4}-\d{4,}$/);
      assert.equal(dto.status, "DRAFT");
      assert.equal(dto.title, "Aquarium quote");
      assert.equal(dto.latestVersion.status, "DRAFT");
      assert.equal(dto.latestVersion.currency, "HUF");
      assert.equal(
        (await (await request(`/quotes/${quoteId}`)).json()).events.length,
        1,
      );
      assert.equal(
        await prisma.auditLog.count({
          where: { entityId: quoteId, action: "quote.created" },
        }),
        1,
      );
      blockId = (
        await prisma.quoteBlock.create({
          data: { versionId, position: 0, kind: "SECTION", title: "Build" },
        })
      ).id;
      itemId = (
        await prisma.quoteItem.create({
          data: {
            versionId,
            blockId,
            position: 0,
            source: "STANDALONE",
            name: "Build",
            quantity: "1.123456",
            unit: "db",
            unitNetPrice: "250000.1234",
            vatRatePercent: "27",
            isOptional: false,
          },
        })
      ).id;
      await prisma.quoteBomItem.create({
        data: {
          versionId,
          quoteItemId: itemId,
          position: 0,
          kind: "CUSTOM",
          customName: "Part",
          quantity: "1",
          unit: "db",
          unitCost: "123456.7890",
          internalNote: "Private",
        },
      });
      await prisma.quoteEvent.create({
        data: {
          quoteId,
          versionId,
          kind: "VERSION_CREATED",
          payload: {
            versionNumber: 1,
            unitCost: 999,
            bom: [{ margin: 12 }],
            supplierId: "private",
          },
        },
      });
    });
    it("GET/list/PATCH redact every cost and event payload for SALES, with schema validation", async () => {
      role = "SALES";
      for (const path of [
        `/quotes/${quoteId}`,
        `/quotes?q=Aquarium&page=1&pageSize=1`,
      ]) {
        const res = await request(path);
        assert.equal(res.status, 200);
        const dto = await res.json();
        assert.doesNotMatch(
          JSON.stringify(dto),
          /"(?:bomItems|unitCost|supplierId|margin|internalNote)"/,
        );
      }
      const res = await request(`/quotes/${quoteId}`, "PATCH", {
        title: "Updated",
        customerId: null,
        ownerUserId: null,
      });
      assert.equal(res.status, 200);
      const dto = await res.json();
      assert.equal(dto.title, "Updated");
      assert.equal(dto.customerId, null);
      assert.equal(dto.ownerUserId, null);
      assert.doesNotMatch(JSON.stringify(dto), /unitCost|bomItems/);
      assert.equal(
        (await request(`/quotes/${quoteId}`, "PATCH", { status: "ACCEPTED" }))
          .status,
        400,
      );
      assert.equal(
        (await request(`/quotes/${quoteId}`, "PATCH", { title: null })).status,
        400,
      );
      assert.equal(
        (
          await request("/quotes", "POST", {
            title: "Bad",
            validUntil: "2026-02-30",
          })
        ).status,
        400,
      );
      assert.equal(
        (await request("/quotes", "POST", { validUntil: "2026-11-30" })).status,
        400,
      );
      assert.equal((await request("/quotes?pageSize=101")).status, 400);
      assert.equal(
        (
          await request(`/quotes/${quoteId}`, "PATCH", {
            customerId: `missing-${suffix}`,
          })
        ).status,
        400,
      );
      assert.equal((await request(`/quotes/missing-${suffix}`)).status, 404);
    });
    it("VIEWER has 403 for all four endpoints; ADMIN sees only explicitly mapped BOM costs", async () => {
      role = "VIEWER";
      for (const [path, method, body] of [
        ["/quotes", "GET", undefined],
        [`/quotes/${quoteId}`, "GET", undefined],
        ["/quotes", "POST", { title: "Denied", validUntil: "2026-11-30" }],
        [`/quotes/${quoteId}`, "PATCH", { title: "Denied" }],
      ] as const)
        assert.equal((await request(path, method, body)).status, 403);
      role = "ADMIN";
      const dto = await (await request(`/quotes/${quoteId}`)).json();
      assert.equal(dto.versions[0].bomItems[0].unitCost, "123456.789");
      assert.ok(
        dto.events.every(
          (e: { payload: unknown }) =>
            !JSON.stringify(e.payload).includes("unitCost"),
        ),
      );
    });
    it("one DRAFT per quote and publication completeness are database constraints", async () => {
      await assert.rejects(
        prisma.quoteVersion.create({
          data: {
            quoteId,
            versionNumber: 2,
            validUntil: new Date("2026-11-30"),
            priceDisplay: "NET",
          },
        }),
        (e) =>
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002",
      );
      for (const status of ["PUBLISHED", "SUPERSEDED"] as const)
        await assert.rejects(
          prisma.quoteVersion.create({
            data: {
              quoteId,
              versionNumber: 3,
              status,
              validUntil: new Date("2026-11-30"),
              priceDisplay: "NET",
            },
          }),
          /QuoteVersion_publication_complete_check/,
        );
      const published = await prisma.quoteVersion.create({
        data: {
          quoteId,
          versionNumber: 2,
          status: "PUBLISHED",
          validUntil: new Date("2026-11-30"),
          priceDisplay: "NET",
          pdfStorageKey: "quotes/test/v2.pdf",
          pdfSha256: "a".repeat(64),
          pageCount: 1,
          publishedAt: new Date(),
        },
      });
      assert.ok(published.id);
      const page = await (await request("/quotes?q=Updated")).json();
      const summary = page.items.find((i: { id: string }) => i.id === quoteId);
      assert.equal(summary.latestVersion.id, published.id);
      assert.equal(summary.latestVersion.versionNumber, 2);
      assert.equal(summary.latestVersion.status, "PUBLISHED");
      assert.ok(!("versions" in summary) && !("events" in summary));
      assert.ok(
        !("blocks" in summary.latestVersion) &&
          !("bomItems" in summary.latestVersion),
      );
      const listRow = (await repo.list(1, 25, "Updated")).items.find(
        (i) => i.id === quoteId,
      )!;
      assert.equal(listRow.versions.length, 1);
      assert.ok(!("events" in listRow) && !("blocks" in listRow.versions[0]!));
      assert.equal(
        (
          await request(`/quotes/${quoteId}`, "PATCH", {
            title: "Must not mutate a published head",
          })
        ).status,
        409,
      );
    });
    it("PRODUCT item/BOM identity, parent version coherence and correct numeric precision", async () => {
      await assert.rejects(
        prisma.quoteItem.create({
          data: {
            versionId,
            blockId,
            position: 1,
            source: "PRODUCT",
            name: "Bad",
            quantity: 1,
            unit: "db",
            unitNetPrice: 100,
            vatRatePercent: 27,
            isOptional: false,
          },
        }),
        /QuoteItem_identity_check/,
      );
      for (const kind of ["PRODUCT", "CUSTOM", "SERVICE"] as const)
        await assert.rejects(
          prisma.quoteBomItem.create({
            data: {
              versionId,
              quoteItemId: itemId,
              position: 1,
              kind,
              quantity: 1,
              unit: "db",
            },
          }),
          /QuoteBomItem_identity_check/,
        );
      for (const source of ["STANDALONE", "BOM"] as const)
        await assert.rejects(
          prisma.quoteItem.create({
            data: {
              versionId,
              blockId,
              position: 10,
              source,
              variantId,
              name: "Ambiguous",
              quantity: 1,
              unit: "db",
              unitNetPrice: 100,
              vatRatePercent: 27,
              isOptional: false,
            },
          }),
          /QuoteItem_identity_check/,
        );
      for (const kind of ["PRODUCT", "CUSTOM", "SERVICE"] as const)
        await assert.rejects(
          prisma.quoteBomItem.create({
            data: {
              versionId,
              quoteItemId: itemId,
              position: 10,
              kind,
              variantId,
              customName: "Ambiguous",
              quantity: 1,
              unit: "db",
            },
          }),
          /QuoteBomItem_identity_check/,
        );
      // Positive controls use the same valid variant: CHECK failures cannot be mistaken for FK failures.
      for (const [position, source] of [
        "PRODUCT",
        "STANDALONE",
        "BOM",
      ].entries())
        await prisma.quoteItem.create({
          data: {
            versionId,
            blockId,
            position: 10 + position,
            source: source as "PRODUCT" | "STANDALONE" | "BOM",
            variantId: source === "PRODUCT" ? variantId : null,
            name: "Valid identity",
            quantity: 1,
            unit: "db",
            unitNetPrice: 100,
            vatRatePercent: 27,
            isOptional: false,
          },
        });
      for (const [position, kind] of ["PRODUCT", "CUSTOM", "SERVICE"].entries())
        await prisma.quoteBomItem.create({
          data: {
            versionId,
            quoteItemId: itemId,
            position: 10 + position,
            kind: kind as "PRODUCT" | "CUSTOM" | "SERVICE",
            variantId: kind === "PRODUCT" ? variantId : null,
            customName: kind === "PRODUCT" ? null : "Valid identity",
            quantity: 1,
            unit: "db",
          },
        });
      const second = await repo.create(
        { title: "Second", validUntil: "2026-11-30" },
        actorId,
      );
      ids.push(second.id);
      await assert.rejects(
        prisma.quoteItem.create({
          data: {
            versionId: second.versions[0]!.id,
            blockId,
            position: 1,
            source: "STANDALONE",
            name: "Crossed",
            quantity: 1,
            unit: "db",
            unitNetPrice: 100,
            vatRatePercent: 27,
            isOptional: false,
          },
        }),
        (e) =>
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2003",
      );
      assert.equal(
        (
          await prisma.quoteItem.findUniqueOrThrow({ where: { id: itemId } })
        ).quantity.toString(),
        "1.123456",
      );
    });
    it("QuoteSnippet PAYMENT iff milestones; JSON null is not a schedule and provenance is a copied snapshot", async () => {
      const content = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Original" }] },
        ],
      };
      for (const data of [
        { kind: "PAYMENT" as const },
        {
          kind: "TEXT" as const,
          milestones: [{ label: "Order", percent: 100 }],
        },
        { kind: "PAYMENT" as const, milestones: Prisma.JsonNull },
        { kind: "TEXT" as const, milestones: Prisma.JsonNull },
      ])
        await assert.rejects(
          prisma.quoteSnippet.create({
            data: { ...data, name: `Invalid ${suffix}`, content },
          }),
          /QuoteSnippet_payment_milestones_check/,
        );
      const snippet = await prisma.quoteSnippet.create({
        data: {
          name: `Snippet ${suffix}`,
          kind: "PAYMENT",
          content,
          milestones: [{ label: "Order", percent: 100 }],
        },
      });
      snippetId = snippet.id;
      await prisma.quoteBlock.update({
        where: { id: blockId },
        data: { sourceSnippetId: snippet.id, content },
      });
      await prisma.quoteSnippet.update({
        where: { id: snippet.id },
        data: { content: { type: "doc" }, archivedAt: new Date() },
      });
      assert.deepEqual(
        (await prisma.quoteBlock.findUniqueOrThrow({ where: { id: blockId } }))
          .content,
        content,
      );
      await prisma.quoteSnippet.delete({ where: { id: snippet.id } });
      snippetId = "";
      assert.equal(
        (await prisma.quoteBlock.findUniqueOrThrow({ where: { id: blockId } }))
          .sourceSnippetId,
        null,
      );
    });
    it("number sequence and creation transaction are safe under concurrent requests and FK failures", async () => {
      const rows = await Promise.all([
        repo.create({ title: "Parallel A", validUntil: "2026-11-30" }, actorId),
        repo.create({ title: "Parallel B", validUntil: "2026-11-30" }, actorId),
      ]);
      ids.push(...rows.map((r) => r.id));
      assert.notEqual(rows[0]!.quoteNumber, rows[1]!.quoteNumber);
      const beforeCount = await prisma.quote.count({
        where: { createdById: actorId },
      });
      await assert.rejects(
        repo.create(
          {
            title: "Rollback",
            validUntil: "2026-11-30",
            customerId: `missing-${suffix}`,
          },
          actorId,
        ),
      );
      assert.equal(
        await prisma.quote.count({ where: { createdById: actorId } }),
        beforeCount,
      );
    });
    after(async () => {
      if (gate.mode !== "run") return;
      if (app) await app.close();
      if (snippetId)
        await prisma.quoteSnippet.deleteMany({ where: { id: snippetId } });
      const versions = (
        await prisma.quoteVersion.findMany({
          where: { quoteId: { in: ids } },
          select: { id: true },
        })
      ).map((v) => v.id);
      await prisma.quoteEvent.deleteMany({ where: { quoteId: { in: ids } } });
      await prisma.quoteBomItem.deleteMany({
        where: { versionId: { in: versions } },
      });
      await prisma.quotePaymentMilestone.deleteMany({
        where: { versionId: { in: versions } },
      });
      await prisma.quoteItem.deleteMany({
        where: { versionId: { in: versions } },
      });
      await prisma.quoteBlock.deleteMany({
        where: { versionId: { in: versions } },
      });
      await prisma.quoteVersion.deleteMany({ where: { quoteId: { in: ids } } });
      await prisma.quote.deleteMany({ where: { id: { in: ids } } });
      if (actorId)
        await prisma.auditLog.deleteMany({ where: { userId: actorId } });
      if (customerId)
        await prisma.customer.deleteMany({ where: { id: customerId } });
      if (variantId)
        await prisma.productVariant.deleteMany({ where: { id: variantId } });
      if (productId)
        await prisma.product.deleteMany({ where: { id: productId } });
      if (actorId) await prisma.user.deleteMany({ where: { id: actorId } });
      assert.equal(await prisma.quote.count({ where: { id: { in: ids } } }), 0);
      await prisma.$disconnect();
    });
  },
);
