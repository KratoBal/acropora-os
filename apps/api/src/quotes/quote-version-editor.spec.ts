import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthenticatedUser } from "@acropora/types";

import {
  QuoteVersionEditor,
  withReplacementConflict,
} from "./quote-version-editor.js";

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

/*
  KIVÁLTOTT TÉTEL (barracuda #3026): két egyidejű mentés ugyanazt a tételt váltaná ki: az egyedi index a másodikat utasítja el, és abból érthető 409
  kell, nem P2002. MI PIROSÍT: ha a replacesItemId kulcshiba nyersen megy ki; ha egy MÁS egyedi kulcs hibáját (SKU) is 409-nek nevezi; ha más hibát lenyel.
*/
describe("a concurrent second replacement is a clear 409", () => {
  it("turns the replacesItemId unique violation into a 409 with a sentence", async () => {
    await assert.rejects(
      () =>
        withReplacementConflict(async () => {
          throw conflict("replacesItemId");
        }),
      (error: { status?: number; message?: string }) =>
        error.status === 409 && /már kiváltja/.test(error.message ?? ""),
    );
  });

  it("leaves another unique violation and any other error as they are", async () => {
    const sku = conflict("sku");
    await assert.rejects(
      () => withReplacementConflict(() => Promise.reject(sku)),
      (error) => error === sku,
    );
    const other = new Error("boom");
    await assert.rejects(
      () => withReplacementConflict(() => Promise.reject(other)),
      (error) => error === other,
    );
    assert.equal(await withReplacementConflict(async () => 7), 7);
  });
});
