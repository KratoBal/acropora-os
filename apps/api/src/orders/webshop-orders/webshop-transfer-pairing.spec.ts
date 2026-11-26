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

/*
  THE BALANCE AFTER AN ADVANCE (card d31a66a3, S5): its target is the advance proforma's number with the remaining amount. WHAT
  TURNS RED: the advance's own transfer (manually recorded, so still free) makes every balance a review; a credit from before the
  advance pays the balance; a credit without a booking day passes the day check; two equal halves (advance = balance) are told
  apart by guess.
*/
describe("pairing the balance after an advance", () => {
  const balance = (over: Partial<PairingProforma> = {}): PairingProforma => ({
    ...proforma("balance:b", "D-ACR-2026-7", "8200.0000"),
    since: "2026-11-20",
    alreadyReceived: "4800.0000",
    amountOf: "a hátraléké",
    ...over,
  });
  const on = (day: string) => ({ bookingDate: day });

  it("the advance's own transfer on the same number does not count, the balance's pairs", () => {
    const decisions = pairTransfers(
      [balance()],
      [
        credit("advance", "D-ACR-2026-7", "4800.00", on("2026-11-20")),
        credit("rest", "D ACR 2026 7", "8200.00", on("2026-11-25")),
      ],
    );
    assert.deepEqual(decisions.get("balance:b"), {
      kind: "paired",
      transactionId: "rest",
    });
  });

  it("a credit booked before the advance, or without a booking day, does not pay the balance", () => {
    const decisions = pairTransfers(
      [balance()],
      [
        credit("before", "D-ACR-2026-7", "8200.00", on("2026-11-19")),
        credit("undated", "D-ACR-2026-7", "8200.00"),
      ],
    );
    assert.deepEqual(decisions.get("balance:b"), { kind: "none" });
  });

  it("a balance equal to the advance cannot be told from it: both credits go to review", () => {
    const decisions = pairTransfers(
      [balance({ grossAmount: "4800.0000" })],
      [
        credit("advance", "D-ACR-2026-7", "4800.00", on("2026-11-20")),
        credit("rest", "D-ACR-2026-7", "4800.00", on("2026-11-25")),
      ],
    );
    const decision = decisions.get("balance:b");
    assert.equal(decision?.kind, "review");
    assert.deepEqual(
      decision?.kind === "review" ? decision.transactionIds : [],
      ["advance", "rest"],
    );
  });

  // barracuda on #2982: the advance recorded by hand leaves its own credit free; with an equal balance it must not pay it
  it("a balance equal to the advance never pairs, even when the advance's own credit is the only one", () => {
    const decision = pairTransfers(
      [balance({ grossAmount: "4800.0000" })],
      [credit("advance", "D-ACR-2026-7", "4800.00", on("2026-11-21"))],
    ).get("balance:b");
    assert.equal(decision?.kind, "review");
    assert.deepEqual(
      decision?.kind === "review" ? decision.transactionIds : [],
      ["advance"],
    );
    assert.match(
      decision?.kind === "review" ? decision.reason : "",
      /Már beérkezett ugyanennyi \(4800 HUF\)/,
    );
  });

  it("a different remaining amount goes to review with both amounts", () => {
    const decision = pairTransfers(
      [balance()],
      [credit("rest", "D-ACR-2026-7", "8000.00", on("2026-11-25"))],
    ).get("balance:b");
    assert.equal(decision?.kind, "review");
    assert.match(
      decision?.kind === "review" ? decision.reason : "",
      /összege 8000 HUF, a hátraléké 8200 HUF/,
    );
  });
});
