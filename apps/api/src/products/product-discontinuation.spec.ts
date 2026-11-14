// The DTO decorators read their metadata through `Reflect`; the import has to come before the DTO module.
import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { SetProductDiscontinuationDto } from "./dto/set-product-discontinuation.dto.js";
import {
  MarkRefused,
  ProductDiscontinuationRepository,
  type ProductDiscontinuationDatabase,
} from "./product-discontinuation.repository.js";
import { ProductDiscontinuationService } from "./product-discontinuation.service.js";

interface FakeProduct {
  id: string;
  name: string;
  isActive: boolean;
  webshopSellable: boolean;
}

/**
 * An in-memory database with the same calls the repository makes. It records every WRITE, so a refusal can be
 * measured as "nothing was written", not only as "an error came back".
 */
function fixture(options: {
  products: FakeProduct[];
  marks?: Array<{ productId: string; replacementProductId: string | null }>;
}) {
  const products = new Map(options.products.map((p) => [p.id, p]));
  const marks = new Map(
    (options.marks ?? []).map((m, index) => [
      m.productId,
      { id: `mark-${index + 1}`, ...m },
    ]),
  );
  const writes: Array<{ what: string; args: unknown }> = [];
  const isolation: unknown[] = [];
  const view = (productId: string) => {
    const mark = marks.get(productId);
    if (!mark) return null;
    const replacement = mark.replacementProductId
      ? (products.get(mark.replacementProductId) ?? null)
      : null;
    return {
      id: mark.id,
      productId: mark.productId,
      replacementProductId: mark.replacementProductId,
      updatedAt: new Date("2026-11-14T20:00:00.000Z"),
      replacementProduct: replacement
        ? { id: replacement.id, name: replacement.name }
        : null,
    };
  };
  const reads = {
    product: {
      findUnique: async (args: { where: { id: string } }) =>
        products.get(args.where.id) ?? null,
    },
    productDiscontinuation: {
      findUnique: async (args: { where: { productId: string } }) =>
        view(args.where.productId),
    },
  };
  const transaction = {
    ...reads,
    productDiscontinuation: {
      ...reads.productDiscontinuation,
      create: async (args: {
        data: { productId: string; replacementProductId: string | null };
      }) => {
        writes.push({ what: "mark.create", args: args.data });
        marks.set(args.data.productId, {
          id: `mark-${marks.size + 1}`,
          ...args.data,
        });
        return view(args.data.productId)!;
      },
      update: async (args: {
        where: { productId: string };
        data: { replacementProductId: string | null };
      }) => {
        writes.push({ what: "mark.update", args: args.data });
        marks.get(args.where.productId)!.replacementProductId =
          args.data.replacementProductId;
        return view(args.where.productId)!;
      },
      delete: async (args: { where: { productId: string } }) => {
        writes.push({ what: "mark.delete", args: args.where });
        marks.delete(args.where.productId);
      },
    },
    auditLog: {
      create: async (args: unknown) => {
        writes.push({ what: "audit", args });
      },
    },
    domainEvent: {
      create: async (args: unknown) => {
        writes.push({ what: "event", args });
      },
    },
  };
  const database = {
    ...reads,
    $transaction: async <T>(
      operation: (tx: typeof transaction) => Promise<T>,
      opts: { isolationLevel: string },
    ) => {
      isolation.push(opts.isolationLevel);
      return operation(transaction);
    },
  } as unknown as ProductDiscontinuationDatabase;
  const repository = new ProductDiscontinuationRepository(database);
  return {
    repository,
    service: new ProductDiscontinuationService(repository),
    writes,
    isolation,
    marks,
  };
}

const OLD: FakeProduct = {
  id: "old",
  name: "Régi termék",
  isActive: false,
  webshopSellable: false,
};
const NEWER: FakeProduct = {
  id: "newer",
  name: "Új termék",
  isActive: true,
  webshopSellable: true,
};

