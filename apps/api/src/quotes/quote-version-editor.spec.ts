import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthenticatedUser } from "@acropora/types";

import { QuoteVersionEditor } from "./quote-version-editor.js";

const user = { id: "u", role: "ADMIN" } as AuthenticatedUser;
const conflict = (target: string) =>
  Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
    meta: { target: [target] },
  });

/** The create-product SKU retry (barracuda's #1594 review). */
describe("create-product retries a taken local SKU", () => {
  const editor = (failures: Error[]) => {
    const e = new QuoteVersionEditor();
    let calls = 0;
    (
      e as unknown as { createProductOnce: () => Promise<unknown> }
    ).createProductOnce = async () => {
      calls += 1;
      const next = failures.shift();
      if (next) throw next;
      return { sku: `ACR-L-00000${calls}` };
    };
    return { e, calls: () => calls };
  };

  it("a SKU conflict takes the next number", async () => {
    const { e, calls } = editor([conflict("sku")]);
    assert.deepEqual(await e.createProductFromBomItem("b", user), {
      sku: "ACR-L-000002",
    });
    assert.equal(calls(), 2);
  });

  it("gives up after three tries", async () => {
    const { e, calls } = editor([
      conflict("sku"),
      conflict("sku"),
      conflict("sku"),
    ]);
    await assert.rejects(
      e.createProductFromBomItem("b", user),
      /Unique constraint/,
    );
    assert.equal(calls(), 3);
  });

  it("another conflict is not retried", async () => {
    const { e, calls } = editor([conflict("code")]);
    await assert.rejects(
      e.createProductFromBomItem("b", user),
      /Unique constraint/,
    );
    assert.equal(calls(), 1);
  });
});
