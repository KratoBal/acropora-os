import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import {
  emptyChain,
  orderBody,
  orderNumberFor,
  PartnerOrdersService,
} from "./partner-orders.service.js";
import {
  MAX_DOCUMENTS_PER_ORDER,
  type OrderContentRow,
  type PartnerOrdersRepository,
} from "./partner-orders.repository.js";

const USER = { id: "user-1", displayName: "Teszt Elek" } as AuthenticatedUser;

function orderRow(over: Partial<OrderContentRow> = {}): OrderContentRow {
  return {
    quote: {
      id: "quote-1",
      quoteNumber: "AJ-2026-0042",
      title: "Állatkerti felújítás",
      status: "ACCEPTED",
      acceptedVersionId: "version-2",
    },
    quoteVersion: {
      id: "version-2",
      versionNumber: 2,
      currency: "HUF",
      priceDisplay: "NET",
      customerSnapshot: {
        name: "Teszt Állatkert",
        postalCode: "1146",
        city: "Budapest",
        address: "Állatkerti krt. 6",
      },
      blocks: [
        {
          position: 1,
          items: [
            {
              id: "item-a",
              position: 1,
              name: "Szűrő csere",
              description: null,
              quantity: new Prisma.Decimal(2),
              unit: "db",
              unitNetPrice: new Prisma.Decimal(10000),
              vatRatePercent: new Prisma.Decimal(27),
              isOptional: false,
            },
            {
              id: "item-b",
              position: 2,
              name: "Extra tisztítás",
              description: null,
              quantity: new Prisma.Decimal(1),
              unit: "alkalom",
              unitNetPrice: new Prisma.Decimal(5000),
              vatRatePercent: new Prisma.Decimal(27),
              isOptional: true,
            },
          ],
        },
      ],
    },
    acceptance: {
      id: "acc-1",
      selectedOptionalItemIds: ["item-b"],
      revokedAt: null,
    },
    ...over,
  } as OrderContentRow;
}

describe("orderNumberFor", () => {
  it("turns the quote prefix into the order prefix and keeps the sequence", () => {
    assert.equal(orderNumberFor("AJ-2026-0042"), "MR-2026-0042");
  });

  it("keeps an unexpected quote number whole instead of cutting it", () => {
    assert.equal(orderNumberFor("X-7"), "MR-X-7");
  });
});

describe("orderBody", () => {
  it("adds the optional lines the pinned acceptance chose to the offered ones", () => {
    const body = orderBody(orderRow());
    assert.equal(body.accepted, true);
    assert.deepEqual(
      body.lines.map((l) => [l.quoteItemId, l.wasOptional]),
      [
        ["item-a", false],
        ["item-b", true],
      ],
    );
    // 2 x 10000 + 1 x 5000 = 25000 net, 27% VAT = 6750
    assert.equal(body.totals.net, "25000");
    assert.equal(body.totals.vat, "6750");
    assert.equal(body.totals.gross, "31750");
  });

  it("drops an optional line the pinned acceptance did not choose", () => {
    const body = orderBody(
      orderRow({
        acceptance: {
          id: "acc-1",
          selectedOptionalItemIds: [],
          revokedAt: null,
        },
      } as never),
    );
    assert.deepEqual(
      body.lines.map((l) => l.quoteItemId),
      ["item-a"],
    );
  });

  it("keeps the signed lines but flags the order when the acceptance was revoked", () => {
    const body = orderBody(
      orderRow({
        acceptance: {
          id: "acc-1",
          selectedOptionalItemIds: ["item-b"],
          revokedAt: new Date("2026-11-05T08:00:00Z"),
        },
      } as never),
    );
    assert.equal(body.accepted, false);
    assert.equal(body.lines.length, 2);
    assert.equal(body.totals.net, "25000");
  });

  it("keeps the signed lines but flags the order when another version was accepted", () => {
    const body = orderBody(
      orderRow({
        quote: {
          id: "quote-1",
          quoteNumber: "AJ-2026-0042",
          title: "x",
          status: "ACCEPTED",
          acceptedVersionId: "version-3",
        },
      } as never),
    );
    assert.equal(body.accepted, false);
    assert.equal(body.lines.length, 2);
  });
});

describe("emptyChain", () => {
  it("has a zero for every step", () => {
    const chain = emptyChain();
    assert.equal(Object.keys(chain).length, 7);
    assert.ok(Object.values(chain).every((count) => count === 0));
  });
});

function service(repository: Record<string, unknown>) {
  return new PartnerOrdersService(
    repository as unknown as PartnerOrdersRepository,
  );
}