describe("the manual permanent-discontinuation mark (V4.2)", () => {
  it("creates the mark without a replacement, with an audit row and an event that carry before and after", async () => {
    const f = fixture({ products: [OLD, NEWER] });
    const detail = await f.service.set("old", undefined, "user-1");
    assert.deepEqual(detail, {
      productId: "old",
      replacement: null,
      updatedAt: "2026-11-14T20:00:00.000Z",
    });
    assert.deepEqual(
      f.writes.map((w) => w.what),
      ["mark.create", "audit", "event"],
    );
    const audit = f.writes[1]!.args as {
      data: { action: string; userId: string; metadata: unknown };
    };
    assert.equal(audit.data.action, "product_discontinuation.created");
    assert.equal(audit.data.userId, "user-1");
    assert.deepEqual(audit.data.metadata, {
      productId: "old",
      before: null,
      after: { replacementProductId: null },
    });
    assert.deepEqual(f.isolation, ["Serializable"]);
  });

  it("sets a sellable replacement, then changes it: the second write is an update with the old value as before", async () => {
    const other: FakeProduct = { ...NEWER, id: "other", name: "Másik" };
    const f = fixture({ products: [OLD, NEWER, other] });
    const first = await f.service.set("old", "newer", "user-1");
    assert.deepEqual(first.replacement, { id: "newer", name: "Új termék" });
    const second = await f.service.set("old", "other", "user-2");
    assert.deepEqual(second.replacement, { id: "other", name: "Másik" });
    assert.deepEqual(
      f.writes.filter((w) => w.what.startsWith("mark.")).map((w) => w.what),
      ["mark.create", "mark.update"],
    );
    const audits = f.writes.filter((w) => w.what === "audit") as Array<{
      args: { data: { action: string; metadata: unknown } };
    }>;
    assert.equal(
      audits[1]!.args.data.action,
      "product_discontinuation.updated",
    );
    assert.deepEqual(audits[1]!.args.data.metadata, {
      productId: "old",
      before: { replacementProductId: "newer" },
      after: { replacementProductId: "other" },
    });
  });

  it("saving again without a replacement clears the old one (the body is the whole state)", async () => {
    const f = fixture({ products: [OLD, NEWER] });
    await f.service.set("old", "newer", "user-1");
    const cleared = await f.service.set("old", null, "user-1");
    assert.equal(cleared.replacement, null);
  });

  const refusals: Array<
    [
      string,
      () => ReturnType<typeof fixture>,
      string,
      string | null,
      new (...a: never[]) => Error,
    ]
  > = [
    [
      "an unknown product",
      () => fixture({ products: [NEWER] }),
      "ghost",
      null,
      NotFoundException,
    ],
    [
      "a product as its own replacement",
      () => fixture({ products: [OLD] }),
      "old",
      "old",
      BadRequestException,
    ],
    [
      "an unknown replacement",
      () => fixture({ products: [OLD] }),
      "old",
      "ghost",
      BadRequestException,
    ],
    [
      "an inactive replacement",
      () =>
        fixture({
          products: [OLD, { ...NEWER, isActive: false }],
        }),
      "old",
      "newer",
      BadRequestException,
    ],
    [
      "a replacement that is not marked for the webshop",
      () =>
        fixture({
          products: [OLD, { ...NEWER, webshopSellable: false }],
        }),
      "old",
      "newer",
      BadRequestException,
    ],
    [
      "a replacement that is itself permanently discontinued (a chain)",
      () =>
        fixture({
          products: [OLD, NEWER],
          marks: [{ productId: "newer", replacementProductId: null }],
        }),
      "old",
      "newer",
      BadRequestException,
    ],
  ];
  for (const [name, build, productId, replacementId, errorClass] of refusals) {
    it(`refuses ${name} and writes NOTHING`, async () => {
      const f = build();
      await assert.rejects(
        () => f.service.set(productId, replacementId, "user-1"),
        errorClass,
      );
      assert.deepEqual(f.writes, []);
    });
  }

  it("un-marking deletes the row and logs the removal with the old replacement", async () => {
    const f = fixture({
      products: [OLD, NEWER],
      marks: [{ productId: "old", replacementProductId: "newer" }],
    });
    await f.service.remove("old", "user-1");
    assert.deepEqual(
      f.writes.map((w) => w.what),
      ["mark.delete", "audit", "event"],
    );
    const audit = f.writes[1]!.args as {
      data: { action: string; metadata: unknown };
    };
    assert.equal(audit.data.action, "product_discontinuation.removed");
    assert.deepEqual(audit.data.metadata, {
      productId: "old",
      before: { replacementProductId: "newer" },
      after: null,
    });
    assert.equal(f.marks.size, 0);
  });

  it("un-marking a product nobody marked is a 404 and writes nothing", async () => {
    const f = fixture({ products: [OLD] });
    await assert.rejects(
      () => f.service.remove("old", "user-1"),
      NotFoundException,
    );
    assert.deepEqual(f.writes, []);
  });

  it("reading: null for an unmarked product, the detail for a marked one, a 404 for an unknown product", async () => {
    const f = fixture({
      products: [OLD, NEWER],
      marks: [{ productId: "old", replacementProductId: "newer" }],
    });
    assert.equal(await f.service.get("newer"), null);
    assert.equal((await f.service.get("old"))?.replacement?.id, "newer");
    await assert.rejects(() => f.service.get("ghost"), NotFoundException);
  });

  it("a refusal that is not a MarkRefused (a database error) is not turned into a 400", async () => {
    const f = fixture({ products: [OLD] });
    const boom = new Error("connection lost");
    f.repository.set = async () => {
      throw boom;
    };
    await assert.rejects(() => f.service.set("old", null, "user-1"), boom);
    assert.ok(!(boom instanceof MarkRefused));
  });
});

describe("SetProductDiscontinuationDto", () => {
  const check = (body: unknown) =>
    validateSync(plainToInstance(SetProductDiscontinuationDto, body)).length;

  it("accepts a missing, a null and a string replacement", () => {
    assert.equal(check({}), 0);
    assert.equal(check({ replacementProductId: null }), 0);
    assert.equal(check({ replacementProductId: "cm0abc" }), 0);
  });

  it("rejects a number and an over-long id", () => {
    assert.equal(check({ replacementProductId: 5 }) > 0, true);
    assert.equal(check({ replacementProductId: "x".repeat(65) }) > 0, true);
  });
});
