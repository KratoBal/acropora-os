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
import { endOfIssueDay, latestMovements } from "./partner-order-movements.js";
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

/*
  A LISTA SZUROI ES A HATRALEKOS TETELEK (S4, 38caeac2). MI PIROSIT: ha a lanc szerinti szuro csak az aktualis
  lapot szurne (az adatbazis vagja a lapot, es a masodik lapon rossz sorok allnanak); ha a teljes olvasas a
  szuro nelkuli listara is lefutna (felesleges, es a lapozas elcsuszna); ha a hatralekos tetel a reszteljesites
  utan is nyitott marad, vagy a teljes igazolas utan is annak szamit; ha a ket szuro egyike elmaradna a
  kombinalasnal.
*/
describe("the order list filters and open lines", () => {
  const row = (id: string, status = "OPEN") =>
    ({
      ...orderRow(),
      id,
      orderNumber: `MR-${id}`,
      status,
      customerId: null,
      customer: null,
      createdAt: new Date("2026-11-01T08:00:00Z"),
    }) as unknown as OrderContentRow & { id: string };

  const chainOf = (orderId: string, step: string, count = 1) => ({
    orderId,
    step,
    _count: { _all: count },
  });

  function fake(
    rows: ReturnType<typeof row>[],
    chain: ReturnType<typeof chainOf>[],
    certified: {
      orderId: string;
      quoteItemId: string;
      quantity: Prisma.Decimal;
    }[],
    extra: {
      movements?: Map<string, Date>;
      backlogDays?: number | null;
    } = {},
  ) {
    const calls = { list: 0, listAll: 0 };
    const saved: { days: number; userId: string | null }[] = [];
    const repository = {
      list: async (page: number, pageSize: number) => {
        calls.list += 1;
        return {
          rows: rows.slice((page - 1) * pageSize, page * pageSize),
          total: rows.length,
          chain,
        };
      },
      listAll: async () => {
        calls.listAll += 1;
        return { rows, chain };
      },
      systemDocumentSources: async () => new Map(),
      certifiedLines: async (ids: readonly string[]) =>
        certified.filter((line) => ids.includes(line.orderId)),
      lastMovements: async () => extra.movements ?? new Map(),
      settings: async () =>
        extra.backlogDays === undefined || extra.backlogDays === null
          ? null
          : { backlogDays: extra.backlogDays },
      saveSettings: async (days: number, userId: string | null) => {
        saved.push({ days, userId });
        return { backlogDays: days };
      },
    } as unknown as PartnerOrdersRepository;
    return { service: new PartnerOrdersService(repository), calls, saved };
  }

  // item-a 2 db, item-b 1 alkalom (the fixture's two lines)
  const rows = [row("o1"), row("o2"), row("o3")];
  const chain = [
    chainOf("o1", "COMPLETION"),
    chainOf("o2", "COMPLETION"),
    chainOf("o2", "SIGNED_COMPLETION"),
    chainOf("o3", "COMPLETION"),
  ];
  const certified = [
    { orderId: "o1", quoteItemId: "item-a", quantity: new Prisma.Decimal(1) },
    { orderId: "o2", quoteItemId: "item-a", quantity: new Prisma.Decimal(2) },
    { orderId: "o2", quoteItemId: "item-b", quantity: new Prisma.Decimal(1) },
  ];

  it("the plain list keeps the database's page and says each order's open and total lines", async () => {
    const { service, calls } = fake(rows, chain, certified);
    const result = await service.list(1, 10, {});
    assert.deepEqual(calls, { list: 1, listAll: 0 });
    assert.deepEqual(
      result.items.map((item) => [item.id, item.openLines, item.totalLines]),
      [
        ["o1", 2, 2],
        ["o2", 0, 2],
        ["o3", 2, 2],
      ],
    );
  });

  it("a part certificate keeps the line open, a full one closes it", async () => {
    const { service } = fake([row("o1"), row("o2")], chain, certified);
    const result = await service.list(1, 10, {});
    // o1: item-a certified 1 of 2 (still open) and item-b untouched: both open; o2: both certified in full
    assert.deepEqual(
      result.items.map((item) => item.openLines),
      [2, 0],
    );
  });

  it("the chain filter reads every order, then cuts the pages: the second page holds the second match", async () => {
    const { service, calls } = fake(rows, chain, certified);
    const first = await service.list(1, 1, { stage: "AWAITING_SIGNATURE" });
    const second = await service.list(2, 1, { stage: "AWAITING_SIGNATURE" });
    assert.deepEqual(calls.list, 0);
    assert.equal(first.total, 2);
    assert.deepEqual(
      first.items.map((item) => item.id),
      ["o1"],
    );
    assert.deepEqual(
      second.items.map((item) => item.id),
      ["o3"],
    );
  });

  it("the open filter leaves out the order that is certified in full", async () => {
    const { service } = fake(rows, chain, certified);
    const result = await service.list(1, 10, { openOnly: true });
    assert.deepEqual(
      result.items.map((item) => item.id),
      ["o1", "o3"],
    );
    assert.equal(result.total, 2);
  });

  // S4a review: the Hátralék column shows a cancelled order a dash, so the open filter must not list it
  it("the open filter leaves out a cancelled order that has open lines, the plain list still shows it", async () => {
    const withCancelled = [...rows, row("o4", "CANCELLED")];
    const { service } = fake(withCancelled, chain, certified);
    const open = await service.list(1, 10, { openOnly: true });
    assert.deepEqual(
      open.items.map((item) => item.id),
      ["o1", "o3"],
    );
    const all = await service.list(1, 10, {});
    assert.deepEqual(
      all.items.map((item) => [item.id, item.openLines]),
      [
        ["o1", 2],
        ["o2", 0],
        ["o3", 2],
        ["o4", 2],
      ],
    );
  });

  // S4a review: several certificates, one signed and a later one not: that order still waits for a signature
  it("the signature filter keeps the order whose second TIG is not signed yet", async () => {
    const two = [row("p1")];
    const twoChain = [
      chainOf("p1", "COMPLETION", 2),
      chainOf("p1", "SIGNED_COMPLETION", 1),
    ];
    const { service } = fake(two, twoChain, []);
    const result = await service.list(1, 10, { stage: "AWAITING_SIGNATURE" });
    assert.deepEqual(
      result.items.map((item) => item.id),
      ["p1"],
    );
  });

  it("both filters together keep only the orders that match both", async () => {
    const { service } = fake(rows, chain, certified);
    const result = await service.list(1, 10, {
      stage: "AWAITING_INVOICE",
      openOnly: true,
    });
    assert.deepEqual(result.items, []);
    assert.equal(result.total, 0);
    const invoice = await service.list(1, 10, { stage: "AWAITING_INVOICE" });
    assert.deepEqual(
      invoice.items.map((item) => item.id),
      ["o2"],
    );
  });

  /*
    A HATRALEKOS MEGRENDELES (S4b, 38caeac2). MI PIROSIT: ha az alapertek nem 14 nap, amig senki nem mentett beallitast;
    ha a letrehozas utani tetlen napok helyett a TIG vagy a dokumentum mozgasa nem szamit; ha a 0 napos kuszob nem
    teszi azonnal hatralekossa a nyitott, teljesitetlen megrendelest; ha a teljesen igazolt vagy lemondott megrendeles
    hatralekos; ha a szuro nem az egesz halmazon fut; ha a beallitast nem a mentő felhasznalo azonositojaval ment.
  */
  describe("the backlog", () => {
    const now = new Date("2026-11-20T12:00:00Z"); // 19 days after the fixture's creation (2026-11-01T08:00Z)
    const DAY = 24 * 60 * 60 * 1000;
    const flags = (result: Awaited<ReturnType<PartnerOrdersService["list"]>>) =>
      result.items.map((item) => [item.id, item.backlog, item.idleDays]);

    it("the default is fourteen days: an open order with open lines idle for 19 days is back-ordered, a fully certified one is not", async () => {
      const { service } = fake(rows, chain, certified);
      const result = await service.list(1, 10, {}, now);
      assert.deepEqual(flags(result), [
        ["o1", true, 19],
        ["o2", false, 19],
        ["o3", true, 19],
      ]);
      assert.equal(result.items[0]!.lastMovementAt, "2026-11-01T08:00:00.000Z");
    });

    it("a certificate or a document is a movement: the idle days count from the newest one", async () => {
      const movements = new Map([["o1", new Date(now.getTime() - 3 * DAY)]]);
      const { service } = fake(rows, chain, certified, { movements });
      const result = await service.list(1, 10, {}, now);
      assert.deepEqual(flags(result)[0], ["o1", false, 3]);
      assert.equal(
        result.items[0]!.lastMovementAt,
        new Date(now.getTime() - 3 * DAY).toISOString(),
      );
      // an older movement than the creation changes nothing
      const old = new Map([["o1", new Date("2026-10-01T00:00:00Z")]]);
      const same = await fake(rows, chain, certified, {
        movements: old,
      }).service.list(1, 10, {}, now);
      assert.equal(same.items[0]!.lastMovementAt, "2026-11-01T08:00:00.000Z");
    });

    // barracuda #2230: a certificate's signed copy and an issued invoice are movements of the chain. The repository
    // reads them (the real database case is partner-order-movements.integration.spec); here the service must use
    // what it gets, so a fresh one keeps the order out of the backlog
    it("a TIG on day 0, its signed copy on day 10 and a part invoice on day 12 is not back-ordered on day 14", async () => {
      const day0 = new Date(now.getTime() - 19 * DAY); // the fixture's creation, 19 days before `now`
      const movements = latestMovements([
        [{ orderId: "o1", at: day0 }],
        [{ orderId: "o1", at: new Date(day0.getTime() + 10 * DAY) }],
        [
          {
            orderId: "o1",
            at: endOfIssueDay(new Date(day0.getTime() + 12 * DAY)),
          },
        ],
      ]);
      const { service } = fake(rows, chain, certified, { movements });
      const result = await service.list(1, 10, {}, now);
      // the invoice's day ends at the start of day 13: 6 days ago, not back-ordered under the 14 day default
      assert.equal(result.items[0]!.idleDays, 6);
      assert.equal(result.items[0]!.backlog, false);
    });

    it("zero days: every open order with an open line is back-ordered at once", async () => {
      const { service } = fake(rows, chain, certified, { backlogDays: 0 });
      const fresh = await service.list(
        1,
        10,
        {},
        new Date("2026-11-01T08:00:00Z"),
      );
      assert.deepEqual(
        flags(fresh).map((entry) => entry[1]),
        [true, false, true],
      );
    });

    it("a saved setting replaces the default: 30 days leaves a 19 days idle order alone", async () => {
      const { service } = fake(rows, chain, certified, { backlogDays: 30 });
      const result = await service.list(1, 10, {}, now);
      assert.deepEqual(
        flags(result).map((entry) => entry[1]),
        [false, false, false],
      );
    });

    it("a cancelled order is never back-ordered, whatever it still has open", async () => {
      const { service } = fake([row("o4", "CANCELLED")], [], [], {
        backlogDays: 0,
      });
      const result = await service.list(1, 10, {}, now);
      assert.deepEqual(flags(result), [["o4", false, 19]]);
    });

    it("the backlog filter reads every order, then cuts the pages", async () => {
      const { service, calls } = fake(rows, chain, certified);
      const first = await service.list(1, 1, { backlogOnly: true }, now);
      const second = await service.list(2, 1, { backlogOnly: true }, now);
      assert.equal(calls.list, 0);
      assert.equal(first.total, 2);
      assert.deepEqual(
        first.items.map((item) => item.id),
        ["o1"],
      );
      assert.deepEqual(
        second.items.map((item) => item.id),
        ["o3"],
      );
    });

    it("the settings: the default without a row, the saved value with one, saved under the user's id", async () => {
      const { service, saved } = fake(rows, chain, certified);
      assert.deepEqual(await service.settings(), { backlogDays: 14 });
      assert.deepEqual(await service.saveSettings(0, USER), { backlogDays: 0 });
      assert.deepEqual(saved, [{ days: 0, userId: "user-1" }]);
      const withRow = fake(rows, chain, certified, { backlogDays: 7 });
      assert.deepEqual(await withRow.service.settings(), { backlogDays: 7 });
    });
  });
});
