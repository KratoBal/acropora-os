import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import { WebshopTransferPairingScheduler } from "./webshop-transfer-pairing.scheduler.js";
import {
  WebshopTransferPairingService,
  transferPairingMode,
} from "./webshop-transfer-pairing.service.js";

/*
  THE LIVE BANK PAIRING (card d31a66a3, S5; acrobot 62407). WHAT TURNS RED:
  - the switch is on by default, or on for a value other than exactly `observe` / `write`;
  - observe mode writes, or write mode writes a review, an order no longer paid by transfer, or anything beyond the receipt
    (the fakes record every member the service touches: a notification, a shop close or an invoice would show up);
  - the receipt is not the proforma's (whole or advance) or the balance's, not the exact amount, not the booking day, or the
    reference is empty;
  - the balance's amount is not the order's total minus the advance, or a balance with nothing left to pay is a target;
  - an order the shop does not answer for stops the round, or is paired without its check;
  - the credits are loaded from a later day than the earliest target, or loaded at all with no target;
  - the store's answer (the credit already used, the order already recorded) is not what the outcome says;
  - the log carries the narrative, or repeats the same outcome every round, or a failed round stops the scheduler.
*/
type Order = {
  total: number;
  provider?: string;
};

function setup(
  over: {
    proformas?: {
      id: string;
      orderId: string;
      number: string;
      grossAmount: string;
      issuedAt?: string;
    }[];
    balances?: {
      orderId: string;
      number: string;
      advanceAmount: string;
      advanceReceivedOn: string;
    }[];
    credits?: {
      id: string;
      amount: string;
      bookingDate: string;
      narrative: string;
    }[];
    /** per order; missing: the shop does not answer */
    orders?: Record<string, Order>;
    written?: "recorded" | "credit-used" | "order-recorded";
  } = {},
) {
  const touched: string[] = [];
  const writes: Record<string, unknown>[] = [];
  const creditsSince: string[] = [];
  const watch = <T extends object>(name: string, target: T): T =>
    new Proxy(target, {
      get(object, key) {
        if (typeof key === "string" && !(key in object))
          touched.push(`${name}.${key}`);
        return Reflect.get(object, key);
      },
    });
  const repository = watch("repository", {
    pairingProformas: async () =>
      (over.proformas ?? []).map((row) => ({
        ...row,
        grossAmount: new Prisma.Decimal(row.grossAmount),
        currency: "HUF",
        issuedAt: new Date(row.issuedAt ?? "2026-11-20T09:00:00Z"),
      })),
    pairingBalances: async () =>
      (over.balances ?? []).map((row) => ({
        ...row,
        advanceAmount: new Prisma.Decimal(row.advanceAmount),
        currency: "HUF",
      })),
    pairingCredits: async (since: Date) => {
      creditsSince.push(since.toISOString());
      return (over.credits ?? []).map((row) => ({
        id: row.id,
        amount: new Prisma.Decimal(row.amount),
        currency: "HUF",
        bookingDate: new Date(`${row.bookingDate}T00:00:00Z`),
        narrative: row.narrative,
      }));
    },
    recordPairedReceipt: async (input: Record<string, unknown>) => {
      writes.push(input);
      return over.written ?? "recorded";
    },
  });
  const orders = watch("orders", {
    source: async (orderId: string) => {
      const order = over.orders?.[orderId];
      if (!order) throw new Error("shop down");
      return {
        order: {
          id: orderId,
          total: order.total,
          payment_collections: [
            {
              payment_sessions: [
                {
                  provider_id: order.provider ?? "pp_acropora_transfer",
                  status: "pending_authorization",
                },
              ],
            },
          ],
        },
        status: null,
      };
    },
  });
  const service = new WebshopTransferPairingService(
    repository as never,
    orders as never,
  );
  return { service, writes, touched, creditsSince };
}

