import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Module, type INestApplication } from "@nestjs/common";
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
import { QuotesModule } from "./quotes.module.js";

const gate = integrationDatabaseGate(process.env);

@Module({
  imports: [QuotesModule],
  providers: [{ provide: APP_GUARD, useClass: PermissionGuard }],
})
class TestQuotesModule {}

const FULL: Permission[] = [
  PERMISSIONS.QUOTES_VIEW,
  PERMISSIONS.QUOTES_MANAGE,
  PERMISSIONS.QUOTES_COSTS_VIEW,
  PERMISSIONS.QUOTES_TEMPLATES_MANAGE,
  PERMISSIONS.PRODUCTS_MANAGE,
];
/** a quote writer without costs, templates or catalog rights */
const WRITER: Permission[] = [
  PERMISSIONS.QUOTES_VIEW,
  PERMISSIONS.QUOTES_MANAGE,
];
const VIEWER: Permission[] = [PERMISSIONS.QUOTES_VIEW];

const COST_KEY = /cost|supplier|internalnote|margin/i;
const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe(
  "Quotes P1: editor, BOM, costing, snippets and templates over HTTP",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = randomUUID();
    const quoteIds: string[] = [];
    const snippetIds: string[] = [];
    const templateIds: string[] = [];
    const productIds: string[] = [];
    let app: INestApplication, url: string;
    let actorId: string, supplierId: string, warehouseId: string;
    let variantId: string, fallbackVariantId: string;
    let lineB: string;
    let quoteId: string, versionId: string, blockId: string;
    let productItemId: string, bomItemId: string;
    let customBomId: string, spareCustomBomId: string;
    let perms: Permission[] = FULL;

    const user = (): AuthenticatedUser => ({
      id: actorId,
      email: `quote-p1-${suffix}@example.test`,
      displayName: "Quote P1 test",
      role: "ADMIN",
      customerId: null,
      supplierId: null,
      permissions: perms,
    });
    const request = async (
      path: string,
      method = "GET",
      body?: unknown,
      as: Permission[] = FULL,
    ) => {
      perms = as;
      const res = await fetch(url + path, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      perms = FULL;
      return { status: res.status, body: (await res.json()) as Json };
    };
    const v = (path: string) =>
      `/quotes/${quoteId}/versions/${versionId}${path}`;
    const version = (dto: Json, id = versionId) =>
      (dto.versions as Json[]).find((x) => x.id === id)!;
    const invoice = async (
      label: string,
      over: {
        currency?: string;
        exchangeRate?: string | null;
        status?: "POSTED" | "CANCELLED";
        invoiceDate: string;
        lines: Array<{
          variantId: string;
          unitNet: string;
          discountPercent?: string;
        }>;
      },
    ) =>
      prisma.purchaseInvoice.create({
        data: {
          documentNumber: `QP1-${label}-${suffix}`,
          supplierInvoiceNumber: `QP1-${label}-${suffix}`,
          source: "HU_MANUAL",
          status: over.status ?? "POSTED",
          supplierId,
          warehouseId,
          currency: over.currency ?? "HUF",
          exchangeRate: over.exchangeRate ?? null,
          invoiceDate: new Date(`${over.invoiceDate}T00:00:00Z`),
          lines: {
            create: over.lines.map((l) => ({
              variantId: l.variantId,
              orderedQuantity: "1",
              actualQuantity: "1",
              unit: "db",
              unitNet: l.unitNet,
              discountPercent: l.discountPercent ?? null,
            })),
          },
        },
        include: { lines: true },
      });

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      actorId = (
        await prisma.user.create({
          data: {
            email: `quote-p1-${suffix}@example.test`,
            displayName: "Quote P1 test",
            role: "ADMIN",
          },
        })
      ).id;
      supplierId = (
        await prisma.supplier.create({
          data: { code: `QP1-${suffix}`, name: "Quote P1 supplier" },
        })
      ).id;
      warehouseId = (
        await prisma.warehouse.create({
          data: { code: `QP1-${suffix}`, name: "Quote P1 warehouse" },
        })
      ).id;
      const product = await prisma.product.create({
        data: {
          name: `Quote P1 pump ${suffix}`,
          catalogAuthority: "ACROPORA",
          variants: {
            create: [
              {
                sku: `QP1-A-${suffix}`,
                vatRate: "27",
                sellingGrossPrice: "1270",
                sellingPriceCurrency: "HUF",
              },
              { sku: `QP1-B-${suffix}`, vatRate: "27" },
            ],
          },
        },
        include: { variants: { orderBy: { sku: "asc" } } },
      });
      productIds.push(product.id);
      variantId = product.variants[0]!.id;
      fallbackVariantId = product.variants[1]!.id;

      // recorded FIRST, newest invoice DATE, EUR with a rate, 50% discount
      lineB = (
        await invoice("B", {
          currency: "EUR",
          exchangeRate: "400",
          invoiceDate: "2026-09-01",
          lines: [{ variantId, unitNet: "2", discountPercent: "50" }],
        })
      ).lines[0]!.id;
      // the newest date, but CANCELLED: must not win
      await invoice("C", {
        status: "CANCELLED",
        invoiceDate: "2026-10-01",
        lines: [{ variantId, unitNet: "5" }],
      });
      // recorded LAST but dated EARLIER: must not win
      await invoice("A", {
        invoiceDate: "2026-08-01",
        lines: [{ variantId, unitNet: "1000", discountPercent: "10" }],
      });
      // the fallback variant: only an EUR line WITHOUT a rate, plus the extension price
      await invoice("E", {
        currency: "EUR",
        invoiceDate: "2026-09-10",
        lines: [{ variantId: fallbackVariantId, unitNet: "3" }],
      });
      await prisma.productExtension.create({
        data: {
          variantId: fallbackVariantId,
          lastPurchaseNetPrice: "555",
          defaultPurchaseCurrency: "HUF",
        },
      });

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

      const created = await request("/quotes", "POST", {
        title: "P1 editor",
        validUntil: "2026-12-31",
      });
      assert.equal(created.status, 201);
      quoteId = created.body.id;
      quoteIds.push(quoteId);
      versionId = created.body.latestVersion.id;
    });

    it("a block is added, and a forbidden node is refused by the server", async () => {
      const ok = await request(v("/blocks"), "POST", {
        kind: "SECTION",
        title: "Akvárium",
      });
      assert.equal(ok.status, 201);
      blockId = version(ok.body).blocks[0].id;
      for (const content of [
        {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 2 },
              content: [{ type: "text", text: "x" }],
            },
          ],
        },
        {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "x", marks: [{ type: "underline" }] },
              ],
            },
          ],
        },
      ]) {
        const bad = await request(v("/blocks"), "POST", {
          kind: "TEXT",
          content,
        });
        assert.equal(bad.status, 400, "FORBIDDEN-NODE-400");
      }
      assert.equal(await prisma.quoteBlock.count({ where: { versionId } }), 1);
    });

    it("a PRODUCT item gets its BOM row with the last POSTED purchase by invoice date, in HUF", async () => {
      const res = await request(v(`/blocks/${blockId}/items`), "POST", {
        source: "PRODUCT",
        variantId,
        name: "Szivattyú",
        quantity: "2",
        unit: "db",
        unitNetPrice: "1500",
        vatRatePercent: "27",
      });
      assert.equal(res.status, 201);
      productItemId = version(res.body).blocks[0].items[0].id;
      const row = await prisma.quoteBomItem.findFirstOrThrow({
        where: { quoteItemId: productItemId },
      });
      // invoice B: 2 EUR - 50% = 1 EUR, times 400 = 400 HUF (not A's 900, not C's 5)
      assert.equal(row.unitCost?.toString(), "400", "SNAPSHOT-SOURCE");
      assert.equal(row.costCurrency, "EUR");
      assert.equal(row.costOriginal?.toString(), "1");
      assert.equal(row.exchangeRate?.toString(), "400");
      assert.equal(row.sourcePurchaseInvoiceLineId, lineB);
      assert.equal(row.quantity.toString(), "2");
    });

    it("the PRODUCT item's own BOM row follows its quantity and its variant", async () => {
      const own = () =>
        prisma.quoteBomItem.findFirstOrThrow({
          where: { quoteItemId: productItemId, kind: "PRODUCT" },
        });
      const ten = await request(v(`/items/${productItemId}`), "PATCH", {
        quantity: "10",
      });
      assert.equal(ten.status, 200);
      assert.equal((await own()).quantity.toString(), "10", "BOM-FOLLOWS");
      const costing = await request(v("/costing"));
      const line = (costing.body.lines as Json[]).find(
        (l) => l.itemId === productItemId,
      )!;
      // 10 * 400, not the 2 * 400 the row was created with
      assert.equal(line.bomCost, "4000.0000", "BOM-FOLLOWS-COST");

      const swapped = await request(v(`/items/${productItemId}`), "PATCH", {
        variantId: fallbackVariantId,
      });
      assert.equal(swapped.status, 200);
      const row = await own();
      assert.equal(row.variantId, fallbackVariantId, "BOM-FOLLOWS-VARIANT");
      assert.equal(row.unitCost?.toString(), "555");

      // back to the starting state the later tests read
      await request(v(`/items/${productItemId}`), "PATCH", {
        variantId,
        quantity: "2",
      });
      const back = await own();
      assert.equal(back.variantId, variantId);
      assert.equal(back.quantity.toString(), "2");
      assert.equal(back.unitCost?.toString(), "400");
      assert.equal(back.sourcePurchaseInvoiceLineId, lineB);
    });

    it("a custom BOM line is saved without a variant and without a cost", async () => {
      const item = await request(v(`/blocks/${blockId}/items`), "POST", {
        source: "BOM",
        name: "Egyedi szűrő",
        quantity: "1",
        unit: "db",
        unitNetPrice: "50000",
        vatRatePercent: "27",
      });
      assert.equal(item.status, 201);
      bomItemId = version(item.body).blocks[0].items[1].id;
      const res = await request(
        v(`/items/${bomItemId}/bom`),
        "POST",
        {
          kind: "CUSTOM",
          customName: "Szűrőház",
          quantity: "1",
          unit: "db",
        },
        WRITER,
      );
      assert.equal(res.status, 201);
      const rows = await prisma.quoteBomItem.findMany({
        where: { quoteItemId: bomItemId },
      });
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.variantId, null);
      assert.equal(rows[0]!.unitCost, null);
      customBomId = rows[0]!.id;
      spareCustomBomId = (
        await prisma.quoteBomItem.create({
          data: {
            versionId,
            quoteItemId: bomItemId,
            position: 1,
            kind: "CUSTOM",
            customName: "Tartalék",
            quantity: "1",
            unit: "db",
          },
        })
      ).id;
    });

    it("without quotes.costs.view: no cost field in any answer", async () => {
      const read = await request(
        `/quotes/${quoteId}`,
        "GET",
        undefined,
        WRITER,
      );
      assert.equal(read.status, 200);
      const bom = version(read.body).bomItems as Json[];
      assert.ok(bom.length >= 2);
      for (const row of bom)
        assert.deepEqual(
          Object.keys(row).filter((k) => COST_KEY.test(k)),
          [],
          "READ-NO-COST",
        );

      const added = await request(
        v(`/items/${bomItemId}/bom`),
        "POST",
        {
          kind: "SERVICE",
          customName: "Szerelés",
          quantity: "2",
          unit: "óra",
        },
        WRITER,
      );
      assert.equal(added.status, 201);
      assert.doesNotMatch(
        JSON.stringify(version(added.body).bomItems),
        /unitCost|supplier|internalNote/,
        "WRITE-ANSWER-NO-COST",
      );
    });

    it("without quotes.costs.view: a cost write is 403 and writes nothing", async () => {
      const before = await prisma.quoteBomItem.count({ where: { versionId } });
      const costWrite = await request(
        v(`/items/${bomItemId}/bom`),
        "POST",
        {
          kind: "SERVICE",
          customName: "Kézi költség",
          quantity: "1",
          unit: "óra",
          unitCost: "1000",
        },
        WRITER,
      );
      assert.equal(costWrite.status, 403, "COST-WRITE-403");
      assert.equal(
        await prisma.quoteBomItem.count({ where: { versionId } }),
        before,
      );
    });

    it("without quotes.costs.view: the costing is 403", async () => {
      const costing = await request(v("/costing"), "GET", undefined, WRITER);
      assert.equal(costing.status, 403, "COSTING-403");
    });

    it("the costing: list price, BOM cost, margin and the fallback warning", async () => {
      const fallback = await request(v(`/items/${bomItemId}/bom`), "POST", {
        kind: "PRODUCT",
        variantId: fallbackVariantId,
        quantity: "1",
        unit: "db",
      });
      assert.equal(fallback.status, 201);
      const row = await prisma.quoteBomItem.findFirstOrThrow({
        where: { quoteItemId: bomItemId, variantId: fallbackVariantId },
      });
      // the EUR line has no rate: the extension price, with NO source line
      assert.equal(row.unitCost?.toString(), "555");
      assert.equal(row.costSource, "LAST_PURCHASE");
      assert.equal(row.sourcePurchaseInvoiceLineId, null);

      const res = await request(v("/costing"));
      assert.equal(res.status, 200);
      const product = (res.body.lines as Json[]).find(
        (l) => l.itemId === productItemId,
      )!;
      assert.equal(product.suggestedPriceSource, "LIST_PRICE");
      assert.equal(product.suggestedUnitPrice, "1000.0000");
      assert.equal(product.lineNet, "3000.0000");
      assert.equal(product.bomCost, "800.0000");
      assert.equal(product.marginAmount, "2200.0000");
      const bom = (res.body.lines as Json[]).find(
        (l) => l.itemId === bomItemId,
      )!;
      assert.equal(bom.suggestedPriceSource, "BOM_SUM");
      assert.equal(bom.bomCostComplete, false);
      assert.equal(bom.marginAmount, null);
      assert.ok((bom.warnings as string[]).some((w) => w.includes("tartalék")));
      assert.equal(res.body.totals.marginAmount, null);
    });

    it("the list sums the offered lines in the database; an optional line stays apart", async () => {
      const optional = await request(v(`/blocks/${blockId}/items`), "POST", {
        source: "STANDALONE",
        name: "Opcionális világítás",
        quantity: "1",
        unit: "db",
        unitNetPrice: "7",
        vatRatePercent: "27",
        isOptional: true,
      });
      assert.equal(optional.status, 201);
      // 2 * 1500 + 1 * 50000; the optional 7 is not in it
      assert.equal(version(optional.body).netTotal, "53000.0000");
      assert.equal(version(optional.body).optionalNetTotal, "7.0000");
      const list = await request(
        `/quotes?q=${encodeURIComponent("P1 editor")}&page=1&pageSize=5`,
        "GET",
        undefined,
        WRITER,
      );
      const row = (list.body.items as Json[]).find((i) => i.id === quoteId)!;
      assert.equal(row.latestVersion.netTotal, "53000.0000", "LIST-NET-TOTAL");
      assert.equal(row.createdByName, "Quote P1 test");
    });

    it("a later receipt does not move a stored snapshot", async () => {
      await invoice("D", {
        invoiceDate: "2026-09-20",
        lines: [{ variantId, unitNet: "10" }],
      });
      const row = await prisma.quoteBomItem.findFirstOrThrow({
        where: { quoteItemId: productItemId },
      });
      assert.equal(row.unitCost?.toString(), "400");
      const refreshed = await request(v(`/bom/${row.id}`), "PATCH", {
        refreshCost: true,
      });
      assert.equal(refreshed.status, 200);
      assert.equal(
        (
          await prisma.quoteBomItem.findUniqueOrThrow({ where: { id: row.id } })
        ).unitCost?.toString(),
        "10",
      );
    });

    it("create-product: the row becomes PRODUCT in one write, named after the custom name", async () => {
      const denied = await request(
        `/quote-bom-items/${customBomId}/create-product`,
        "POST",
        undefined,
        WRITER,
      );
      assert.equal(denied.status, 403);
      const res = await request(
        `/quote-bom-items/${customBomId}/create-product`,
        "POST",
      );
      assert.equal(res.status, 201, "CREATE-PRODUCT-201");
      productIds.push(res.body.product.productId);
      const row = await prisma.quoteBomItem.findUniqueOrThrow({
        where: { id: customBomId },
      });
      assert.equal(row.kind, "PRODUCT");
      assert.equal(row.customName, null);
      assert.equal(row.variantId, res.body.product.variantId);
      assert.equal(row.createdProductVariantId, row.variantId);
      const created = await prisma.product.findUniqueOrThrow({
        where: { id: res.body.product.productId },
      });
      assert.equal(created.name, "Szűrőház");
      assert.equal(created.webshopExcluded, true);
      assert.match(res.body.product.sku, /^ACR-L-\d{6}$/);
      const again = await request(
        `/quote-bom-items/${customBomId}/create-product`,
        "POST",
      );
      assert.equal(again.status, 409);
    });

    it("snippets: writing needs quotes.templates.manage, reading quotes.manage", async () => {
      const denied = await request(
        "/quote-snippets",
        "POST",
        {
          name: "Bevezető",
          kind: "INTRO",
          content: doc("Tisztelt Ügyfelünk!"),
        },
        WRITER,
      );
      assert.equal(denied.status, 403, "SNIPPET-WRITE-403");
      assert.equal(
        (await request("/quote-snippets", "GET", undefined, WRITER)).status,
        200,
      );
      assert.equal(
        (await request("/quote-snippets", "GET", undefined, VIEWER)).status,
        403,
      );
      const noSchedule = await request("/quote-snippets", "POST", {
        name: "Fizetés",
        kind: "PAYMENT",
        content: doc("Fizetés"),
      });
      assert.equal(noSchedule.status, 400);
    });

    it("an inserted snippet is a copy: editing or archiving the snippet leaves the version alone", async () => {
      const snippet = await request("/quote-snippets", "POST", {
        name: "Garancia",
        kind: "WARRANTY",
        content: doc("Két év garancia."),
      });
      assert.equal(snippet.status, 201);
      snippetIds.push(snippet.body.id);
      const inserted = await request(
        v(`/snippets/${snippet.body.id}/insert`),
        "POST",
        {},
      );
      assert.equal(inserted.status, 201);
      const block = await prisma.quoteBlock.findFirstOrThrow({
        where: { versionId, sourceSnippetId: snippet.body.id },
      });
      assert.equal(block.kind, "TERMS");
      assert.equal(
        (
          await request(`/quote-snippets/${snippet.body.id}`, "PATCH", {
            content: doc("Egy év."),
          })
        ).status,
        200,
      );
      assert.equal(
        (await request(`/quote-snippets/${snippet.body.id}/archive`, "POST"))
          .status,
        200,
      );
      assert.deepEqual(
        (await prisma.quoteBlock.findUniqueOrThrow({ where: { id: block.id } }))
          .content,
        doc("Két év garancia."),
      );
      const archived = await request(
        v(`/snippets/${snippet.body.id}/insert`),
        "POST",
        {},
      );
      assert.equal(archived.status, 409, "ARCHIVED-409");
    });

    it("a PAYMENT snippet sets the milestones, summing to 100", async () => {
      const snippet = await request("/quote-snippets", "POST", {
        name: "Előleg",
        kind: "PAYMENT",
        content: doc("30% előleg, 70% átadáskor."),
        milestones: [
          { label: "Előleg", percent: "30" },
          { label: "Átadás", percent: "70" },
        ],
      });
      assert.equal(snippet.status, 201);
      snippetIds.push(snippet.body.id);
      assert.equal(
        (await request(v(`/snippets/${snippet.body.id}/insert`), "POST", {}))
          .status,
        201,
      );
      const rows = await prisma.quotePaymentMilestone.findMany({
        where: { versionId },
        orderBy: { position: "asc" },
      });
      assert.deepEqual(
        rows.map((r) => [r.label, r.percent.toString()]),
        [
          ["Előleg", "30"],
          ["Átadás", "70"],
        ],
        "PAYMENT-MILESTONES",
      );
    });

    it("a published version answers 409 to every child write; a new draft copies it", async () => {
      await prisma.quoteVersion.update({
        where: { id: versionId },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
          pdfStorageKey: `test/${suffix}.pdf`,
          pdfSha256: "0".repeat(64),
          pageCount: 1,
        },
      });
      const before = await prisma.quoteBlock.count({ where: { versionId } });
      for (const [path, method, body] of [
        [v("/blocks"), "POST", { kind: "SECTION" }],
        [v(`/items/${productItemId}`), "PATCH", { name: "Más" }],
        [
          v(`/items/${bomItemId}/bom`),
          "POST",
          { kind: "CUSTOM", customName: "x", quantity: "1", unit: "db" },
        ],
        [v("/milestones"), "PUT", { milestones: [] }],
        [v(`/snippets/${snippetIds[1]}/insert`), "POST", {}],
        [
          `/quote-bom-items/${spareCustomBomId}/create-product`,
          "POST",
          undefined,
        ],
        // barracuda's review: every one of the fifteen writes, not six
        [v(""), "PATCH", { validUntil: "2026-12-30" }],
        [v(`/blocks/${blockId}`), "PATCH", { title: "Más" }],
        [v(`/blocks/${blockId}`), "DELETE", undefined],
        [v("/blocks/reorder"), "POST", { ids: [blockId] }],
        [
          v(`/blocks/${blockId}/items`),
          "POST",
          {
            source: "STANDALONE",
            name: "x",
            quantity: "1",
            unit: "db",
            unitNetPrice: "1",
            vatRatePercent: "27",
          },
        ],
        [
          v(`/blocks/${blockId}/items/reorder`),
          "POST",
          { ids: [productItemId] },
        ],
        [v(`/items/${productItemId}`), "DELETE", undefined],
        [v(`/bom/${customBomId}`), "PATCH", { quantity: "2" }],
        [v(`/bom/${customBomId}`), "DELETE", undefined],
      ] as const) {
        const res = await request(path, method, body);
        assert.equal(res.status, 409, `PUBLISHED-409 ${method} ${path}`);
      }
      assert.equal(
        await prisma.quoteBlock.count({ where: { versionId } }),
        before,
      );
      assert.equal(
        await prisma.quoteBomItem.count({ where: { id: customBomId } }),
        1,
      );

      const draft = await request(`/quotes/${quoteId}/versions`, "POST");
      assert.equal(draft.status, 201);
      const next = (draft.body.versions as Json[]).find(
        (x) => x.status === "DRAFT",
      )!;
      assert.equal(next.versionNumber, 2);
      assert.equal(next.createdFromVersionId, versionId);
      assert.equal(next.blocks.length, before);
      const copied = await prisma.quoteBomItem.findMany({
        where: { versionId: next.id },
      });
      assert.equal(
        copied.length,
        await prisma.quoteBomItem.count({ where: { versionId } }),
      );
      assert.equal(
        (await request(`/quotes/${quoteId}/versions`, "POST")).status,
        409,
      );
      versionId = next.id;
      assert.equal(
        (await request(v("/blocks"), "POST", { kind: "SECTION" })).status,
        201,
      );
    });

    it("a new quote from a template copies its blocks and milestones; a broken template is a 400", async () => {
      const template = await prisma.quoteTemplate.create({
        data: {
          name: `QP1 ${suffix}`,
          priceDisplay: "GROSS",
          defaultValidityDays: 30,
          blocks: [
            { kind: "TEXT", title: "Bevezető", content: doc("Köszönjük.") },
            { kind: "PAGE_BREAK" },
          ],
          milestones: [{ label: "Teljes", percent: "100" }],
        },
      });
      templateIds.push(template.id);
      const listed = await request(
        "/quote-templates",
        "GET",
        undefined,
        WRITER,
      );
      assert.ok(
        (listed.body as unknown as Json[]).some((t) => t.id === template.id),
      );
      const res = await request("/quotes", "POST", {
        title: "Sablonból",
        validUntil: "2026-12-31",
        templateId: template.id,
      });
      assert.equal(res.status, 201);
      quoteIds.push(res.body.id);
      assert.equal(res.body.latestVersion.priceDisplay, "GROSS");
      const first = await prisma.quoteVersion.findFirstOrThrow({
        where: { quoteId: res.body.id },
        include: { blocks: { orderBy: { position: "asc" } }, milestones: true },
      });
      assert.equal(first.templateId, template.id, "TEMPLATE-COPY");
      assert.deepEqual(
        first.blocks.map((b) => b.kind),
        ["TEXT", "PAGE_BREAK"],
      );
      assert.equal(first.milestones.length, 1);

      const broken = await prisma.quoteTemplate.create({
        data: {
          name: `QP1 broken ${suffix}`,
          priceDisplay: "NET",
          defaultValidityDays: 30,
          blocks: [
            {
              kind: "TEXT",
              content: { type: "doc", content: [{ type: "heading" }] },
            },
          ],
          milestones: [],
        },
      });
      templateIds.push(broken.id);
      const count = await prisma.quote.count();
      const refused = await request("/quotes", "POST", {
        title: "Hibás",
        validUntil: "2026-12-31",
        templateId: broken.id,
      });
      assert.equal(refused.status, 400);
      assert.equal(await prisma.quote.count(), count);
    });

    after(async () => {
      if (gate.mode !== "run") return;
      if (app) await app.close();
      const versions = (
        await prisma.quoteVersion.findMany({
          where: { quoteId: { in: quoteIds } },
          select: { id: true },
        })
      ).map((x) => x.id);
      await prisma.quoteEvent.deleteMany({
        where: { quoteId: { in: quoteIds } },
      });
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
      // newest first: a version may name an older one as its origin
      await prisma.quoteVersion.updateMany({
        where: { quoteId: { in: quoteIds } },
        data: { createdFromVersionId: null },
      });
      await prisma.quoteVersion.deleteMany({
        where: { quoteId: { in: quoteIds } },
      });
      await prisma.quote.deleteMany({ where: { id: { in: quoteIds } } });
      await prisma.quoteSnippet.deleteMany({
        where: { id: { in: snippetIds } },
      });
      await prisma.quoteTemplate.deleteMany({
        where: { id: { in: templateIds } },
      });
      await prisma.purchaseInvoiceLine.deleteMany({
        where: { purchaseInvoice: { supplierId } },
      });
      await prisma.purchaseInvoice.deleteMany({ where: { supplierId } });
      if (fallbackVariantId)
        await prisma.productExtension.deleteMany({
          where: { variantId: fallbackVariantId },
        });
      await prisma.productVariant.deleteMany({
        where: { productId: { in: productIds } },
      });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
      if (warehouseId)
        await prisma.warehouse.deleteMany({ where: { id: warehouseId } });
      if (supplierId)
        await prisma.supplier.deleteMany({ where: { id: supplierId } });
      if (actorId) {
        await prisma.auditLog.deleteMany({ where: { userId: actorId } });
        await prisma.user.deleteMany({ where: { id: actorId } });
      }
      assert.equal(
        await prisma.quote.count({ where: { id: { in: quoteIds } } }),
        0,
      );
      await prisma.$disconnect();
    });
  },
);