describe("createFromQuote", () => {
  it("returns the existing order for a second call and creates nothing", async () => {
    let created = 0;
    const result = await service({
      quoteForOrder: async () =>
        ({
          id: "quote-1",
          quoteNumber: "AJ-2026-0042",
          status: "ACCEPTED",
          acceptedVersionId: "version-2",
          customerId: null,
          partnerOrder: { id: "order-9" },
        }) as never,
      create: async () => {
        created += 1;
        return { id: "new" };
      },
    }).createFromQuote("quote-1", USER);
    assert.deepEqual(result, { id: "order-9" });
    assert.equal(created, 0);
  });

  it("refuses a quote that is not accepted", async () => {
    await assert.rejects(
      service({
        quoteForOrder: async () =>
          ({
            id: "quote-1",
            quoteNumber: "AJ-2026-0042",
            status: "SENT",
            acceptedVersionId: null,
            customerId: null,
            partnerOrder: null,
          }) as never,
      }).createFromQuote("quote-1", USER),
      ConflictException,
    );
  });

  it("names the quote's number in the order number and records who made it", async () => {
    let input: unknown;
    await service({
      quoteForOrder: async () =>
        ({
          id: "quote-1",
          quoteNumber: "AJ-2026-0042",
          status: "ACCEPTED",
          acceptedVersionId: "version-2",
          customerId: "cust-1",
          partnerOrder: null,
          acceptances: [
            { id: "acc-old", quoteVersionId: "version-1" },
            { id: "acc-1", quoteVersionId: "version-2" },
          ],
        }) as never,
      create: async (value: unknown) => {
        input = value;
        return { id: "order-1" };
      },
    }).createFromQuote("quote-1", USER);
    assert.deepEqual(input, {
      orderNumber: "MR-2026-0042",
      quoteId: "quote-1",
      quoteVersionId: "version-2",
      acceptanceId: "acc-1",
      customerId: "cust-1",
      createdById: "user-1",
    });
  });

  it("returns the winner when two clicks race on the unique quote key", async () => {
    const error = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "test",
    });
    const result = await service({
      quoteForOrder: async () =>
        ({
          id: "quote-1",
          quoteNumber: "AJ-2026-0042",
          status: "ACCEPTED",
          acceptedVersionId: "version-2",
          customerId: null,
          partnerOrder: null,
          acceptances: [{ id: "acc-1", quoteVersionId: "version-2" }],
        }) as never,
      create: async () => {
        throw error;
      },
      existingForQuote: async () => ({ id: "order-winner" }),
    }).createFromQuote("quote-1", USER);
    assert.deepEqual(result, { id: "order-winner" });
  });

  it("refuses to make an order when no live acceptance is found for the accepted version", async () => {
    await assert.rejects(
      service({
        quoteForOrder: async () =>
          ({
            id: "quote-1",
            quoteNumber: "AJ-2026-0042",
            status: "ACCEPTED",
            acceptedVersionId: "version-2",
            customerId: null,
            partnerOrder: null,
            acceptances: [{ id: "acc-old", quoteVersionId: "version-1" }],
          }) as never,
      }).createFromQuote("quote-1", USER),
      ConflictException,
    );
  });

  it("says not found for an unknown quote", async () => {
    await assert.rejects(
      service({ quoteForOrder: async () => null }).createFromQuote("x", USER),
      NotFoundException,
    );
  });
});

describe("uploadDocument", () => {
  const pdf = Buffer.from("%PDF-1.4 test");
  const file = (over: Partial<Express.Multer.File> = {}) =>
    ({
      originalname: "alairt.pdf",
      mimetype: "application/pdf",
      buffer: pdf,
      ...over,
    }) as Express.Multer.File;

  it("rejects a step that is not on the chain", async () => {
    await assert.rejects(
      service({}).uploadDocument("o", "NOPE", file(), USER),
      /Ismeretlen lépés/,
    );
  });

  it("rejects a file whose content is not what its type says", async () => {
    await assert.rejects(
      service({
        orderExists: async () => ({ id: "o" }) as never,
      }).uploadDocument(
        "o",
        "SIGNED_ORDER_FORM",
        file({ buffer: Buffer.from("not a pdf") }),
        USER,
      ),
      /érvényes PDF/,
    );
  });

  it("refuses the file past the per-order cap and stores nothing", async () => {
    let stored = 0;
    await assert.rejects(
      service({
        orderExists: async () => ({ id: "o" }) as never,
        documentCount: async () => MAX_DOCUMENTS_PER_ORDER,
        addDocument: async () => {
          stored += 1;
          return {} as never;
        },
      }).uploadDocument("o", "OTHER", file(), USER),
      ConflictException,
    );
    assert.equal(stored, 0);
  });

  it("stores a valid PDF under the chosen step with the uploader", async () => {
    let input: Record<string, unknown> = {};
    await service({
      orderExists: async () => ({ id: "o" }) as never,
      documentCount: async () => 0,
      addDocument: async (value: unknown) => {
        input = value as never;
        return {
          id: "d1",
          step: "SIGNED_ORDER_FORM",
          fileName: "alairt.pdf",
          contentType: "application/pdf",
          sizeBytes: pdf.length,
          createdAt: new Date("2026-11-04T10:00:00Z"),
          uploadedBy: { displayName: "Teszt Elek" },
        };
      },
    }).uploadDocument("o", "SIGNED_ORDER_FORM", file(), USER);
    assert.equal(input.step, "SIGNED_ORDER_FORM");
    assert.equal(input.uploadedById, "user-1");
    assert.equal(input.sizeBytes, pdf.length);
    assert.equal(input.contentType, "application/pdf");
  });

  it("strips path separators from the stored file name", async () => {
    let input: Record<string, unknown> = {};
    await service({
      orderExists: async () => ({ id: "o" }) as never,
      documentCount: async () => 0,
      addDocument: async (value: unknown) => {
        input = value as never;
        return {
          id: "d1",
          step: "OTHER",
          fileName: "x",
          contentType: "application/pdf",
          sizeBytes: 1,
          createdAt: new Date(),
          uploadedBy: null,
        };
      },
    }).uploadDocument(
      "o",
      "OTHER",
      file({ originalname: "../../etc/passwd.pdf" }),
      USER,
    );
    assert.ok(!String(input.fileName).includes("/"));
  });
});

describe("document", () => {
  it("is a 409, not an empty file, when the bytes live in the store", async () => {
    await assert.rejects(
      service({
        document: async () =>
          ({
            id: "d",
            fileName: "a.pdf",
            contentType: "application/pdf",
            content: null,
            storageKey: "k",
          }) as never,
      }).document("o", "d"),
      ConflictException,
    );
  });

  it("is not found for a document of another order", async () => {
    await assert.rejects(
      service({ document: async () => null }).document("o", "d"),
      NotFoundException,
    );
  });
});