const WHOLE = {
  id: "doc_whole",
  orderId: "order_w",
  number: "D-ACR-2026-1",
  grossAmount: "13000.0000",
};
const ADVANCE = {
  id: "doc_adv",
  orderId: "order_a",
  number: "D-ACR-2026-2",
  grossAmount: "4800.0000",
  issuedAt: "2026-11-18T10:00:00Z",
};
const BALANCE = {
  orderId: "order_b",
  number: "D-ACR-2026-3",
  advanceAmount: "4800.0000",
  advanceReceivedOn: "2026-11-21",
};
const CREDITS = [
  {
    id: "bt_whole",
    amount: "13000.00",
    bookingDate: "2026-11-22",
    narrative: "Kovacs Anna D-ACR-2026-1",
  },
  {
    id: "bt_adv",
    amount: "4800.00",
    bookingDate: "2026-11-22",
    narrative: "eloleg D ACR 2026 2",
  },
  // the balance order's advance, recorded by hand, so still free: it names the same number with the advance's amount
  {
    id: "bt_b_adv",
    amount: "4800.00",
    bookingDate: "2026-11-21",
    narrative: "D-ACR-2026-3",
  },
  {
    id: "bt_b_rest",
    amount: "8200.00",
    bookingDate: "2026-11-25",
    narrative: "hatralek D-ACR-2026-3",
  },
];
const ORDERS = {
  order_w: { total: 13000 },
  order_a: { total: 14400 },
  order_b: { total: 13000 },
};

describe("the switch of the live bank pairing", () => {
  it("is off unless exactly observe or write", () => {
    assert.equal(transferPairingMode({}), "off");
    for (const value of ["", "on", "true", "OBSERVE", " write", "1"])
      assert.equal(
        transferPairingMode({ WEBSHOP_TRANSFER_PAIRING_MODE: value }),
        "off",
        value,
      );
    assert.equal(
      transferPairingMode({ WEBSHOP_TRANSFER_PAIRING_MODE: "observe" }),
      "observe",
    );
    assert.equal(
      transferPairingMode({ WEBSHOP_TRANSFER_PAIRING_MODE: "write" }),
      "write",
    );
  });
});

describe("the live bank pairing", () => {
  it("observe: the whole order, the advance and the balance pair, and nothing is written or touched", async () => {
    const { service, writes, touched, creditsSince } = setup({
      proformas: [WHOLE, ADVANCE],
      balances: [BALANCE],
      credits: CREDITS,
      orders: ORDERS,
    });
    const run = await service.runOnce("observe");
    assert.deepEqual(writes, []);
    assert.deepEqual(touched, []);
    // the earliest target: the advance proforma's issue day
    assert.deepEqual(creditsSince, ["2026-11-18T00:00:00.000Z"]);
    assert.deepEqual(
      run.outcomes.map((row) => [
        row.target,
        row.orderId,
        row.decision,
        row.expected,
        row.transactions.map((credit) => credit.id),
        row.written,
      ]),
      [
        ["proforma", "order_w", "paired", "13000.0000", ["bt_whole"], null],
        ["proforma", "order_a", "paired", "4800.0000", ["bt_adv"], null],
        // the order's total minus the advance; the advance's own credit does not count
        ["balance", "order_b", "paired", "8200.0000", ["bt_b_rest"], null],
      ],
    );
    assert.equal(run.targets, 3);
    assert.equal(run.credits, 4);
  });

  it("write: each pairing records its receipt from the bank line, and only that", async () => {
    const { service, writes, touched } = setup({
      proformas: [WHOLE, ADVANCE],
      balances: [BALANCE],
      credits: CREDITS,
      orders: ORDERS,
    });
    const run = await service.runOnce("write");
    assert.deepEqual(touched, []);
    assert.deepEqual(
      writes.map((row) => ({
        ...row,
        amount: (row.amount as Prisma.Decimal).toFixed(4),
      })),
      [
        {
          kind: "transfer",
          proformaId: "doc_whole",
          orderId: "order_w",
          bankTransactionId: "bt_whole",
          reference: "Kovacs Anna D-ACR-2026-1",
          receivedOn: "2026-11-22",
          amount: "13000.0000",
          currency: "HUF",
        },
        {
          kind: "transfer",
          proformaId: "doc_adv",
          orderId: "order_a",
          bankTransactionId: "bt_adv",
          reference: "eloleg D ACR 2026 2",
          receivedOn: "2026-11-22",
          amount: "4800.0000",
          currency: "HUF",
        },
        {
          kind: "balance",
          orderId: "order_b",
          bankTransactionId: "bt_b_rest",
          reference: "hatralek D-ACR-2026-3",
          receivedOn: "2026-11-25",
          amount: "8200.0000",
          currency: "HUF",
        },
      ],
    );
    assert.deepEqual(
      run.outcomes.map((row) => row.written),
      ["recorded", "recorded", "recorded"],
    );
  });

  it("write: the store's refusal is the outcome (the credit already used, the order already recorded)", async () => {
    for (const answer of ["credit-used", "order-recorded"] as const) {
      const { service } = setup({
        proformas: [WHOLE],
        credits: CREDITS,
        orders: ORDERS,
        written: answer,
      });
      const run = await service.runOnce("write");
      assert.deepEqual(
        run.outcomes.map((row) => [row.decision, row.written]),
        [["paired", answer]],
      );
    }
  });

  it("write: a different amount, or an order no longer paid by transfer, goes to review and writes nothing", async () => {
    const { service, writes } = setup({
      proformas: [WHOLE, ADVANCE],
      balances: [BALANCE],
      credits: [
        { ...CREDITS[0]!, amount: "12000.00" },
        CREDITS[1]!,
        CREDITS[2]!,
        { ...CREDITS[3]!, amount: "8000.00" },
      ],
      orders: { ...ORDERS, order_a: { total: 14400, provider: "pp_stripe" } },
    });
    const run = await service.runOnce("write");
    assert.deepEqual(writes, []);
    assert.deepEqual(
      run.outcomes.map((row) => [row.orderId, row.decision, row.written]),
      [
        ["order_w", "review", null],
        ["order_a", "review", null],
        ["order_b", "review", null],
      ],
    );
    assert.match(
      run.outcomes[0]!.reason ?? "",
      /12\s000 HUF, a díjbekérőé 13\s000/,
    );
    assert.match(run.outcomes[1]!.reason ?? "", /nem előre utalásos/);
    assert.match(run.outcomes[2]!.reason ?? "", /8000 HUF, a hátraléké 8200/);
  });

  it("an order the shop does not answer for is left for the next round, the others go on", async () => {
    const { service, writes } = setup({
      proformas: [WHOLE, ADVANCE],
      balances: [BALANCE],
      credits: CREDITS,
      orders: { order_w: ORDERS.order_w },
    });
    const run = await service.runOnce("write");
    assert.equal(run.unread, 2);
    assert.deepEqual(
      writes.map((row) => row.orderId),
      ["order_w"],
    );
  });

  it("a balance with nothing left to pay is no target, and with no target no credit is read", async () => {
    const { service, creditsSince } = setup({
      balances: [BALANCE],
      credits: CREDITS,
      orders: { order_b: { total: 4800 } },
    });
    const run = await service.runOnce("observe");
    assert.deepEqual(run, {
      mode: "observe",
      targets: 0,
      credits: 0,
      unread: 0,
      outcomes: [],
    });
    assert.deepEqual(creditsSince, []);
  });

  it("a credit booked before the advance came in does not pay the balance", async () => {
    const { service } = setup({
      balances: [BALANCE],
      credits: [{ ...CREDITS[3]!, bookingDate: "2026-11-20" }],
      orders: ORDERS,
    });
    const run = await service.runOnce("observe");
    assert.equal(run.targets, 1);
    assert.deepEqual(run.outcomes, []);
  });

  it("the reference is the narrative, trimmed", async () => {
    const { service, writes } = setup({
      proformas: [WHOLE],
      credits: [{ ...CREDITS[0]!, narrative: "  D-ACR-2026-1  " }],
      orders: ORDERS,
    });
    await service.runOnce("write");
    assert.equal(writes[0]!.reference, "D-ACR-2026-1");
  });
});

