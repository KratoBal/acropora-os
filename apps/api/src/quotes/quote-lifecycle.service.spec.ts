import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { QuoteLifecycleService } from "./quote-lifecycle.service.js";

/**
 * THE DRAFT DELETE AND THE COPY OF A CLOSED QUOTE (Luca, card 5937bdf2) on a
 * fake transaction that records every write in order.
 *
 * MI PIROSÍT: if a quote that was published, sent, accepted or has any event
 * past its creation could be deleted (and the check for each is its own case);
 * if the delete left a child behind or ran in an order the Restrict foreign
 * keys refuse; if a refusal still wrote something; if an open quote could be
 * copied; if the copy touched the source or reused its number or kept a
 * validity that already passed.
 */
const user = { id: "user-1" } as AuthenticatedUser;
const D = (value: number | string) => new Prisma.Decimal(value);

type QuoteRow = {
  quoteNumber: string;
  title: string;
  status: string;
  customerId: string | null;
  project: { id: string } | null;
  handoff: { id: string } | null;
  versions: { id: string; status: string }[];
  events: { kind: string }[];
  _count: {
    acceptances: number;
    acceptanceLinks: number;
    mailDeliveries: number;
  };
};

const draftQuote = (over: Partial<QuoteRow> = {}): QuoteRow => ({
  quoteNumber: "AJ-2026-0042",
  title: "Teszt ajánlat",
  status: "DRAFT",
  customerId: "c1",
  project: null,
  handoff: null,
  versions: [{ id: "v1", status: "DRAFT" }],
  events: [{ kind: "CREATED" }],
  _count: { acceptances: 0, acceptanceLinks: 0, mailDeliveries: 0 },
  ...over,
});

function fake(input: {
  exists?: boolean;
  quote: QuoteRow;
  source?: object | null;
}) {
  const writes: string[] = [];
  const created: Record<string, unknown[]> = {};
  const note = (name: string, data?: unknown) => {
    writes.push(name);
    (created[name] ??= []).push(data);
    return Promise.resolve({ id: `${name}-${writes.length}` });
  };
  const tx = {
    $queryRaw: async (sql: { sql?: string; strings?: string[] }) =>
      input.exists === false
        ? []
        : String(sql.strings?.join("") ?? sql.sql).includes("nextval")
          ? [{ value: 7n }]
          : [{ status: input.quote.status }],
    quote: {
      findUniqueOrThrow: async () => input.quote,
      delete: (a: unknown) => note("quote.delete", a),
      create: async (a: { data: Record<string, unknown> }) => {
        await note("quote.create", a.data);
        return { id: "q-new", versions: [{ id: "v-new" }] };
      },
    },
    quoteVersion: {
      deleteMany: (a: unknown) => note("quoteVersion.deleteMany", a),
      findFirst: async () => input.source ?? null,
    },
    quoteBomItem: {
      deleteMany: (a: unknown) => note("quoteBomItem.deleteMany", a),
      create: (a: unknown) => note("quoteBomItem.create", a),
    },
    quoteItem: {
      deleteMany: (a: unknown) => note("quoteItem.deleteMany", a),
      create: (a: unknown) => note("quoteItem.create", a),
    },
    quoteBlock: {
      deleteMany: (a: unknown) => note("quoteBlock.deleteMany", a),
      create: (a: unknown) => note("quoteBlock.create", a),
    },
    quotePaymentMilestone: {
      deleteMany: (a: unknown) => note("quotePaymentMilestone.deleteMany", a),
    },
    quoteEvent: {
      deleteMany: (a: unknown) => note("quoteEvent.deleteMany", a),
      create: (a: unknown) => note("quoteEvent.create", a),
    },
    auditLog: { create: (a: unknown) => note("auditLog.create", a) },
  };
  const service = new QuoteLifecycleService();
  Object.assign(service, {
    database: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) },
  });
  return { service, writes, created };
}

describe("deleteDraft", () => {
  it("a never-published draft: children first, then versions and the quote, and one audit row", async () => {
    const { service, writes, created } = fake({ quote: draftQuote() });
    const result = await service.deleteDraft("q1", user);
    assert.deepEqual(result, { id: "q1", quoteNumber: "AJ-2026-0042" });
    assert.deepEqual(writes, [
      "quoteBomItem.deleteMany",
      "quoteItem.deleteMany",
      "quoteBlock.deleteMany",
      "quotePaymentMilestone.deleteMany",
      "quoteEvent.deleteMany",
      "quoteVersion.deleteMany",
      "quote.delete",
      "auditLog.create",
    ]);
    assert.deepEqual(
      (created["auditLog.create"]![0] as { data: object }).data,
      {
        action: "quote.draft_deleted",
        entityType: "Quote",
        entityId: "q1",
        userId: "user-1",
        metadata: {
          quoteNumber: "AJ-2026-0042",
          title: "Teszt ajánlat",
          versionCount: 1,
        },
      },
    );
  });

  const refusals: [string, Partial<QuoteRow>][] = [
    ["a sent quote", { status: "SENT" }],
    ["a published version", { versions: [{ id: "v1", status: "PUBLISHED" }] }],
    [
      "a superseded version",
      { versions: [{ id: "v1", status: "SUPERSEDED" }] },
    ],
    [
      "an acceptance",
      { _count: { acceptances: 1, acceptanceLinks: 0, mailDeliveries: 0 } },
    ],
    [
      "an acceptance link",
      { _count: { acceptances: 0, acceptanceLinks: 1, mailDeliveries: 0 } },
    ],
    [
      "a mail delivery",
      { _count: { acceptances: 0, acceptanceLinks: 0, mailDeliveries: 1 } },
    ],
    ["a handoff", { handoff: { id: "h1" } }],
    ["a project", { project: { id: "p1" } }],
    [
      "an event past its creation",
      { events: [{ kind: "CREATED" }, { kind: "PUBLISHED" }] },
    ],
  ];
  for (const [name, over] of refusals)
    it(`refuses ${name}, and writes nothing`, async () => {
      const { service, writes } = fake({ quote: draftQuote(over) });
      await assert.rejects(() => service.deleteDraft("q1", user), {
        name: "ConflictException",
      });
      assert.deepEqual(writes, []);
    });

  it("an unknown quote is a 404 and writes nothing", async () => {
    const { service, writes } = fake({ exists: false, quote: draftQuote() });
    await assert.rejects(() => service.deleteDraft("nope", user), {
      name: "NotFoundException",
    });
    assert.deepEqual(writes, []);
  });
});

