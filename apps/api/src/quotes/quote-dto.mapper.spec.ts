import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma, prisma } from "@acropora/database";
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  type AuthenticatedUser,
} from "@acropora/types";
import {
  customerQuoteDto,
  internalQuoteDto,
  quoteDto,
  quoteEventPayload,
  quoteText,
  quoteListItemDto,
  type QuoteRow,
} from "./quote-dto.mapper.js";
import { QuotesService } from "./quotes.service.js";
import { QuotesRepository } from "./quotes.repository.js";
import { QuotesController } from "./quotes.controller.js";
import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import {
  DOCUMENT_OWNERS,
  ownerDirectory,
} from "../service-assets/document-store/document-store.js";
const d = (v: string) => new Prisma.Decimal(v),
  date = new Date("2026-10-07T12:00:00Z");
export function quoteFixture(): QuoteRow {
  return {
    id: "q",
    quoteNumber: "AJ-2026-0001",
    title: "Aquarium",
    status: "DRAFT",
    customerId: "c",
    ownerUserId: "owner",
    createdById: "creator",
    createdAt: date,
    updatedAt: date,
    versions: [
      {
        id: "v",
        versionNumber: 1,
        status: "DRAFT",
        validUntil: date,
        currency: "HUF",
        priceDisplay: "NET",
        templateId: "template",
        createdFromVersionId: null,
        publishedAt: null,
        customerSnapshot: {
          name: "Customer",
          unitCost: "DO NOT LEAK",
          supplier: { id: "secret" },
        },
        blocks: [
          {
            id: "block",
            position: 0,
            kind: "SECTION",
            title: "Aquarium",
            content: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "Customer text",
                      marks: [{ type: "bold" }],
                    },
                  ],
                },
              ],
            },
            sourceSnippetId: "snippet",
            keepWithNext: true,
            startOnNewPage: false,
            items: [
              {
                id: "item",
                position: 0,
                source: "BOM",
                variantId: null,
                name: "Build",
                description: null,
                quantity: d("2.000001"),
                unit: "db",
                unitNetPrice: d("100000.1234"),
                vatRatePercent: d("27"),
                isOptional: false,
              },
            ],
          },
        ],
        milestones: [
          { id: "mile", position: 0, label: "Order", percent: d("40") },
        ],
        bomItems: [
          {
            id: "bom",
            quoteItemId: "item",
            position: 0,
            kind: "CUSTOM",
            variantId: null,
            customName: "Custom part",
            quantity: d("1.234567"),
            unit: "db",
            unitCost: d("87654.4321"),
            costCurrency: "EUR",
            costOriginal: d("219.136"),
            exchangeRate: d("400"),
            costSource: "MANUAL",
            costSourceDate: date,
            sourcePurchaseInvoiceLineId: "line",
            supplierId: "supplier",
            supplierSku: "private",
            internalNote: "private note",
            createdProductVariantId: null,
          },
        ],
      },
    ],
    events: [
      {
        id: "event",
        versionId: "v",
        kind: "CREATED",
        actorUserId: "owner",
        createdAt: date,
        payload: {
          versionNumber: 1,
          unitCost: 100,
          supplierId: "secret",
          bom: [{ unitCost: 55 }],
          nested: { margin: 90 },
          internalNote: "hidden",
        },
      },
    ],
  } as unknown as QuoteRow;
}
const user = (
  role: AuthenticatedUser["role"],
  permissions?: AuthenticatedUser["permissions"],
): AuthenticatedUser => ({
  id: "u",
  email: "test@example.test",
  displayName: "Test",
  role,
  customerId: null,
  supplierId: null,
  ...(permissions ? { permissions } : {}),
});
function keys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keys);
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => [k, ...keys(v)]);
  return [];
}
/** No cost, margin, supplier or internal-note key anywhere (P0, unchanged in P1). */
const noCosts = (value: unknown) =>
  assert.deepEqual(
    keys(value).filter((k) => /cost|margin|supplier|internalnote/i.test(k)),
    [],
  );
/** The customer output carries no BOM at all; the cost-free internal one does since P1. */
const noBom = (value: unknown) =>
  assert.deepEqual(
    keys(value).filter((k) => /bom/i.test(k)),
    [],
  );
