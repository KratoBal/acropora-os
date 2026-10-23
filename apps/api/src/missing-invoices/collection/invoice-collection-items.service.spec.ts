import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";

import type {
  CollectionItemRow,
  InvoiceCollectionItemsRepository,
} from "./invoice-collection-items.repository.js";
import {
  COLLECTION_ITEMS_DEFAULT_LIMIT,
  COLLECTION_ITEMS_MAX_LIMIT,
  InvoiceCollectionItemsService,
  parseLimit,
} from "./invoice-collection-items.service.js";

function row(
  n: number,
  overrides: Partial<CollectionItemRow> = {},
): CollectionItemRow {
  return {
    id: `item-${n}`,
    source: "INFO_MAIL",
    externalId: `msg-${n}`,
    fileName: `file-${n}.pdf`,
    verdict: "UNMATCHED",
    documentId: null,
    createdAt: new Date(Date.UTC(2026, 9, 22, 14, n)),
    ...overrides,
  };
}

function setup(
  rows: CollectionItemRow[],
  counts: Array<{ verdict: string; count: number }> = [],
) {
  const calls: { list: unknown[]; counts: unknown[] } = {
    list: [],
    counts: [],
  };
  const repository = {
    list: async (filter: unknown, take: number) => {
      calls.list.push({ filter, take });
      return rows.slice(0, take);
    },
    counts: async (source?: string) => {
      calls.counts.push(source);
      return counts;
    },
  } as unknown as InvoiceCollectionItemsRepository;
  return { service: new InvoiceCollectionItemsService(repository), calls };
}

async function rejects(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof BadRequestException, String(error));
    return error.message;
  }
  assert.fail("expected a BadRequestException");
}

describe("InvoiceCollectionItemsService", () => {
  it("returns the items with ISO dates, no file content, and asks for one row more than the limit", async () => {
    const { service, calls } = setup([row(1), row(2)]);
    const result = await service.list({});
    assert.deepEqual(calls.list, [
      {
        filter: { verdict: undefined, source: undefined },
        take: COLLECTION_ITEMS_DEFAULT_LIMIT + 1,
      },
    ]);
    assert.equal(result.limit, COLLECTION_ITEMS_DEFAULT_LIMIT);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.items[0], {
      id: "item-1",
      source: "INFO_MAIL",
      externalId: "msg-1",
      fileName: "file-1.pdf",
      verdict: "UNMATCHED",
      documentId: null,
      createdAt: "2026-10-22T14:01:00.000Z",
    });
  });

  it("marks the list truncated when there is more than the limit, and returns only the limit", async () => {
    const { service } = setup([row(1), row(2), row(3)]);
    const result = await service.list({ limit: "2" });
    assert.equal(result.items.length, 2);
    assert.equal(result.truncated, true);
    assert.deepEqual(
      result.items.map((item) => item.id),
      ["item-1", "item-2"],
    );
  });

  it("passes the verdict and the source filter to the list, and the source ONLY to the counts", async () => {
    const { service, calls } = setup([]);
    await service.list({ verdict: "UNMATCHED", source: "BALAZS_MAIL" });
    assert.deepEqual(calls.list, [
      {
        filter: { verdict: "UNMATCHED", source: "BALAZS_MAIL" },
        take: COLLECTION_ITEMS_DEFAULT_LIMIT + 1,
      },
    ]);
    assert.deepEqual(calls.counts, ["BALAZS_MAIL"]);
  });

  it("gives every verdict a count, zero where the table has none, and ignores a verdict it does not know", async () => {
    const { service } = setup(
      [],
      [
        { verdict: "UNMATCHED", count: 33 },
        { verdict: "STORED", count: 410 },
        { verdict: "SOMETHING_NEW", count: 7 },
      ],
    );
    const { counts } = await service.list({});
    assert.deepEqual(counts, {
      STORED: 410,
      SUGGESTED: 0,
      UNMATCHED: 33,
      NOT_INVOICE: 0,
      OWN_INVOICE: 0,
      DUPLICATE: 0,
      TOO_LARGE: 0,
      UNREADABLE: 0,
    });
  });

  it("refuses an unknown verdict or source instead of returning an empty list", async () => {
    const { service } = setup([]);
    assert.match(
      await rejects(service.list({ verdict: "unmatched" })),
      /ítélet/,
    );
    assert.match(await rejects(service.list({ source: "GMAIL" })), /forrás/);
  });

  it("treats an empty verdict or source as no filter", async () => {
    const { service, calls } = setup([]);
    await service.list({ verdict: "", source: "" });
    assert.deepEqual(calls.list, [
      {
        filter: { verdict: undefined, source: undefined },
        take: COLLECTION_ITEMS_DEFAULT_LIMIT + 1,
      },
    ]);
  });
});

describe("parseLimit", () => {
  it("defaults, and accepts 1 up to the maximum", () => {
    assert.equal(parseLimit(undefined), COLLECTION_ITEMS_DEFAULT_LIMIT);
    assert.equal(parseLimit(""), COLLECTION_ITEMS_DEFAULT_LIMIT);
    assert.equal(parseLimit("1"), 1);
    assert.equal(
      parseLimit(String(COLLECTION_ITEMS_MAX_LIMIT)),
      COLLECTION_ITEMS_MAX_LIMIT,
    );
  });

  it("refuses 0, above the maximum, fractions and text", () => {
    for (const bad of [
      "0",
      String(COLLECTION_ITEMS_MAX_LIMIT + 1),
      "1.5",
      "abc",
      "-3",
    ])
      assert.throws(() => parseLimit(bad), BadRequestException, bad);
  });
});
