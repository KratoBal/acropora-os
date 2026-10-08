import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { Global, Module, type INestApplication } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { Prisma, prisma } from "@acropora/database";
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

const storeRoot = mkdtempSync(join(tmpdir(), "quote-p6-store-"));
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
  PERMISSIONS.QUOTES_HANDOFF,
];

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const D = (n: number) => new Prisma.Decimal(n);

interface Line {
  kind: "PRODUCT" | "CUSTOM" | "SERVICE";
  variantId?: string;
  name?: string;
  quantity: number;
  optional?: boolean;
  selected?: boolean;
}

describe(
  "Quotes P6: a project started from an accepted quote",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = randomUUID();
    const quoteIds: string[] = [];
    const variantIds: string[] = [];
    const productIds: string[] = [];
    const warehouseIds: string[] = [];
    const extraProjectIds: string[] = [];
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

    async function warehouse(label: string) {
      const row = await prisma.warehouse.create({
        data: { code: `P6-${label}-${suffix}`, name: `P6 ${label}` },
      });
      warehouseIds.push(row.id);
      return row.id;
    }

    /** A product the UNAS catalogue owns, with its stock rows. */
    async function variant(
      label: string,
      stock: Array<[warehouseId: string, onHand: number]>,
      defaultWarehouseId?: string,
    ) {
      const product = await prisma.product.create({
        data: { name: `P6-${suffix} ${label}`, catalogAuthority: "UNAS" },
      });
      productIds.push(product.id);
      const row = await prisma.productVariant.create({
        data: { productId: product.id, sku: `P6-${suffix}-${label}` },
      });
      variantIds.push(row.id);
      for (const [warehouseId, onHand] of stock)
        await prisma.stockItem.create({
          data: { variantId: row.id, warehouseId, onHand: D(onHand) },
        });
      if (defaultWarehouseId)
        await prisma.productExtension.create({
          data: { variantId: row.id, defaultWarehouseId },
        });
      return row.id;
    }

    /** A quote whose published v1 is accepted, straight to the database. */
    async function acceptedQuote(label: string, lines: Line[]) {
      const quote = await prisma.quote.create({
        data: { quoteNumber: `P6-${label}-${suffix}`, title: `P6 ${label}` },
      });
      quoteIds.push(quote.id);
      const version = await prisma.quoteVersion.create({
        data: {
          quoteId: quote.id,
          versionNumber: 1,
          status: "PUBLISHED",
          validUntil: new Date("2099-12-31T00:00:00Z"),
          priceDisplay: "NET",
          pdfStorageKey: "v1-test",
          pdfSha256: "0".repeat(64),
          pageCount: 1,
          publishedAt: new Date(),
        },
      });
      const block = await prisma.quoteBlock.create({
        data: { versionId: version.id, position: 0, kind: "SECTION" },
      });
      const selected: string[] = [];
      const bomIds: string[] = [];
      for (const [position, line] of lines.entries()) {
        const item = await prisma.quoteItem.create({
          data: {
            versionId: version.id,
            blockId: block.id,
            position,
            source: "STANDALONE",
            name: line.name ?? `tétel ${position}`,
            quantity: "1",
            unit: "db",
            unitNetPrice: "1000",
            vatRatePercent: "27",
            isOptional: line.optional ?? false,
          },
        });
        if (line.selected) selected.push(item.id);
        const bom = await prisma.quoteBomItem.create({
          data: {
            versionId: version.id,
            quoteItemId: item.id,
            position: 0,
            kind: line.kind,
            variantId: line.kind === "PRODUCT" ? line.variantId! : null,
            customName: line.kind === "PRODUCT" ? null : line.name!,
            quantity: D(line.quantity),
            unit: "db",
          },
        });
        bomIds.push(bom.id);
      }
      await prisma.quoteAcceptance.create({
        data: {
          quoteId: quote.id,
          quoteVersionId: version.id,
          source: "PHONE",
          acceptedAt: new Date(),
          acceptedByName: "Teszt Vevő",
          selectedOptionalItemIds: selected,
        },
      });
      await prisma.quote.update({
        where: { id: quote.id },
        data: { status: "ACCEPTED", acceptedVersionId: version.id },
      });
      return { quoteId: quote.id, bomIds };
    }

    const preview = (quoteId: string, body: Json = {}) =>
      request(`/quotes/${quoteId}/handoff/preview`, "POST", body);
    const execute = (quoteId: string, planHash: string, body: Json = {}) =>
      request(`/quotes/${quoteId}/handoff`, "POST", { ...body, planHash });

    const reserved = async (variantId: string) =>
      (
        await prisma.stockItem.findMany({
          where: { variantId },
          select: { reserved: true },
        })
      ).reduce((sum, s) => sum.plus(s.reserved), D(0));

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      actorId = (
        await prisma.user.create({
          data: {
            email: `quote-p6-${suffix}@example.test`,
            displayName: "Quote P6 test",
            role: "ADMIN",
          },
        })
      ).id;
      app = await NestFactory.create(TestQuotesModule, { logger: false });
      app.use(
        (req: { user: AuthenticatedUser }, _res: unknown, next: () => void) => {
          req.user = {
            id: actorId,
            email: `quote-p6-${suffix}@example.test`,
            displayName: "Quote P6 test",
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

    it("needed 5, free 3: a hold of 3, the shop's stock, and a request for 2", async () => {
      const a = await warehouse("split");
      const v = await variant("split", [[a, 3]], a);
      const q = await acceptedQuote("split", [
        { kind: "PRODUCT", variantId: v, quantity: 5 },
      ]);
      const plan = await preview(q.quoteId);
      assert.equal(plan.status, 200);
      const res = await execute(q.quoteId, plan.body!.planHash);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const project = await prisma.project.findUniqueOrThrow({
        where: { sourceQuoteId: q.quoteId },
        include: {
          reservations: true,
          materialRequests: { include: { items: true } },
        },
      });
      const outbox = await prisma.unasStockSyncOutbox.findMany({
        where: { variantId: v, sourceProcess: "PROJECT_RESERVATION" },
      });
      const detail = await request(`/quotes/${q.quoteId}`);
      assert.deepEqual(
        [
          res.body!.replayed,
          res.body!.projectId === project.id,
          project.reservations.map((r) => [
            r.origin,
            r.quoteBomItemId === q.bomIds[0],
            r.quantity.toString(),
          ]),
          (await reserved(v)).toString(),
          outbox.map((o) => [o.warehouseId === a, o.targetOnHand.toString()]),
          project.materialRequests.map((m) => [
            m.status,
            m.items.map((i) => [
              i.quantity,
              i.variantId === v,
              i.quoteBomItemId === q.bomIds[0],
            ]),
          ]),
          detail.body!.handoff?.projectNumber === project.projectNumber,
        ],
        [
          false,
          true,
          [["QUOTE_HANDOFF", true, "3"]],
          "3",
          [[true, "0"]],
          [["OPEN", [["2", true, true]]]],
          true,
        ],
        "HANDOFF-SPLIT",
      );
    });

    it("two warehouses of 2 for 5: two holds, a shortage of 1, an outbox row per warehouse", async () => {
      const a = await warehouse("two-a");
      const b = await warehouse("two-b");
      const v = await variant(
        "two",
        [
          [a, 2],
          [b, 2],
        ],
        b,
      );
      const q = await acceptedQuote("two", [
        { kind: "PRODUCT", variantId: v, quantity: 5 },
      ]);
      const plan = await preview(q.quoteId);
      const res = await execute(q.quoteId, plan.body!.planHash);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const holds = await prisma.projectInventoryReservation.findMany({
        where: { projectId: res.body!.projectId },
        select: { warehouseId: true, quantity: true },
        orderBy: { warehouseId: "asc" },
      });
      const outbox = await prisma.unasStockSyncOutbox.count({
        where: { variantId: v, sourceProcess: "PROJECT_RESERVATION" },
      });
      const shortage = await prisma.materialRequestItem.findMany({
        where: { quoteBomItemId: q.bomIds[0] },
        select: { quantity: true },
      });
      assert.deepEqual(
        [
          plan.body!.reservations.map((r: Json) => [
            r.warehouseId === b,
            r.quantity,
          ]),
          holds.length,
          outbox,
          shortage.map((s) => s.quantity),
        ],
        [
          [
            [true, "2"],
            [false, "2"],
          ],
          2,
          2,
          ["1"],
        ],
        "TWO-WAREHOUSES",
      );
    });

    it("two requests at once start one project", async () => {
      const a = await warehouse("double");
      const v = await variant("double", [[a, 1]]);
      const q = await acceptedQuote("double", [
        { kind: "PRODUCT", variantId: v, quantity: 2 },
      ]);
      const plan = await preview(q.quoteId);
      const both = await Promise.all([
        execute(q.quoteId, plan.body!.planHash),
        execute(q.quoteId, plan.body!.planHash),
      ]);
      assert.deepEqual(
        [
          both.map((r) => r.status),
          both[0]!.body!.projectId === both[1]!.body!.projectId,
          both.map((r) => r.body!.replayed).sort(),
          await prisma.project.count({ where: { sourceQuoteId: q.quoteId } }),
          await prisma.projectInventoryReservation.count({
            where: { quoteBomItemId: q.bomIds[0] },
          }),
          await prisma.materialRequest.count({
            where: { projectId: both[0]!.body!.projectId },
          }),
          (await reserved(v)).toString(),
        ],
        [[200, 200], true, [false, true], 1, 1, 1, "1"],
        "DOUBLE-ONE-PROJECT",
      );
    });

    it("stock that moved since the preview is a 409 with the new plan, and nothing is written", async () => {
      const a = await warehouse("stale");
      const v = await variant("stale", [[a, 3]]);
      const q = await acceptedQuote("stale", [
        { kind: "PRODUCT", variantId: v, quantity: 2 },
      ]);
      const plan = await preview(q.quoteId);
      // a sale in between
      await prisma.stockItem.updateMany({
        where: { variantId: v },
        data: { onHand: D(1) },
      });
      const res = await execute(q.quoteId, plan.body!.planHash);
      assert.deepEqual(
        [
          res.status,
          typeof res.body!.plan?.planHash === "string" &&
            res.body!.plan.planHash !== plan.body!.planHash,
          await prisma.project.count({ where: { sourceQuoteId: q.quoteId } }),
          (await reserved(v)).toString(),
        ],
        [409, true, 0, "0"],
        "STALE-PLAN-409",
      );
    });

    it("a failure in the middle rolls back the project, the holds and the outbox", async () => {
      const a = await warehouse("rollback");
      const v = await variant("rollback", [[a, 3]]);
      const q = await acceptedQuote("rollback", [
        { kind: "PRODUCT", variantId: v, quantity: 5 },
      ]);
      // the shortage line's BOM item is taken already: its write fails
      const other = await prisma.project.create({
        data: { projectNumber: `P6-RB-${suffix}`, name: "P6 foglalt" },
      });
      extraProjectIds.push(other.id);
      await prisma.materialRequest.create({
        data: {
          projectId: other.id,
          items: {
            create: {
              position: 0,
              name: "foglalt",
              quantity: "1",
              unit: "db",
              quoteBomItemId: q.bomIds[0],
            },
          },
        },
      });
      const plan = await preview(q.quoteId);
      const res = await execute(q.quoteId, plan.body!.planHash);
      assert.deepEqual(
        [
          res.status >= 400,
          await prisma.project.count({ where: { sourceQuoteId: q.quoteId } }),
          await prisma.quoteProjectHandoff.count({
            where: { quoteId: q.quoteId },
          }),
          (await reserved(v)).toString(),
          await prisma.unasStockSyncOutbox.count({ where: { variantId: v } }),
          await prisma.quoteEvent.count({
            where: { quoteId: q.quoteId, kind: "HANDOFF_EXECUTED" },
          }),
        ],
        [true, 0, 0, "0", 0, 0],
        "ROLLBACK-ALL",
      );
    });

    it("a custom line goes to the request without a product, a service and an unasked option do not", async () => {
      const a = await warehouse("custom");
      const v = await variant("custom", [[a, 5]]);
      const q = await acceptedQuote("custom", [
        { kind: "CUSTOM", name: "Egyedi szűrő", quantity: 2 },
        { kind: "SERVICE", name: "Beüzemelés", quantity: 1 },
        {
          kind: "PRODUCT",
          variantId: v,
          quantity: 1,
          optional: true,
          selected: false,
        },
      ]);
      const plan = await preview(q.quoteId);
      const res = await execute(q.quoteId, plan.body!.planHash);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const items = await prisma.materialRequestItem.findMany({
        where: { materialRequest: { projectId: res.body!.projectId } },
        select: { name: true, quantity: true, variantId: true },
      });
      assert.deepEqual(
        [
          plan.body!.lines.map((l: Json) => [l.kind, l.shortage]),
          items,
          await prisma.projectInventoryReservation.count({
            where: { projectId: res.body!.projectId },
          }),
        ],
        [
          [
            ["CUSTOM", "2"],
            ["SERVICE", "0"],
          ],
          [{ name: "Egyedi szűrő", quantity: "2", variantId: null }],
          0,
        ],
        "CUSTOM-AND-OPTIONAL",
      );
    });

    it("a quote not accepted gives a 409", async () => {
      const q = await acceptedQuote("open", [
        { kind: "SERVICE", name: "Beüzemelés", quantity: 1 },
      ]);
      await prisma.quoteAcceptance.updateMany({
        where: { quoteId: q.quoteId },
        data: { revokedAt: new Date(), revokeReason: "teszt" },
      });
      await prisma.quote.update({
        where: { id: q.quoteId },
        data: { status: "SENT", acceptedVersionId: null },
      });
      const res = await preview(q.quoteId);
      assert.equal(res.status, 409, "NOT-ACCEPTED-409");
    });

    it("without quotes.handoff the preview and the execution are refused", async () => {
      const q = await acceptedQuote("perm", [
        { kind: "SERVICE", name: "Beüzemelés", quantity: 1 },
      ]);
      const viewer = [PERMISSIONS.QUOTES_VIEW, PERMISSIONS.QUOTES_MANAGE];
      const statuses = [
        (
          await request(
            `/quotes/${q.quoteId}/handoff/preview`,
            "POST",
            {},
            viewer,
          )
        ).status,
        (
          await request(
            `/quotes/${q.quoteId}/handoff`,
            "POST",
            { planHash: "0".repeat(64) },
            viewer,
          )
        ).status,
      ];
      assert.deepEqual(statuses, [403, 403], "HANDOFF-403");
    });

    after(async () => {
      if (gate.mode !== "run") return;
      await app?.close();
      const projects = (
        await prisma.project.findMany({
          where: {
            OR: [
              { sourceQuoteId: { in: quoteIds } },
              { id: { in: extraProjectIds } },
            ],
          },
          select: { id: true },
        })
      ).map((p) => p.id);
      await prisma.quoteProjectHandoff.deleteMany({
        where: { quoteId: { in: quoteIds } },
      });
      await prisma.materialRequest.deleteMany({
        where: { projectId: { in: projects } },
      });
      await prisma.projectInventoryReservation.deleteMany({
        where: { projectId: { in: projects } },
      });
      await prisma.unasStockSyncOutbox.deleteMany({
        where: { variantId: { in: variantIds } },
      });
      await prisma.domainEvent.deleteMany({ where: { actorUserId: actorId } });
      await prisma.auditLog.deleteMany({ where: { userId: actorId } });
      await prisma.project.deleteMany({ where: { id: { in: projects } } });
      await prisma.quoteAcceptance.deleteMany({
        where: { quoteId: { in: quoteIds } },
      });
      await prisma.quote.updateMany({
        where: { id: { in: quoteIds } },
        data: { status: "DRAFT", acceptedVersionId: null },
      });
      await prisma.quoteEvent.deleteMany({
        where: { quoteId: { in: quoteIds } },
      });
      const versions = { versionId: { in: [] as string[] } };
      versions.versionId.in = (
        await prisma.quoteVersion.findMany({
          where: { quoteId: { in: quoteIds } },
          select: { id: true },
        })
      ).map((x) => x.id);
      await prisma.quoteBomItem.deleteMany({ where: versions });
      await prisma.quoteItem.deleteMany({ where: versions });
      await prisma.quoteBlock.deleteMany({ where: versions });
      await prisma.quoteVersion.deleteMany({
        where: { quoteId: { in: quoteIds } },
      });
      await prisma.quote.deleteMany({ where: { id: { in: quoteIds } } });
      await prisma.productExtension.deleteMany({
        where: { variantId: { in: variantIds } },
      });
      await prisma.stockItem.deleteMany({
        where: { variantId: { in: variantIds } },
      });
      await prisma.productVariant.deleteMany({
        where: { id: { in: variantIds } },
      });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
      await prisma.warehouse.deleteMany({
        where: { id: { in: warehouseIds } },
      });
      await prisma.user.deleteMany({ where: { id: actorId } });
      rmSync(storeRoot, { recursive: true, force: true });
    });
  },
);
