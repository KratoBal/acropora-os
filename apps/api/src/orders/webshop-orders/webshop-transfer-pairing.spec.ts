import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  narrativeNames,
  pairTransfers,
  type PairingCredit,
  type PairingProforma,
} from "./webshop-transfer-pairing.js";

/*
  AZ ELŐRE UTALÁS PÁROSÍTÁSA (bb3a6bd5). MI PIROSÍT:
  - egy hosszabb számra (D-12) hivatkozó utalás a rövidebbet (D-1) fizeti ki;
  - a szóközzel, kötőjel nélkül vagy kisbetűvel írt szám nem párosul;
  - eltérő összeg, terhelés vagy más deviza mégis párosul;
  - két jelölt utalásból az egyik csendben nyer;
  - egy kétszámú közlemény két díjbekérőt is kifizet;
  - a fillér alatti eltérés egyezésnek számít.
*/
const proforma = (
  id: string,
  number: string,
  grossAmount = "4800.0000",
): PairingProforma => ({
  id,
  orderId: `order_${id}`,
  number,
  grossAmount,
  currency: "HUF",
});
const credit = (
  id: string,
  narrative: string,
  amount = "4800.00",
  over: Partial<PairingCredit> = {},
): PairingCredit => ({
  id,
  direction: "CREDIT",
  amount,
  currency: "HUF",
  narrative,
  ...over,
});

describe("the narrative names the proforma", () => {
  it("in any spelling of the separators and case, never as part of a longer number", () => {
    for (const narrative of [
      "D-ACR-2026-1",
      "dijbekero d-acr-2026-1 rendeles 55",
      "D ACR 2026 1",
      "DACR20261",
      "Teszt Elek / D-ACR-2026-1.",
    ])
      assert.equal(narrativeNames(narrative, "D-ACR-2026-1"), true, narrative);
    for (const narrative of [
      "D-ACR-2026-12",
      "DACR202612",
      "XD-ACR-2026-1",
      "",
    ])
      assert.equal(narrativeNames(narrative, "D-ACR-2026-1"), false, narrative);

    // EGY SZÓKÖZZEL KETTÉVÁGOTT SZÁMJEGY KÉTÉRTELMŰ: a D-…-1-et nevezi meg,
    // és a párosítást az összeg dönti el (nem szó-töredék, hanem külön szó)
    assert.equal(narrativeNames("D-ACR-2026-1 2", "D-ACR-2026-1"), true);
  });
});

describe("pairing the transfers to the proformas", () => {
  it("pairs the one credit that names the number with exactly the gross amount", () => {
    const result = pairTransfers(
      [proforma("p1", "D-ACR-2026-1"), proforma("p2", "D-ACR-2026-2")],
      [
        credit("t1", "D-ACR-2026-1", "4800"),
        credit("t9", "fizetés rendelésért"),
      ],
    );
    assert.deepEqual(result.get("p1"), { kind: "paired", transactionId: "t1" });
    assert.deepEqual(result.get("p2"), { kind: "none" });
  });

  it("a different amount goes to review, with both amounts named", () => {
    const result = pairTransfers(
      [proforma("p1", "D-ACR-2026-1")],
      [credit("t1", "D-ACR-2026-1", "4000.00")],
    );
    assert.deepEqual(result.get("p1"), {
      kind: "review",
      reason: "Az utalás összege 4000 HUF, a díjbekérőé 4800 HUF.",
      transactionIds: ["t1"],
    });
    const sub = pairTransfers(
      [proforma("p1", "D-ACR-2026-1")],
      [credit("t1", "D-ACR-2026-1", "4800.004")],
    );
    assert.equal(sub.get("p1")!.kind, "review");
  });

  it("a debit or another currency is not a payment", () => {
    const result = pairTransfers(
      [proforma("p1", "D-ACR-2026-1")],
      [
        credit("t1", "D-ACR-2026-1", "4800", { direction: "DEBIT" }),
        credit("t2", "D-ACR-2026-1", "4800", { currency: "EUR" }),
      ],
    );
    assert.deepEqual(result.get("p1"), { kind: "none" });
  });

  it("two credits for one proforma: neither wins silently", () => {
    const result = pairTransfers(
      [proforma("p1", "D-ACR-2026-1")],
      [credit("t1", "D-ACR-2026-1"), credit("t2", "D ACR 2026 1")],
    );
    const decision = result.get("p1")!;
    assert.equal(decision.kind, "review");
    assert.deepEqual(
      decision.kind === "review" ? decision.transactionIds : null,
      ["t1", "t2"],
    );
  });

  it("one credit naming two proformas pays neither", () => {
    const result = pairTransfers(
      [proforma("p1", "D-ACR-2026-1"), proforma("p2", "D-ACR-2026-2")],
      [credit("t1", "D-ACR-2026-1 és D-ACR-2026-2")],
    );
    assert.equal(result.get("p1")!.kind, "review");
    assert.equal(result.get("p2")!.kind, "review");
  });
});
