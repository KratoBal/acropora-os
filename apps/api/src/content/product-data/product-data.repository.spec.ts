import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  categoryDescendants,
  productDataWhere,
} from "./product-data.repository.js";

/*
  WHAT TURNS THIS RED: an identifier lookup that matches only ids (a SKU would be "not found"); an on-sale listing that
  includes a taken-over product's frozen mirror sale, or inactive/archived products; a category listing that stops at the
  named category and misses its subcategories.
*/
const NOW = new Date("2026-11-12T08:00:00Z");

describe("productDataWhere", () => {
  it("an identifier is a product id OR a variant SKU", () => {
    const where = productDataWhere({ identifiers: ["x"] }, NOW);
    assert.deepEqual(where, {
      AND: [
        {
          OR: [
            { id: { in: ["x"] } },
            { variants: { some: { sku: { in: ["x"] } } } },
          ],
        },
      ],
    });
  });

  it("an explicit lookup does NOT hide inactive or archived products (the agent asked for that one)", () => {
    assert.ok(
      !JSON.stringify(productDataWhere({ identifiers: ["x"] }, NOW)).includes(
        "archivedAt",
      ),
    );
  });

  it("on sale: active only, and the mirror sale counts for UNAS-owned products only", () => {
    const text = JSON.stringify(productDataWhere({ onSale: true }, NOW));
    assert.ok(text.includes('"archivedAt":null'));
    assert.ok(text.includes('"isActive":true'));
    const where = productDataWhere({ onSale: true }, NOW);
    const branches = (where.AND as { OR?: unknown[] }[]).find((c) => c.OR)!
      .OR as {
      catalogAuthority: string;
      unasSnapshot?: unknown;
      variants?: unknown;
    }[];
    const unas = branches.find((b) => b.catalogAuthority === "UNAS")!;
    const own = branches.find((b) => b.catalogAuthority === "ACROPORA")!;
    assert.ok(unas.unasSnapshot && !unas.variants);
    assert.ok(own.variants && !own.unasSnapshot);
  });
});

describe("categoryDescendants", () => {
  const edges = [
    { id: "root", parentId: null },
    { id: "a", parentId: "root" },
    { id: "b", parentId: "a" },
    { id: "other", parentId: null },
  ];
  it("includes the named category and everything below it, nothing else", () => {
    assert.deepEqual(categoryDescendants(["a"], edges).sort(), ["a", "b"]);
    assert.deepEqual(categoryDescendants(["root"], edges).sort(), [
      "a",
      "b",
      "root",
    ]);
  });
  it("survives a cycle and keeps an unknown id as itself", () => {
    const loop = [
      { id: "x", parentId: "y" },
      { id: "y", parentId: "x" },
    ];
    assert.deepEqual(categoryDescendants(["x"], loop).sort(), ["x", "y"]);
    assert.deepEqual(categoryDescendants(["ghost"], edges), ["ghost"]);
  });
});
