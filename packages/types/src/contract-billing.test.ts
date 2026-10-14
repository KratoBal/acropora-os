import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  contractBilling,
  contractOverbillingProblem,
} from "./contract-billing.js";

// Feladat d510 (Balázs 2026-10-14): jelezze a számlázást, teljesnél zárjon le,
// részteljesítésnél a következő számla csak a maradékot engedje.
// MI PIROSÍT: ha az állapot nem a számlázott mennyiségből jön (NONE / PARTIAL /
// FULL), ha a maradék nem a szerződés mínusz a számlázott, ha a túlszámlázás
// átmegy (egy soron vagy több sor összegén), ha egy idegen tétel átmegy, vagy ha
// a hibaüzenet nem nevezi meg a tételt és a maradékot.
const items = [
  { id: "a", quantity: "10" },
  { id: "b", quantity: "2.5" },
];

describe("contractBilling", () => {
  it("CB-STATE: none, partial and full follow the invoiced quantities", () => {
    assert.equal(contractBilling(items, []).state, "NONE");
    assert.equal(
      contractBilling(items, [{ contractItemId: "a", quantity: "4" }]).state,
      "PARTIAL",
    );
    assert.equal(
      contractBilling(items, [
        { contractItemId: "a", quantity: "4" },
        { contractItemId: "a", quantity: "6" },
        { contractItemId: "b", quantity: "2.5" },
      ]).state,
      "FULL",
    );
    // no items: nothing to bill, never "full"
    assert.equal(contractBilling([], []).state, "NONE");
  });

  it("CB-REMAINING: per item the contract minus the invoiced; an over-invoiced item shows 0 left and the flag", () => {
    const state = contractBilling(items, [
      { contractItemId: "a", quantity: "4.25" },
      { contractItemId: "b", quantity: "3" },
    ]);
    assert.deepEqual(state.items, [
      {
        contractItemId: "a",
        quantity: "10",
        invoicedQuantity: "4.25",
        remainingQuantity: "5.75",
        overInvoiced: false,
      },
      {
        contractItemId: "b",
        quantity: "2.5",
        invoicedQuantity: "3",
        remainingQuantity: "0",
        overInvoiced: true,
      },
    ]);
  });
});

describe("contractOverbillingProblem", () => {
  const billed = [{ contractItemId: "a", quantity: "7" }];

  it("CB-ALLOW: exactly the remainder, or less, passes", () => {
    assert.equal(
      contractOverbillingProblem(items, billed, [
        { contractItemId: "a", description: "Szivattyú", quantity: "3" },
      ]),
      null,
    );
    assert.equal(
      contractOverbillingProblem(items, billed, [
        { contractItemId: "b", description: "Só", quantity: "1,5" },
      ]),
      null,
    );
  });

  it("CB-REFUSE: more than the remainder, also summed over two lines, is refused with the item and the remainder", () => {
    assert.equal(
      contractOverbillingProblem(items, billed, [
        { contractItemId: "a", description: "Szivattyú", quantity: "3.5" },
      ]),
      "A(z) „Szivattyú” tételből csak 3 maradt számlázatlan, a számla pedig 3.5 egységet kér.",
    );
    assert.match(
      contractOverbillingProblem(items, billed, [
        { contractItemId: "a", description: "Szivattyú", quantity: "2" },
        { contractItemId: "a", description: "Szivattyú (2)", quantity: "2" },
      ]) ?? "",
      /csak 3 maradt.*4 egységet kér/,
    );
  });

  it("CB-FULL-ITEM: a fully invoiced item says so", () => {
    assert.equal(
      contractOverbillingProblem(
        items,
        [{ contractItemId: "b", quantity: "2.5" }],
        [{ contractItemId: "b", description: "Só", quantity: "1" }],
      ),
      "A(z) „Só” tétel már teljesen ki van számlázva a szerződésből; erre nem állítható ki újabb számla.",
    );
  });

  it("CB-FOREIGN: a line pointing at an item of another contract is refused", () => {
    assert.match(
      contractOverbillingProblem(
        items,
        [],
        [{ contractItemId: "zz", description: "Idegen", quantity: "1" }],
      ) ?? "",
      /nem ehhez a szerződéshez tartozik/,
    );
  });
});