describe("the schedule of the live bank pairing", () => {
  it("logs each outcome once, without the narrative, and a failed round does not stop it", async () => {
    const { service } = setup({
      proformas: [WHOLE],
      credits: CREDITS,
      orders: ORDERS,
    });
    const rounds: (() => ReturnType<typeof service.runOnce>)[] = [
      () => service.runOnce("observe"),
      () => service.runOnce("observe"),
      () => Promise.reject(new Error("db down")),
      async () => {
        const run = await service.runOnce("observe");
        return {
          ...run,
          outcomes: run.outcomes.map((row) => ({
            ...row,
            decision: "review" as const,
          })),
        };
      },
    ];
    const scheduler = new WebshopTransferPairingScheduler({
      runOnce: () => rounds.shift()!(),
    } as never);
    const first = await scheduler.tick("observe");
    assert.equal(first.length, 2);
    assert.match(first[0]!, /^WEBSHOP-PAROSITAS mode=observe .*"bt_whole"/);
    assert.doesNotMatch(first.join("\n"), /Kovacs/);
    assert.match(first[1]!, /celok=1 jovairasok=4 olvashatatlan=0 uj=1/);
    // the same outcome again: nothing new
    assert.deepEqual(await scheduler.tick("observe"), []);
    assert.deepEqual(await scheduler.tick("observe"), []);
    // after the failed round the next one runs, and a changed outcome is new
    const after = await scheduler.tick("observe");
    assert.equal(after.length, 2);
    assert.match(after[0]!, /"decision":"review"/);
  });
});
