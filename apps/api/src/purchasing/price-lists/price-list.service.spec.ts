import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";

import { Prisma } from "@acropora/database";

import type { MatchDecision } from "./price-list-matching.js";
import type {
  NewListInput,
  PriceListRepository,
} from "./price-list.repository.js";
import { PriceListService, parseListDate } from "./price-list.service.js";
import type { ParsedPriceEntry } from "./price-list.types.js";

const NOW = new Date("2026-10-23T12:00:00.000Z");

// A generated, format-faithful De Jong list (no real supplier data).
const DEJONG = Buffer.from(
  [
    "STOCKLIST EXAMPLE B.V.,,,,,",
    "Code,Description,Price,Stock,Order,",
    "AAA-001,Example fish package,165,10",
    "AAA-002,Example clownfish pair,138.88999999999999,3",
    "TANKBRED FISHES:,,,1,1",
  ].join("\r\n"),
  "utf8",
);

function setup(
  options: {
    supplier?: {
      id: string;
      name: string;
      isSupplier: boolean;
      isActive: boolean;
    } | null;
    duplicate?: {
      id: string;
      listDate: Date;
      sourceFileName: string;
      createdAt: Date;
    } | null;
    barcodes?: { code: string; variantId: string }[];
    known?: Record<string, string>;
    existing?: Record<
      string,
      { variantId: string; status: "AUTO" | "APPROVED" | "REJECTED" }
    >;
    createError?: unknown;
  } = {},
) {
  const created: { input: NewListInput; entries: ParsedPriceEntry[] }[] = [];
  const saved: MatchDecision[][] = [];
  const queried: string[][] = [];
  const repository = {
    supplier: async () =>
      options.supplier === undefined
        ? { id: "sup-1", name: "De Jong", isSupplier: true, isActive: true }
        : options.supplier,
    duplicate: async () => options.duplicate ?? null,
    create: async (input: NewListInput, entries: ParsedPriceEntry[]) => {
      if (options.createError) throw options.createError;
      created.push({ input, entries: [...entries] });
      return "list-1";
    },
    barcodes: async (codes: string[]) => {
      queried.push([...codes]);
      return options.barcodes ?? [];
    },
    existingMatches: async () =>
      new Map(Object.entries(options.existing ?? {})),
    knownCodes: async () => new Map(Object.entries(options.known ?? {})),
    saveAutoMatches: async (_supplier: string, decisions: MatchDecision[]) => {
      saved.push(decisions);
    },
  } as unknown as PriceListRepository;
  return { service: new PriceListService(repository), created, saved, queried };
}

const input = (overrides: Record<string, unknown> = {}) => ({
  supplierId: "sup-1",
  format: "DEJONG_STOCKLIST" as const,
  listDate: "2026-10-12",
  currency: "eur",
  file: { originalname: "dejong-week41.csv", buffer: DEJONG },
  userId: "user-1",
  ...overrides,
});

async function rejects<T extends Error>(
  promise: Promise<unknown>,
  type: new (...args: never[]) => T,
): Promise<string> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof type, String(error));
    return error.message;
  }
  assert.fail("expected an error");
}

/**
 * AZ ÁRLISTA FELTÖLTÉSE (task beszallitoi-arlistak-2). MI PIROSÍT: ha a rossz
 * formátumú fájl részben mentődne; ha ugyanaz a fájl kétszer bekerülne; ha a
 * jövőbeli vagy nem létező dátum átmenne; ha a pénznem nagybetűsítés nélkül
 * mentődne; ha a lista a párosítás előtt nem mentődne; ha a lista törlése a
 * kötéseket is vinné; ha egy nem beszállító kapna árlistát.
 */