/** P1: the cost-free BOM line is exactly this allowlist. */
const BOM_LINE_KEYS = [
  "createdProductVariantId",
  "customName",
  "id",
  "kind",
  "position",
  "quantity",
  "quoteItemId",
  "unit",
  "variantId",
];
test("list query fetches only a bounded header/version projection and list mapper cannot expose the tree", async (t) => {
  let query: Prisma.QuoteFindManyArgs | undefined;
  const original = {
    findMany: prisma.quote.findMany,
    count: prisma.quote.count,
    transaction: prisma.$transaction,
  };
  t.after(() => {
    prisma.quote.findMany = original.findMany;
    prisma.quote.count = original.count;
    prisma.$transaction = original.transaction;
  });
  prisma.quote.findMany = ((args: Prisma.QuoteFindManyArgs) => {
    query = args;
    return Promise.resolve([]);
  }) as unknown as typeof original.findMany;
  prisma.quote.count = (() =>
    Promise.resolve(0)) as unknown as typeof original.count;
  prisma.$transaction = ((operations: Promise<unknown>[]) =>
    Promise.all(operations)) as unknown as typeof original.transaction;
  await new QuotesRepository().list(2, 25, "Aquarium");
  assert.ok(query?.select);
  assert.equal(query.include, undefined);
  assert.equal(query.skip, 25);
  assert.equal(query.take, 25);
  assert.ok(query.where?.OR);
  const versions = query.select.versions as Prisma.Quote$versionsArgs;
  assert.equal(versions.take, 1);
  assert.deepEqual(versions.orderBy, { versionNumber: "desc" });
  assert.ok(Object.values(versions.select!).every((v) => v === true));
  assert.ok(
    Object.keys(query.select).every(
      (k) =>
        k === "versions" ||
        query!.select![k as keyof Prisma.QuoteSelect] === true,
    ),
  );
  const dto = quoteListItemDto(quoteFixture());
  assert.deepEqual(
    Object.keys(dto).sort(),
    [
      "id",
      "quoteNumber",
      "title",
      "status",
      "customerId",
      "ownerUserId",
      "createdAt",
      "updatedAt",
      "latestVersion",
    ].sort(),
  );
  assert.deepEqual(
    Object.keys(dto.latestVersion!).sort(),
    [
      "id",
      "versionNumber",
      "status",
      "validUntil",
      "currency",
      "priceDisplay",
      "publishedAt",
    ].sort(),
  );
  noCosts(dto);
  noBom(dto);
  assert.equal(
    quoteListItemDto({ ...quoteFixture(), versions: [] }).latestVersion,
    null,
  );
});
test("three allowlisted DTO shapes, decimal precision and no customer/internal cost-free leakage", () => {
  const row = quoteFixture(),
    customer = customerQuoteDto(row),
    internal = internalQuoteDto(row),
    costs = quoteDto(row, user("ADMIN"));
  noCosts(customer);
  noBom(customer);
  noCosts(internal);
  // P1: the writer sees what a line is made of, never its cost
  assert.ok(internal.versions[0]!.bomItems.length > 0);
  for (const line of internal.versions[0]!.bomItems)
    assert.deepEqual(Object.keys(line).sort(), BOM_LINE_KEYS);
  assert.equal(
    customer.versions[0]!.blocks[0]!.items[0]!.unitNetPrice,
    "100000.1234",
  );
  assert.equal(customer.versions[0]!.blocks[0]!.items[0]!.quantity, "2.000001");
  assert.deepEqual(customer.versions[0]!.customerSnapshot, {
    name: "Customer",
  });
  assert.equal(costs.audience, "internal-costs");
  if (costs.audience !== "internal-costs") throw new Error();
  assert.equal(costs.versions[0]!.bomItems[0]!.unitCost, "87654.4321");
  assert.equal(costs.versions[0]!.bomItems[0]!.exchangeRate, "400");
  assert.equal(internal.versions[0]!.blocks[0]!.sourceSnippetId, "snippet");
  assert.deepEqual(internal.events[0]!.payload, { versionNumber: 1 });
  assert.deepEqual(costs.events[0]!.payload, { versionNumber: 1 });
});
test("effective user permissions govern cost serialization, including revocation from ADMIN", () => {
  noCosts(quoteDto(quoteFixture(), user("SALES")));
  noCosts(
    quoteDto(
      quoteFixture(),
      user(
        "ADMIN",
        ROLE_PERMISSIONS.ADMIN.filter(
          (p) => p !== PERMISSIONS.QUOTES_COSTS_VIEW,
        ),
      ),
    ),
  );
  assert.equal(
    quoteDto(
      quoteFixture(),
      user("SALES", [PERMISSIONS.QUOTES_VIEW, PERMISSIONS.QUOTES_COSTS_VIEW]),
    ).audience,
    "internal-costs",
  );
});
test("event allowlist rejects nested payloads, arbitrary strings/arrays and future cost keys", () => {
  for (const payload of [
    { futureCosts: { margin: 1 } },
    { bomItems: [{ unitCost: 20 }] },
    { supplierName: "secret" },
    ["secret"],
    "secret",
    null,
  ])
    assert.equal(quoteEventPayload(payload), null);
  assert.deepEqual(
    quoteEventPayload({
      requestId: "uuid",
      versionNumber: 2,
      fieldCount: 1,
      payload: { cost: 30 },
    }),
    { requestId: "uuid", versionNumber: 2, fieldCount: 1 },
  );
});
test("TipTap read shape rejects unknown node types/attributes and image metadata is allowlisted", () => {
  assert.equal(quoteText({ type: "script", text: "bad" }), null);
  assert.equal(quoteText({ type: "paragraph", attrs: { unitCost: 44 } }), null);
  assert.equal(
    quoteText({
      type: "text",
      text: "bad",
      marks: [{ type: "bold", attrs: { unitCost: 44 } }],
    }),
    null,
  );
  assert.equal(
    quoteText({ type: "text", text: "bad", marks: [{ type: "link" }] }),
    null,
  );
  const row = quoteFixture();
  row.versions[0]!.blocks[0]!.kind = "IMAGE";
  row.versions[0]!.blocks[0]!.content = {
    documentId: "image",
    caption: "Customer photo",
    widthRatio: 0.5,
    unitCost: 99,
    supplierId: "hidden",
  };
  noCosts(customerQuoteDto(row));
  assert.deepEqual(customerQuoteDto(row).versions[0]!.blocks[0]!.content, {
    documentId: "image",
    caption: "Customer photo",
    widthRatio: 0.5,
  });
});
test("cost-free API reads and writes use the safe mapper and VIEWER cannot reach repository", async () => {
  const row = quoteFixture();
  let calls = 0;
  const repo = {
    find: async () => {
      calls++;
      return row;
    },
    list: async () => ({ items: [row], total: 1 }),
    create: async () => row,
    update: async () => row,
  } as unknown as QuotesRepository;
  const service = new QuotesService(repo);
  noCosts(await service.get("q", user("SALES")));
  noCosts(await service.list(user("SALES"), 1, 25));
  noCosts(
    await service.create(
      { title: "Aquarium", validUntil: "2026-10-31" },
      user("SALES"),
    ),
  );
  noCosts(await service.update("q", { title: "New" }, user("SALES")));
  const before = calls;
  await assert.rejects(service.get("q", user("VIEWER")), /Nincs jogosultság/);
  assert.equal(calls, before);
  await assert.rejects(
    service.create(
      { title: "Aquarium", validUntil: "2026-02-30" },
      user("SALES"),
    ),
    /Érvénytelen/,
  );
  await assert.rejects(
    service.update("q", { title: null } as never, user("SALES")),
    /Érvénytelen/,
  );
});
test("all four routes have central permission metadata and quote is a document-store owner", () => {
  for (const route of ["list", "get"] as const)
    assert.deepEqual(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        QuotesController.prototype[route],
      ),
      [PERMISSIONS.QUOTES_VIEW],
    );
  for (const route of ["create", "update"] as const)
    assert.deepEqual(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        QuotesController.prototype[route],
      ),
      [PERMISSIONS.QUOTES_MANAGE],
    );
  assert.ok(DOCUMENT_OWNERS.includes("quote"));
  assert.equal(ownerDirectory("quote"), "quotes");
});
