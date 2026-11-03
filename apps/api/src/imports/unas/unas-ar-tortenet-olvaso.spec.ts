import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TUKOR_SOR,
  utolsoTukorArSor,
  type TukorSorTranzakcio,
} from "./unas-ar-tortenet-olvaso.js";

/*
  MI PIROSIT (T4.1-D2, barracuda #2106): ha a szinkron "utolso ar" lekerdezese a termek MINDEN
  sorat latna, egy OWN (sajat ar, variantId kitoltve) sort is: egy UNAS-ra visszakerult termeken
  az elso szinkron a sajat arhoz merne a valtozast. A szuro a lekerdezesben all, tehat itt a
  KERT where-t mérjuk, nem egy hamis tabla viselkedeset.
*/

function fake() {
  const calls: unknown[] = [];
  const tx: TukorSorTranzakcio = {
    productPriceHistory: {
      findFirst: async (args: unknown) => {
        calls.push(args);
        return null;
      },
    },
  };
  return { tx, calls };
}

describe("a tukor-elozmeny olvasoi", () => {
  it("a tukor-szuro a variantId: null", () => {
    assert.deepEqual(TUKOR_SOR, { variantId: null });
  });

  it("az utolso tukor-sor lekerdezese megmondja, hogy tukor-sort kerdez, es a legujabbat", async () => {
    const { tx, calls } = fake();
    await utolsoTukorArSor(tx, "p1");
    const args = calls[0] as { where: unknown; orderBy: unknown };
    assert.deepEqual(args.where, { productId: "p1", variantId: null });
    assert.deepEqual(args.orderBy, [
      { observedAt: "desc" },
      { createdAt: "desc" },
    ]);
  });
});
