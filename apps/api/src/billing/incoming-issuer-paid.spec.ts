import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isIssuerPaid, type IssuerPaidRow } from "./incoming-issuer-paid.js";

/*
  A SZÁMLÁN ÁLLÓ „FIZETVE” (acrobot 58529, 58530). MI PIROSÍT: ha a pontos „Fizetve” (bármilyen írásmóddal) nem kifizetett; ha egy hasonló szöveg („Nem fizetve”,
  „Fizetve részben”, „Fizetendő”, átutalás, kártya, üres) kifizetett lenne; ha a Számlázz.hu fizetés-nyilvántartása (akár nulla) mellett is felülírna; ha a
  postafiókos vagy a beszerzésből jött sorra is hatna.
*/
const row = (over: Partial<IssuerPaidRow> = {}): IssuerPaidRow => ({
  source: "SZAMLAZZ",
  paymentsKnown: false,
  paymentMethod: "Fizetve",
  ...over,
});

describe("a számlán álló „Fizetve”", () => {
  it("a pontos szöveg kifizetett, írásmódtól függetlenül (kisbetű, szóköz, írásjel, ékezetes betűk)", () => {
    for (const method of [
      "Fizetve",
      "fizetve",
      " FIZETVE ",
      "Fizetve.",
      "Fizetve!",
    ])
      assert.equal(isIssuerPaid(row({ paymentMethod: method })), true, method);
  });

  it("a hasonló szöveg nem: nem fizetve, részben, fizetendő, más mód, üres, hiányzó", () => {
    for (const method of [
      "Nem fizetve",
      "Fizetve részben",
      "Részben fizetve",
      "Fizetendő",
      "átutalás",
      "Bankkártya",
      "készpénz",
      "",
      "   ",
    ])
      assert.equal(isIssuerPaid(row({ paymentMethod: method })), false, method);
    assert.equal(isIssuerPaid(row({ paymentMethod: null })), false);
  });

  it("ha a Számlázz.hu ismer fizetést (akár nullát is), az ő nyilvántartása nyer", () => {
    assert.equal(isIssuerPaid(row({ paymentsKnown: true })), false);
    assert.equal(isIssuerPaid(row({ paymentsKnown: null })), true);
  });

  it("a postafiókos és a beszerzésből jött sorra nem hat", () => {
    for (const source of ["MAILBOX", "PURCHASE"])
      assert.equal(isIssuerPaid(row({ source })), false, source);
    assert.equal(isIssuerPaid(row({ source: "SZAMLAZZ" })), true);
  });
});