describe("PriceListService.upload", () => {
  it("saves the list with the parsed rows and the uppercase currency, then matches, and reports the counts", async () => {
    const { service, created, saved } = setup({
      known: { "AAA-001": "v1" },
    });
    const result = await service.upload(input(), NOW);
    assert.equal(created.length, 1);
    assert.deepEqual(
      [
        created[0]!.input.currency,
        created[0]!.input.format,
        created[0]!.input.rowCount,
      ],
      ["EUR", "DEJONG_STOCKLIST", 2],
    );
    assert.equal(
      created[0]!.input.listDate.toISOString().slice(0, 10),
      "2026-10-12",
    );
    assert.equal(created[0]!.input.sourceSha256.length, 64);
    assert.deepEqual(
      created[0]!.entries.map((e) => [e.supplierSku, e.unitPrice]),
      [
        ["AAA-001", "165"],
        ["AAA-002", "138.89"],
      ],
    );
    assert.equal(result.listId, "list-1");
    assert.deepEqual(
      [
        result.rowCount,
        result.rejectedRowCount,
        result.skippedRows,
        result.currency,
      ],
      [2, 0, 1, "EUR"],
    );
    assert.deepEqual(result.matching, {
      alreadyMatched: 0,
      autoByEan: 0,
      autoByCode: 1,
      conflicts: 0,
      unmatched: 1,
    });
    assert.equal(saved.length, 1);
    assert.deepEqual(
      saved[0]!.map((d) => d.kind),
      ["NEW_AUTO", "UNMATCHED"],
    );
  });

  it("refuses a file of the wrong format as a whole: nothing is saved, nothing matched", async () => {
    const { service, created, saved } = setup();
    const message = await rejects(
      service.upload(
        input({
          format: "HERTLEIN_ARTIKEL",
        }),
        NOW,
      ),
      BadRequestException,
    );
    assert.match(message, /fejlécsor/);
    assert.deepEqual([created, saved], [[], []]);
  });

  it("refuses the same file twice for the same supplier, and names the earlier upload", async () => {
    const { service, created } = setup({
      duplicate: {
        id: "old",
        listDate: new Date("2026-10-05T00:00:00.000Z"),
        sourceFileName: "dejong-week40.csv",
        createdAt: new Date("2026-10-06T08:00:00.000Z"),
      },
    });
    const message = await rejects(
      service.upload(input(), NOW),
      ConflictException,
    );
    assert.match(message, /dejong-week40\.csv/);
    assert.match(message, /töröld/);
    assert.deepEqual(created, []);
  });

  it("answers a concurrent identical upload (the unique index fails on save) with the same 409, not a 500", async () => {
    const { service, saved } = setup({
      createError: new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "test",
      }),
    });
    const message = await rejects(
      service.upload(input(), NOW),
      ConflictException,
    );
    assert.match(message, /közben már feltöltötték/);
    assert.deepEqual(saved, []);
  });

  it("does not turn any other save error into a 409", async () => {
    const { service } = setup({ createError: new Error("lemez tele") });
    await assert.rejects(service.upload(input(), NOW), /lemez tele/);
  });

  it("refuses a supplier that does not exist or is not a supplier", async () => {
    for (const supplier of [
      null,
      { id: "sup-1", name: "Szerviz Kft.", isSupplier: false, isActive: true },
    ]) {
      const { service, created } = setup({ supplier });
      await rejects(service.upload(input(), NOW), NotFoundException);
      assert.deepEqual(created, []);
    }
  });

  it("refuses a date that is not a day or is in the future, and a currency that is not three letters", async () => {
    const { service, created } = setup();
    for (const listDate of [
      "2026-02-30",
      "2026-13-01",
      "2026-10-25",
      "2099-01-01",
    ])
      await rejects(
        service.upload(input({ listDate }), NOW),
        BadRequestException,
      );
    for (const currency of ["EURO", "E1R", "", "  "])
      await rejects(
        service.upload(input({ currency }), NOW),
        BadRequestException,
      );
    assert.deepEqual(created, []);
  });

  it("asks the barcode table only about rows that carry a barcode", async () => {
    const { service, queried } = setup();
    await service.upload(input(), NOW);
    assert.deepEqual(queried, [[]]);
  });
});

describe("parseListDate", () => {
  it("accepts today and yesterday, and one day ahead for the time zone, not more", () => {
    assert.equal(
      parseListDate("2026-10-23", NOW).toISOString(),
      "2026-10-23T00:00:00.000Z",
    );
    assert.equal(
      parseListDate("2026-10-24", NOW).toISOString(),
      "2026-10-24T00:00:00.000Z",
    );
    assert.throws(() => parseListDate("2026-10-25", NOW), BadRequestException);
    assert.equal(parseListDate("2026-01-01", NOW).getUTCFullYear(), 2026);
  });
});

describe("PriceListService.remove", () => {
  it("deletes through the repository with the user, and says how many rows went", async () => {
    const calls: unknown[] = [];
    const repository = {
      remove: async (id: string, userId: string) => {
        calls.push([id, userId]);
        return { rowCount: 7, sourceFileName: "x.csv" };
      },
    } as unknown as PriceListRepository;
    const result = await new PriceListService(repository).remove(
      "list-1",
      "user-1",
    );
    assert.deepEqual(result, { removedRows: 7 });
    assert.deepEqual(calls, [["list-1", "user-1"]]);
  });

  it("says the list does not exist", async () => {
    const repository = {
      remove: async () => null,
    } as unknown as PriceListRepository;
    await rejects(
      new PriceListService(repository).remove("nope", "u"),
      NotFoundException,
    );
  });
});
