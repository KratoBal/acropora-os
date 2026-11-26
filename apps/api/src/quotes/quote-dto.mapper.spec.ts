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
import { quoteMoneyFixed, quoteTotals } from "./pdf/quote-pdf-layout.js";
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
    closeReason: null,
    closeNote: null,
    postponedUntil: null,
    acceptedVersionId: null,
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
                replacesItemId: null,
              },
              {
                id: "optional",
                position: 1,
                source: "STANDALONE",
                variantId: null,
                name: "Option",
                description: null,
                quantity: d("3"),
                unit: "db",
                unitNetPrice: d("0.3333"),
                vatRatePercent: d("27"),
                isOptional: true,
                replacesItemId: "item",
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
            variant: null,
          },
          {
            id: "bom-product",
            quoteItemId: "item",
            position: 1,
            kind: "PRODUCT",
            variantId: "var",
            customName: null,
            variant: {
              sku: "ACR-1",
              name: "Kék",
              product: { name: "Szivattyú" },
            },
            quantity: d("1"),
            unit: "db",
            unitCost: null,
            costCurrency: null,
            costOriginal: null,
            exchangeRate: null,
            costSource: null,
            costSourceDate: null,
            sourcePurchaseInvoiceLineId: null,
            supplierId: null,
            supplierSku: null,
            internalNote: null,
            createdProductVariantId: null,
          },
        ],
      },
    ],
    customer: { displayName: "Blue Office Kft." },
    owner: null,
    createdBy: { displayName: "Balázs" },
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
    mailDeliveries: [
      {
        id: "mail",
        quoteId: "q",
        quoteVersionId: "v",
        initiatedByUserId: "owner",
        recipients: { to: ["anna@example.test"], cc: [], bcc: ["x"] },
        subject: "Acropora árajánlat",
        outcome: "SENT",
        error: null,
        requestId: "r2",
        isResend: false,
        redirectedTo: null,
        createdAt: date,
        version: { versionNumber: 1 },
        initiatedBy: { displayName: "Balázs" },
      },
    ],
    acceptances: [
      {
        id: "acc",
        quoteId: "q",
        quoteVersionId: "v",
        source: "PHONE",
        acceptedAt: new Date("2026-10-07T00:00:00Z"),
        acceptedByName: "Kovács Anna",
        acceptedByEmail: "anna@example.test",
        recordedByUserId: "owner",
        selectedOptionalItemIds: ["item-opt"],
        note: "Telefonon igent mondott.",
        requestId: "r1",
        revokedAt: null,
        revokedById: null,
        revokeReason: null,
        createdAt: date,
        version: { versionNumber: 1 },
        recordedBy: { displayName: "Balázs" },
        revokedBy: null,
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
  "variantLabel",
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
  await new QuotesRepository().list(2, 25, { q: "Aquarium" });
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
        k === "customer" ||
        k === "createdBy" ||
        query!.select![k as keyof Prisma.QuoteSelect] === true,
    ),
  );
  // P1: the two names come as ONE field each, never the related record
  for (const k of ["customer", "createdBy"] as const)
    assert.deepEqual(query.select[k], { select: { displayName: true } });
  const dto = quoteListItemDto(quoteFixture(), new Map([["v", "200000.2470"]]));
  assert.equal(dto.latestVersion!.netTotal, "200000.2470");
  assert.equal(dto.customerName, "Blue Office Kft.");
  assert.equal(dto.createdByName, "Balázs");
  assert.deepEqual(
    Object.keys(dto).sort(),
    [
      "id",
      "quoteNumber",
      "title",
      "status",
      "customerId",
      "ownerUserId",
      "customerName",
      "createdByName",
      "createdAt",
      "updatedAt",
      "latestVersion",
      // P8: computed, a boolean, no tree
      "isExpired",
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
      "netTotal",
      // the list's gross total (Luca 2026-11-26): the PDF's number, rounded the PDF's way
      "grossTotal",
    ].sort(),
  );
  noCosts(dto);
  noBom(dto);
  assert.equal(
    quoteListItemDto({ ...quoteFixture(), versions: [] }).latestVersion,
    null,
  );
});
/*
  THE LIST'S GROSS TOTAL (Luca 2026-11-26, acrobot 62637): the exact gross sum per version from the database, rounded ONCE the PDF's way (`quoteMoneyFixed`:
  forint to the whole, half up; other currencies two places). WHAT TURNS IT RED: a forint total with decimals; a rounding that is not half up (the .5 case);
  two places missing on a euro quote; a version with no lines showing something else than zero; the sum rounded per line instead of once.
*/
test("the list's gross total is rounded once, the PDF's way: forint whole half up, euro two places, no lines zero", () => {
  const gross = (sum: string | undefined, currency = "HUF") => {
    const row = quoteFixture();
    row.versions[0]!.currency = currency;
    return quoteListItemDto(
      row,
      new Map(),
      sum === undefined ? new Map() : new Map([["v", sum]]),
    ).latestVersion!.grossTotal;
  };
  assert.equal(gross("1049.999895"), "1050");
  assert.equal(gross("1049.5"), "1050", "half up");
  assert.equal(gross("1049.49999"), "1049");
  assert.equal(gross("6172200"), "6172200");
  assert.equal(gross("12.345", "EUR"), "12.35");
  assert.equal(gross("12.344", "EUR"), "12.34");
  assert.equal(gross(undefined), "0");
  assert.equal(gross(undefined, "EUR"), "0.00");
});
test("the PDF and the list agree on a mixed-VAT total: the same lines, the same sum, the same rounding", () => {
  const items = [
    ["3", "333.3333", "5"],
    ["1", "1234.5678", "0"],
    ["2", "1500", "27"],
    ["1", "50000", "27"],
  ].map(([quantity, unitNetPrice, vatRatePercent]) => ({
    name: "x",
    description: null,
    unit: "db",
    isOptional: false,
    quantity: new Prisma.Decimal(quantity!),
    unitNetPrice: new Prisma.Decimal(unitNetPrice!),
    vatRatePercent: new Prisma.Decimal(vatRatePercent!),
  }));
  const pdfGross = quoteTotals([{ items }] as never).gross;
  // what the database sums: quantity * net * (1 + rate / 100), unrounded
  const sqlSum = items.reduce(
    (sum, item) =>
      sum.plus(
        item.quantity
          .times(item.unitNetPrice)
          .times(
            new Prisma.Decimal(1).plus(item.vatRatePercent.dividedBy(100)),
          ),
      ),
    new Prisma.Decimal(0),
  );
  const row = quoteFixture();
  const dto = quoteListItemDto(
    row,
    new Map(),
    new Map([["v", sqlSum.toFixed()]]),
  );
  assert.equal(dto.latestVersion!.grossTotal, quoteMoneyFixed(pdfGross, "HUF"));
  // 1049.999895 + 1234.5678 + 3810 + 63500 = 69594.567695: rounded once, 69595
  assert.equal(dto.latestVersion!.grossTotal, "69595");
});
// KIVÁLTOTT TÉTEL (card 2540d9d4): a szerkesztő látja, melyik tételt váltja ki az opcionális; az ügyfél-DTO-ban nincs belső azonosító
test("the writer's items name the replaced line, the customer's do not", () => {
  const row = quoteFixture();
  const internal = internalQuoteDto(row).versions[0]!.blocks[0]!.items;
  assert.deepEqual(
    internal.map((i) => [i.id, i.replacesItemId]),
    [
      ["item", null],
      ["optional", "item"],
    ],
  );
  for (const item of customerQuoteDto(row).versions[0]!.blocks[0]!.items)
    assert.equal("replacesItemId" in item, false);
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
    list: async () => ({ items: [row], total: 1, expired: new Set() }),
    create: async () => row,
    update: async () => row,
    netTotals: async () => new Map(),
    grossTotals: async () => new Map(),
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

test("P1: the detail carries the names and the offered/optional net totals, exactly", () => {
  const dto = internalQuoteDto(quoteFixture());
  assert.equal(dto.customerName, "Blue Office Kft.");
  assert.equal(dto.ownerName, null);
  assert.equal(dto.createdByName, "Balázs");
  // 2.000001 * 100000.1234 = 200000.3468001234 -> 4 places; the option apart
  assert.equal(dto.versions[0]!.netTotal, "200000.3468");
  assert.equal(dto.versions[0]!.optionalNetTotal, "0.9999");
  // the gross beside them (card 7337010c): 200000.3468001234 * 1.27 = 254000.44..., rounded once; the option 0.9999 * 1.27 = 1.27
  assert.equal(dto.versions[0]!.grossTotal, "254000");
  assert.equal(dto.versions[0]!.optionalGrossTotal, "1");
});

/*
  THE INTERNAL COSTING'S GROSS IS THE PDF'S (Luca 2026-11-26, card 7337010c). What turns this red: a gross counted at one rate for the
  whole quote, a gross rounded per line (or per rate) instead of once, the options counted into the offered gross or left out of their own.
*/
test("the internal detail's gross totals are the PDF's: offered and optional apart, each line at its own rate", () => {
  const row = quoteFixture();
  const block = row.versions[0]!.blocks[0]!;
  const template = block.items[0]!;
  block.items = (
    [
      ["3", "333.3333", "5", false],
      ["1", "1234.5678", "0", false],
      ["2", "1500", "27", false],
      ["1", "50000", "27", false],
      ["2", "1000.5", "5", true],
      ["1", "999.99", "27", true],
    ] as const
  ).map(([quantity, unitNetPrice, rate, isOptional], position) => ({
    ...template,
    id: position === 0 ? template.id : `line-${position}`,
    position,
    quantity: new Prisma.Decimal(quantity),
    unitNetPrice: new Prisma.Decimal(unitNetPrice),
    vatRatePercent: new Prisma.Decimal(rate),
    isOptional,
  }));
  const version = internalQuoteDto(row).versions[0]!;
  const pdf = quoteTotals([{ items: block.items }] as never);
  assert.equal(version.grossTotal, quoteMoneyFixed(pdf.gross, "HUF"));
  assert.equal(
    version.optionalGrossTotal,
    quoteMoneyFixed(pdf.optionalGross, "HUF"),
  );
  // 1049.999895 + 1234.5678 + 3810 + 63500 = 69594.567695 -> 69595
  assert.equal(version.grossTotal, "69595");
  // 2101.05 + 1269.9873 = 3371.0373 -> 3371
  assert.equal(version.optionalGrossTotal, "3371");
});

test("P1: a linked variant is named on the internal detail only", () => {
  const internal = internalQuoteDto(quoteFixture());
  const bom = internal.versions[0]!.bomItems;
  assert.equal(bom[0]!.variantLabel, null);
  assert.equal(bom[1]!.variantLabel, "Szivattyú · Kék (ACR-1)");
  assert.equal(internal.versions[0]!.blocks[0]!.items[0]!.variantLabel, null);
  assert.doesNotMatch(
    JSON.stringify(customerQuoteDto(quoteFixture())),
    /variantLabel|ACR-1/,
  );
});

test("P4a: the detail carries the acceptance and the closing fields; the event payload keeps only enums and a date", () => {
  const dto = internalQuoteDto(quoteFixture());
  assert.deepEqual(dto.acceptances, [
    {
      id: "acc",
      versionId: "v",
      versionNumber: 1,
      source: "PHONE",
      acceptedAt: "2026-10-07",
      acceptedByName: "Kovács Anna",
      acceptedByEmail: "anna@example.test",
      recordedByName: "Balázs",
      selectedOptionalItemIds: ["item-opt"],
      note: "Telefonon igent mondott.",
      createdAt: date.toISOString(),
      revokedAt: null,
      revokedByName: null,
      revokeReason: null,
    },
  ]);
  assert.equal(dto.postponedUntil, null);
  // P3: the send log, recipients from the stored JSON
  assert.deepEqual(dto.deliveries[0]!.to, ["anna@example.test"]);
  assert.deepEqual(dto.deliveries[0]!.bcc, ["x"]);
  assert.equal(dto.deliveries[0]!.initiatedByName, "Balázs");
  assert.deepEqual(
    quoteEventPayload({
      source: "PHONE",
      closeReason: "PRICE",
      postponedUntil: "2026-11-01",
      acceptedByName: "Kovács Anna",
      note: "free text",
    }),
    { source: "PHONE", closeReason: "PRICE", postponedUntil: "2026-11-01" },
  );
  // the customer's view never carries an acceptance
  assert.doesNotMatch(
    JSON.stringify(customerQuoteDto(quoteFixture())),
    /Kovács|acceptances/,
  );
});