describe("copyAsNew", () => {
  const source = (validUntil: string) => ({
    id: "v-src",
    versionNumber: 3,
    status: "PUBLISHED",
    validUntil: new Date(`${validUntil}T00:00:00Z`),
    currency: "HUF",
    priceDisplay: "NET",
    customerSnapshot: null,
    templateId: null,
    milestones: [{ position: 0, label: "Előleg", percent: D(50) }],
    blocks: [
      {
        id: "b1",
        position: 0,
        kind: "SECTION",
        title: "Tételek",
        content: null,
        keepWithNext: false,
        startOnNewPage: false,
        sourceSnippetId: null,
        items: [
          {
            id: "i1",
            position: 0,
            source: "BOM",
            variantId: null,
            name: "Akvárium",
            description: null,
            quantity: D(1),
            unit: "db",
            unitNetPrice: D(1000),
            vatRatePercent: D(27),
            isOptional: false,
          },
        ],
      },
    ],
    bomItems: [
      {
        quoteItemId: "i1",
        position: 0,
        kind: "CUSTOM",
        variantId: null,
        customName: "Üveg",
        quantity: D(1),
        unit: "db",
        unitCost: D(400),
        costCurrency: "HUF",
        costOriginal: D(400),
        exchangeRate: null,
        costSource: "MANUAL",
        costSourceDate: null,
        sourcePurchaseInvoiceLineId: null,
        supplierId: null,
        supplierSku: null,
        internalNote: null,
        createdProductVariantId: null,
      },
    ],
  });

  for (const status of ["ACCEPTED", "REJECTED", "CANCELLED"])
    it(`a ${status} quote: a new quote with a new number, version 1 as a deep copy, the source untouched`, async () => {
      const { service, writes, created } = fake({
        quote: draftQuote({ status }),
        source: source("2099-12-31"),
      });
      const result = await service.copyAsNew("q1", user);
      assert.equal(result.id, "q-new");
      assert.match(result.quoteNumber, /^AJ-\d{4}-0007$/);
      assert.deepEqual(writes, [
        "quote.create",
        "quoteBlock.create",
        "quoteItem.create",
        "quoteBomItem.create",
        "quoteEvent.create",
        "auditLog.create",
      ]);
      const data = created["quote.create"]![0] as {
        title: string;
        ownerUserId: string;
        versions: { create: { validUntil: Date; versionNumber: number } };
      };
      assert.equal(data.title, "Teszt ajánlat (másolat)");
      assert.equal(data.ownerUserId, "user-1");
      assert.equal(data.versions.create.versionNumber, 1);
      // a validity in the future is kept as it is
      assert.equal(
        data.versions.create.validUntil.toISOString().slice(0, 10),
        "2099-12-31",
      );
      const event = (
        created["quoteEvent.create"]![0] as { data: { payload: object } }
      ).data.payload;
      assert.deepEqual(event, {
        quoteNumber: result.quoteNumber,
        versionNumber: 1,
        outcome: "COPY",
        copiedFromQuoteNumber: "AJ-2026-0042",
      });
    });

  it("a validity that already passed becomes today plus 30 days", async () => {
    const { service, created } = fake({
      quote: draftQuote({ status: "CANCELLED" }),
      source: source("2020-01-01"),
    });
    await service.copyAsNew("q1", user);
    const data = created["quote.create"]![0] as {
      versions: { create: { validUntil: Date } };
    };
    const got = data.versions.create.validUntil.getTime();
    const day = 24 * 3600 * 1000;
    assert.ok(got > Date.now() + 28 * day && got < Date.now() + 32 * day);
  });

  for (const status of ["DRAFT", "SENT", "POSTPONED"])
    it(`a ${status} quote is not copied (it has a new version), and nothing is written`, async () => {
      const { service, writes } = fake({
        quote: draftQuote({ status }),
        source: source("2099-12-31"),
      });
      await assert.rejects(() => service.copyAsNew("q1", user), {
        name: "ConflictException",
      });
      assert.deepEqual(writes, []);
    });

  it("a closed quote with no published version is refused, and nothing is written", async () => {
    const { service, writes } = fake({
      quote: draftQuote({ status: "REJECTED" }),
      source: null,
    });
    await assert.rejects(() => service.copyAsNew("q1", user), {
      name: "ConflictException",
    });
    assert.deepEqual(writes, []);
  });
});
