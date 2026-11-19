import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import type { StripeSyncRunSummary } from "@acropora/types";

import {
  MedusaAdminHttpError,
  type MedusaAdminClient,
  type MedusaStripePayout,
  type MedusaStripeTransaction,
} from "../medusa/medusa-admin.client.js";
import { MedusaConnectionError } from "../medusa/medusa-connection.types.js";
import type { SimplePayOrderDocument } from "../simplepay/simplepay-resolution.js";
import type { MedusaCredentialProvider } from "../medusa/medusa-credential.provider.js";
import {
  FIRST_RUN_LOOKBACK_DAYS,
  MAX_TRANSACTION_PAGES,
  RESCAN_OVERLAP_DAYS,
  StripeSettlementService,
} from "./stripe-settlement.service.js";
import type {
  StripePayoutToSave,
  StripeSettlementStore,
} from "./stripe-settlement.store.js";

const DAY = 86_400;

const payout = (
  id: string,
  arrivalDay: number,
  extra: Partial<MedusaStripePayout> = {},
): MedusaStripePayout => ({
  id,
  status: "paid",
  currency: "huf",
  amount_minor: 448850,
  amount: 4488.5,
  arrival_date: arrivalDay * DAY,
  created: (arrivalDay - 2) * DAY,
  automatic: true,
  ...extra,
});

const txn = (
  id: string,
  extra: Partial<MedusaStripeTransaction> = {},
): MedusaStripeTransaction => ({
  id,
  type: "charge",
  reporting_category: "charge",
  created: 1,
  currency: "huf",
  amount_minor: 470000,
  fee_minor: 21150,
  net_minor: 448850,
  amount: 4700,
  fee: 211.5,
  net: 4488.5,
  source_kind: "charge",
  source_id: "ch_1",
  payment_intent: "pi_1",
  charge: "ch_1",
  refund: null,
  orders: [
    { id: "order_72", display_id: 72, total: 4700, currency_code: "huf" },
  ],
  ...extra,
});

class FakeStore implements StripeSettlementStore {
  saved: StripePayoutToSave[] = [];
  statuses = new Map<string, "COMPLETED" | "NEEDS_REVIEW">();
  latest: Date | null = null;
  invoices = new Map<string, string[]>([["order_72", ["ACRW-2026/00600"]]]);
  runs: {
    trigger: string;
    outcome?: Parameters<StripeSettlementStore["finishRun"]>[1];
  }[] = [];
  startError: Error | null = null;
  invoiceNumbers = new Set(["ACRW-2026/00600"]);
  approved: unknown[] = [];

  latestArrivalDate = async () => this.latest;
  knownPayouts = async (ids: readonly string[]) =>
    new Map(
      ids
        .filter((id) => this.statuses.has(id))
        .map((id) => [id, { status: this.statuses.get(id)! }]),
    );
  liveInvoicesByOrder = async (orderIds: readonly string[]) =>
    new Map([...this.invoices].filter(([id]) => orderIds.includes(id)));
  liveInvoiceExists = async (number: string) => this.invoiceNumbers.has(number);
  /** The payment and refund lines of an intent the OS already holds in OTHER payouts (the refund slice). */
  storedLines = new Map<
    string,
    { stripeTransactionId: string; type: string; amount: number }[]
  >();
  documents = new Map<string, SimplePayOrderDocument[]>();
  documentCalls: string[][] = [];
  linesByIntent = async (intents: readonly string[]) =>
    new Map([...this.storedLines].filter(([id]) => intents.includes(id)));
  orderDocuments = async (orderIds: readonly string[]) => {
    this.documentCalls.push([...orderIds]);
    return new Map([...this.documents].filter(([id]) => orderIds.includes(id)));
  };
  oldestOpen: Date | null = null;
  oldestOpenPayoutCreatedAt = async () => this.oldestOpen;
  savePayout = async (p: StripePayoutToSave) => {
    this.saved.push(p);
    const open =
      p.lines.some((l) => l.status === "NEEDS_REVIEW") || p.errorCode !== null;
    this.statuses.set(p.stripePayoutId, open ? "NEEDS_REVIEW" : "COMPLETED");
  };
  startRun = async (trigger: string) => {
    if (this.startError) throw this.startError;
    this.runs.push({ trigger });
    return `run_${this.runs.length}`;
  };
  finishRun = async (
    _id: string,
    outcome: Parameters<StripeSettlementStore["finishRun"]>[1],
  ) => {
    this.runs[this.runs.length - 1]!.outcome = outcome;
  };
  lastRun = async (): Promise<StripeSyncRunSummary | undefined> => {
    const run = this.runs[this.runs.length - 1];
    if (!run?.outcome) return undefined;
    return {
      status: run.outcome.status,
      trigger: run.trigger as "SCHEDULED" | "MANUAL",
      startedAt: "2026-11-18T20:00:00.000Z",
      payoutsSeen: run.outcome.payoutsSeen,
      payoutsNew: run.outcome.payoutsNew,
      payoutsReresolved: run.outcome.payoutsReresolved,
      failedCount: run.outcome.failedCount,
    };
  };
  listPayouts = async () => {
    throw new Error("not used");
  };
  payoutDetail = async () => {
    throw new Error("not used");
  };
  approveLine = async (input: unknown) => {
    this.approved.push(input);
  };
}

interface FeedCalls {
  payouts: { createdGte?: number; startingAfter?: string }[];
  transactions: { payoutId: string; startingAfter?: string }[];
}

function service(
  store: FakeStore,
  feed: {
    payouts: MedusaStripePayout[][];
    transactions?: Record<
      string,
      | {
          transactions: MedusaStripeTransaction[];
          has_more?: boolean;
          next_cursor?: string | null;
          orders_truncated?: boolean;
        }[]
      | Error
    >;
  },
) {
  const calls: FeedCalls = { payouts: [], transactions: [] };
  let payoutPage = 0;
  const pointers = new Map<string, number>();
  const client = {
    stripePayouts: async (input: {
      createdGte?: number;
      startingAfter?: string;
    }) => {
      calls.payouts.push(input);
      const page = feed.payouts[payoutPage++] ?? [];
      const more = payoutPage < feed.payouts.length;
      return {
        payouts: page,
        has_more: more,
        next_cursor: more ? page[page.length - 1]!.id : null,
      };
    },
    stripePayoutTransactions: async (
      payoutId: string,
      input: { startingAfter?: string } = {},
    ) => {
      calls.transactions.push({ payoutId, startingAfter: input.startingAfter });
      const configured = feed.transactions?.[payoutId];
      if (configured instanceof Error) throw configured;
      const index = pointers.get(payoutId) ?? 0;
      pointers.set(payoutId, index + 1);
      const page = configured?.[index] ?? { transactions: [] };
      return {
        transactions: page.transactions,
        has_more: page.has_more ?? false,
        next_cursor: page.next_cursor ?? null,
        orders_truncated: page.orders_truncated ?? false,
      };
    },
  } as unknown as MedusaAdminClient;
  const credentials = {
    resolve: async () => ({ apiKey: "k" }),
  } as unknown as MedusaCredentialProvider;
  return {
    calls,
    svc: new StripeSettlementService(credentials, store, () => client, {}),
  };
}

describe("StripeSettlementService.sync", () => {
  it("first run: looks back 120 days, stores the oldest payout first, ties the line to its order and invoice", async () => {
    const store = new FakeStore();
    const before = Date.now();
    const { calls, svc } = service(store, {
      payouts: [[payout("po_new", 20), payout("po_old", 10)]],
      transactions: {
        po_old: [{ transactions: [txn("txn_1")] }],
        po_new: [{ transactions: [txn("txn_2", { payment_intent: "pi_2" })] }],
      },
    });
    const summary = await svc.sync("MANUAL");
    assert.deepEqual(
      store.saved.map((p) => p.stripePayoutId),
      ["po_old", "po_new"],
    );
    assert.equal(store.saved[0]!.lines[0]!.status, "RESOLVED");
    assert.deepEqual(store.saved[0]!.lines[0]!.invoiceNumbers, [
      "ACRW-2026/00600",
    ]);
    assert.deepEqual(store.saved[0]!.lines[0]!.orderNumbers, ["72"]);
    assert.equal(summary.status, "APPLIED");
    assert.equal(summary.payoutsSeen, 2);
    assert.equal(summary.payoutsNew, 2);
    const since = calls.payouts[0]!.createdGte! * 1000;
    assert.ok(
      Math.abs(since - (before - FIRST_RUN_LOOKBACK_DAYS * DAY * 1000)) < 5_000,
    );
  });

  it("later runs start before the latest payout held, by the overlap", async () => {
    const store = new FakeStore();
    store.latest = new Date(20 * DAY * 1000);
    const { calls, svc } = service(store, { payouts: [[]] });
    await svc.sync("SCHEDULED");
    assert.equal(
      calls.payouts[0]!.createdGte,
      20 * DAY - RESCAN_OVERLAP_DAYS * DAY,
    );
  });

  it("a COMPLETED payout is left alone and its transactions are not read again", async () => {
    const store = new FakeStore();
    store.statuses.set("po_done", "COMPLETED");
    const { calls, svc } = service(store, {
      payouts: [[payout("po_done", 10)]],
    });
    const summary = await svc.sync("MANUAL");
    assert.equal(calls.transactions.length, 0);
    assert.equal(store.saved.length, 0);
    assert.equal(summary.payoutsNew + summary.payoutsReresolved, 0);
  });

  it("a payout that needs a look is read again, and an invoice that exists now settles its line", async () => {
    const store = new FakeStore();
    store.statuses.set("po_open", "NEEDS_REVIEW");
    store.invoices = new Map();
    const { svc: first } = service(store, {
      payouts: [[payout("po_open", 10)]],
      transactions: { po_open: [{ transactions: [txn("txn_1")] }] },
    });
    await first.sync("MANUAL");
    assert.equal(store.saved[0]!.lines[0]!.status, "NEEDS_REVIEW");
    assert.equal(store.saved[0]!.lines[0]!.errorCode, "ORDER_NOT_INVOICED");

    store.invoices = new Map([["order_72", ["ACRW-2026/00600"]]]);
    store.statuses.set("po_open", "NEEDS_REVIEW");
    const { svc: second } = service(store, {
      payouts: [[payout("po_open", 10)]],
      transactions: { po_open: [{ transactions: [txn("txn_1")] }] },
    });
    const summary = await second.sync("MANUAL");
    assert.equal(store.saved[1]!.lines[0]!.status, "RESOLVED");
    assert.equal(summary.payoutsReresolved, 1);
    assert.equal(summary.payoutsNew, 0);
  });

  it("a manual payout is stored with its own reason and its transactions are not asked for", async () => {
    const store = new FakeStore();
    const { calls, svc } = service(store, {
      payouts: [[payout("po_man", 10, { automatic: false })]],
    });
    await svc.sync("MANUAL");
    assert.equal(calls.transactions.length, 0);
    assert.equal(store.saved[0]!.errorCode, "MANUAL_PAYOUT");
    assert.deepEqual(store.saved[0]!.lines, []);
  });

  it("Stripe's 400 on a payout's transactions (not an automatic one after all) is the same reason", async () => {
    const store = new FakeStore();
    const { svc } = service(store, {
      payouts: [[payout("po_x", 10)]],
      transactions: { po_x: new MedusaAdminHttpError(400, "x") },
    });
    await svc.sync("MANUAL");
    assert.equal(store.saved[0]!.errorCode, "MANUAL_PAYOUT");
  });

  it("transactions come page by page, following the cursor", async () => {
    const store = new FakeStore();
    const { calls, svc } = service(store, {
      payouts: [[payout("po_big", 10)]],
      transactions: {
        po_big: [
          {
            transactions: [txn("txn_1", { payment_intent: "pi_1" })],
            has_more: true,
            next_cursor: "txn_1",
          },
          {
            transactions: [
              txn("txn_2", { payment_intent: "pi_2", orders: [] }),
            ],
          },
        ],
      },
    });
    await svc.sync("MANUAL");
    assert.deepEqual(
      calls.transactions.map((c) => c.startingAfter),
      [undefined, "txn_1"],
    );
    assert.equal(store.saved[0]!.lines.length, 2);
  });

  it("a feed that never ends stops at the page limit, and the payout says so", async () => {
    const store = new FakeStore();
    const endless = Array.from(
      { length: MAX_TRANSACTION_PAGES + 5 },
      (_, i) => ({
        transactions: [txn(`txn_${i}`)],
        has_more: true,
        next_cursor: `txn_${i}`,
      }),
    );
    const { calls, svc } = service(store, {
      payouts: [[payout("po_end", 10)]],
      transactions: { po_end: endless },
    });
    await svc.sync("MANUAL");
    assert.equal(calls.transactions.length, MAX_TRANSACTION_PAGES);
    assert.equal(store.saved[0]!.errorCode, "LINES_NOT_READ");
  });

  it("when the backend stopped reading orders, 'no order' is said as ORDERS_NOT_READ", async () => {
    const store = new FakeStore();
    const { svc } = service(store, {
      payouts: [[payout("po_t", 10)]],
      transactions: {
        po_t: [
          {
            transactions: [txn("txn_1", { orders: [] })],
            orders_truncated: true,
          },
        ],
      },
    });
    await svc.sync("MANUAL");
    assert.equal(store.saved[0]!.ordersTruncated, true);
    assert.equal(store.saved[0]!.lines[0]!.errorCode, "ORDERS_NOT_READ");
  });

  it("a fee line is not an order's payment and a dispute is not hidden", async () => {
    const store = new FakeStore();
    const { svc } = service(store, {
      payouts: [[payout("po_f", 10)]],
      transactions: {
        po_f: [
          {
            transactions: [
              txn("txn_fee", {
                type: "stripe_fee",
                payment_intent: null,
                orders: [],
              }),
              txn("txn_adj", {
                type: "adjustment",
                payment_intent: null,
                orders: [],
              }),
            ],
          },
        ],
      },
    });
    await svc.sync("MANUAL");
    assert.deepEqual(
      store.saved[0]!.lines.map((l) => [l.type, l.status]),
      [
        ["stripe_fee", "NOT_APPLICABLE"],
        ["adjustment", "NEEDS_REVIEW"],
      ],
    );
  });

  it("a payout that fails stops the run there: the newer ones are not stored ahead of the gap", async () => {
    const store = new FakeStore();
    const { svc } = service(store, {
      payouts: [[payout("po_c", 30), payout("po_a", 10), payout("po_b", 20)]],
      transactions: {
        po_b: new Error("boom"),
        po_a: [{ transactions: [txn("txn_1")] }],
      },
    });
    const summary = await svc.sync("MANUAL");
    assert.deepEqual(
      store.saved.map((p) => p.stripePayoutId),
      ["po_a"],
    );
    assert.equal(summary.failedCount, 1);
    assert.equal(summary.status, "APPLIED");
  });

  it("a run that cannot list the payouts is FAILED, with the reason, and the error goes on", async () => {
    const store = new FakeStore();
    const failing = {
      stripePayouts: async () => {
        throw new MedusaAdminHttpError(502, "bad gateway");
      },
    } as unknown as MedusaAdminClient;
    const svc = new StripeSettlementService(
      {
        resolve: async () => ({ apiKey: "k" }),
      } as unknown as MedusaCredentialProvider,
      store,
      () => failing,
      {},
    );
    await assert.rejects(svc.sync("MANUAL"), MedusaAdminHttpError);
    assert.equal(store.runs[0]!.outcome?.status, "FAILED");
    assert.equal(store.runs[0]!.outcome?.errorCode, "STRIPE_FEED_HTTP_502");
  });

  it("no webshop connection: a 503, and no run is recorded", async () => {
    const store = new FakeStore();
    const svc = new StripeSettlementService(
      {
        resolve: async () => {
          throw new MedusaConnectionError(
            "MEDUSA_CONNECTION_NOT_CONFIGURED" as never,
          );
        },
      } as unknown as MedusaCredentialProvider,
      store,
      () => ({}) as MedusaAdminClient,
      {},
    );
    await assert.rejects(svc.sync("MANUAL"), ServiceUnavailableException);
    assert.equal(store.runs.length, 0);
  });

  it("the payout's OWN transaction is no line: it would cancel the others out; another payout's row stays for a person", async () => {
    const store = new FakeStore();
    const own = txn("txn_own", {
      type: "payout",
      reporting_category: "payout",
      source_kind: "payout",
      source_id: "po_a",
      payment_intent: null,
      charge: null,
      amount: -4488.5,
      net: -4488.5,
      fee: 0,
      orders: [],
    });
    const other = txn("txn_other", {
      type: "payout",
      reporting_category: "payout",
      source_kind: "payout",
      source_id: "po_somewhere_else",
      payment_intent: null,
      charge: null,
      amount: -100,
      net: -100,
      fee: 0,
      orders: [],
    });
    const { svc } = service(store, {
      payouts: [[payout("po_a", 10)]],
      transactions: {
        po_a: [{ transactions: [txn("txn_1"), own, other] }],
      },
    });
    await svc.sync("MANUAL");
    assert.deepEqual(
      store.saved[0]!.lines.map((l) => [
        l.stripeTransactionId,
        l.status,
        l.errorCode,
      ]),
      [
        ["txn_1", "RESOLVED", null],
        ["txn_other", "NEEDS_REVIEW", "TYPE_UNKNOWN"],
      ],
    );
  });

  it("with the payout's own row or without it, the stored lines are the same", async () => {
    const own = txn("txn_own", {
      type: "payout",
      source_kind: "payout",
      source_id: "po_a",
      payment_intent: null,
      amount: -4488.5,
      net: -4488.5,
      fee: 0,
      orders: [],
    });
    const run = async (rows: MedusaStripeTransaction[]) => {
      const store = new FakeStore();
      const { svc } = service(store, {
        payouts: [[payout("po_a", 10)]],
        transactions: { po_a: [{ transactions: rows }] },
      });
      await svc.sync("MANUAL");
      return store.saved[0]!.lines;
    };
    assert.deepEqual(await run([txn("txn_1"), own]), await run([txn("txn_1")]));
  });

  it("an open payout older than the overlap pulls the window back to it, a day before it was created", async () => {
    const store = new FakeStore();
    store.latest = new Date(40 * DAY * 1000);
    store.oldestOpen = new Date(5 * DAY * 1000);
    const { calls, svc } = service(store, { payouts: [[]] });
    await svc.sync("SCHEDULED");
    assert.equal(calls.payouts[0]!.createdGte, 5 * DAY - DAY);
  });

  it("an open payout newer than the overlap changes nothing about the window", async () => {
    const store = new FakeStore();
    store.latest = new Date(40 * DAY * 1000);
    store.oldestOpen = new Date(39 * DAY * 1000);
    const { calls, svc } = service(store, { payouts: [[]] });
    await svc.sync("SCHEDULED");
    assert.equal(
      calls.payouts[0]!.createdGte,
      40 * DAY - RESCAN_OVERLAP_DAYS * DAY,
    );
  });

  it("a run already going is a conflict, and nothing is read", async () => {
    const store = new FakeStore();
    store.startError = new ConflictException(
      "STRIPE_SETTLEMENT_SYNC_ALREADY_RUNNING",
    );
    const { calls, svc } = service(store, { payouts: [[payout("po_1", 10)]] });
    await assert.rejects(svc.sync("SCHEDULED"), ConflictException);
    assert.equal(calls.payouts.length, 0);
  });
});

describe("StripeSettlementService.approveLine", () => {
  it("a person names an invoice that exists: the line is approved against it", async () => {
    const store = new FakeStore();
    const { svc } = service(store, { payouts: [] });
    (store as { payoutDetail: unknown }).payoutDetail = async () => ({
      id: "p1",
    });
    await svc.approveLine(
      "p1",
      "l1",
      {
        invoiceNumber: " ACRW-2026/00600 ",
        expectedUpdatedAt: "2026-11-18T20:00:00.000Z",
      },
      "u1",
    );
    assert.deepEqual(store.approved, [
      {
        payoutId: "p1",
        lineId: "l1",
        invoiceNumber: "ACRW-2026/00600",
        expectedUpdatedAt: new Date("2026-11-18T20:00:00.000Z"),
        actorUserId: "u1",
      },
    ]);
  });

  it("an invoice number that is no invoice settles nothing", async () => {
    const store = new FakeStore();
    const { svc } = service(store, { payouts: [] });
    await assert.rejects(
      svc.approveLine(
        "p1",
        "l1",
        {
          invoiceNumber: "ACRW-2026/99999",
          expectedUpdatedAt: "2026-11-18T20:00:00.000Z",
        },
        "u1",
      ),
      /élő \(kiállított, nem sztornózott\) kimenő számla nincs/,
    );
    assert.equal(store.approved.length, 0);
  });

  it("an empty number and a bad version are refused before anything is looked up", async () => {
    const store = new FakeStore();
    const { svc } = service(store, { payouts: [] });
    await assert.rejects(
      svc.approveLine(
        "p1",
        "l1",
        { invoiceNumber: "  ", expectedUpdatedAt: "2026-11-18T20:00:00.000Z" },
        "u1",
      ),
      /kötelező/,
    );
    await assert.rejects(
      svc.approveLine(
        "p1",
        "l1",
        { invoiceNumber: "ACRW-2026/00600", expectedUpdatedAt: "nem datum" },
        "u1",
      ),
      /STRIPE_LINE_VERSION_INVALID/,
    );
    assert.equal(store.approved.length, 0);
  });
});

/*
  A VISSZATERITETT PAYMENTINTENT EGYBEN DONTVE (A9 visszateritesi szelet, kartya 6339b04c). MI PIROSIT: ha a visszateritest tovabbra is
  csak kezi dontesre hagyja (REFUND_UNCHECKED), holott a rendelese egyertelmu; ha a befizetes-sort a sztornozott szamla miatt
  "nincs szamla"-nak latja; ha a mar a rendszerben levo (korabbi kifizetesbeli) befizetes-sort nem veszi figyelembe; ha a vegyes kosar
  visszateritesenek rendelest talalgat; ha egy el nem sztornozott szamla melletti teljes visszaterites eltunik a "nezd meg" listarol.
*/
describe("StripeSettlementService: a visszatéritett PaymentIntent", () => {
  const refundTxn = (
    id: string,
    extra: Partial<MedusaStripeTransaction> = {},
  ) =>
    txn(id, {
      type: "refund",
      reporting_category: "refund",
      amount: -4700,
      amount_minor: -470000,
      refund: "re_1",
      ...extra,
    });
  const invoice = (
    over: Partial<SimplePayOrderDocument> = {},
  ): SimplePayOrderDocument => ({
    number: "ACRW-2026/00600",
    kind: "INVOICE",
    gross: 4700,
    cancelled: false,
    ...over,
  });
  const storno = (): SimplePayOrderDocument => ({
    number: "STORNO-2026/00001",
    kind: "STORNO",
    gross: -4700,
    cancelled: false,
  });
  const lineOf = (store: FakeStore, id: string) =>
    store.saved[0]!.lines.find((line) => line.stripeTransactionId === id)!;

  it("teljes visszatérítés sztornózott számlával: a visszatérítés-sor megoldott, a korábbi kifizetés befizetése beleszámít", async () => {
    const store = new FakeStore();
    store.storedLines.set("pi_1", [
      { stripeTransactionId: "txn_pay", type: "charge", amount: 4700 },
    ]);
    store.documents.set("order_72", [invoice({ cancelled: true }), storno()]);
    const { svc } = service(store, {
      payouts: [[payout("po_refund", 10)]],
      transactions: { po_refund: [{ transactions: [refundTxn("txn_ref")] }] },
    });
    await svc.sync("MANUAL");
    const line = lineOf(store, "txn_ref");
    assert.equal(line.status, "RESOLVED");
    assert.equal(line.errorCode, null);
    assert.deepEqual(line.invoiceNumbers, [
      "ACRW-2026/00600",
      "STORNO-2026/00001",
    ]);
  });

  it("ugyanabban a kifizetésben a befizetés és a visszatérítés: mindkettő megoldott, a befizetés nem 'nincs számla'", async () => {
    const store = new FakeStore();
    store.invoices = new Map(); // the stornoed invoice is not live any more
    store.documents.set("order_72", [invoice({ cancelled: true }), storno()]);
    const { svc } = service(store, {
      payouts: [[payout("po_both", 10)]],
      transactions: {
        po_both: [{ transactions: [txn("txn_pay"), refundTxn("txn_ref")] }],
      },
    });
    await svc.sync("MANUAL");
    assert.equal(lineOf(store, "txn_pay").status, "RESOLVED");
    assert.equal(lineOf(store, "txn_ref").status, "RESOLVED");
  });

  it("teljes visszatérítés, de a számla él: nézd meg (REFUND_INVOICE_NOT_CANCELLED)", async () => {
    const store = new FakeStore();
    store.storedLines.set("pi_1", [
      { stripeTransactionId: "txn_pay", type: "charge", amount: 4700 },
    ]);
    store.documents.set("order_72", [invoice()]);
    const { svc } = service(store, {
      payouts: [[payout("po_live", 10)]],
      transactions: { po_live: [{ transactions: [refundTxn("txn_ref")] }] },
    });
    await svc.sync("MANUAL");
    const line = lineOf(store, "txn_ref");
    assert.equal(line.status, "NEEDS_REVIEW");
    assert.equal(line.errorCode, "REFUND_INVOICE_NOT_CANCELLED");
  });

  it("visszatérítés befizetés-sor nélkül (a befizetés még nincs az OS-ben): nézd meg, nem találgat", async () => {
    const store = new FakeStore();
    store.documents.set("order_72", [invoice({ cancelled: true }), storno()]);
    const { svc } = service(store, {
      payouts: [[payout("po_orphan", 10)]],
      transactions: { po_orphan: [{ transactions: [refundTxn("txn_ref")] }] },
    });
    await svc.sync("MANUAL");
    const line = lineOf(store, "txn_ref");
    assert.equal(line.status, "NEEDS_REVIEW");
    assert.equal(line.errorCode, "REFUND_AMOUNT_UNEXPLAINED");
  });

  it("részleges visszatérítés, a rendelés nincs csökkentve: nézd meg (REFUND_AMOUNT_UNEXPLAINED)", async () => {
    const store = new FakeStore();
    store.storedLines.set("pi_1", [
      { stripeTransactionId: "txn_pay", type: "charge", amount: 4700 },
    ]);
    store.documents.set("order_72", [invoice()]);
    const { svc } = service(store, {
      payouts: [[payout("po_part", 10)]],
      transactions: {
        po_part: [
          {
            transactions: [
              refundTxn("txn_ref", { amount: -1000, amount_minor: -100000 }),
            ],
          },
        ],
      },
    });
    await svc.sync("MANUAL");
    assert.equal(
      lineOf(store, "txn_ref").errorCode,
      "REFUND_AMOUNT_UNEXPLAINED",
    );
  });

  it("vegyes kosár (két rendelés, egy fizetés): a visszatérítés és a befizetés is megoldott, ha mindkét rendelés számlája a saját végösszegére szól", async () => {
    const store = new FakeStore();
    store.invoices = new Map();
    const two = [
      { id: "order_72", display_id: 72, total: 2000, currency_code: "huf" },
      { id: "order_73", display_id: 73, total: 2700, currency_code: "huf" },
    ];
    store.documents.set("order_72", [invoice({ number: "A-1", gross: 2000 })]);
    store.documents.set("order_73", [invoice({ number: "B-1", gross: 2700 })]);
    store.storedLines.set("pi_1", [
      { stripeTransactionId: "txn_pay", type: "charge", amount: 5700 },
    ]);
    const { svc } = service(store, {
      payouts: [[payout("po_mixed", 10)]],
      transactions: {
        po_mixed: [
          {
            transactions: [
              refundTxn("txn_ref", {
                orders: two,
                amount: -1000,
                amount_minor: -100000,
              }),
            ],
          },
        ],
      },
    });
    await svc.sync("MANUAL");
    const line = lineOf(store, "txn_ref");
    assert.equal(line.status, "RESOLVED");
    assert.deepEqual(line.orderNumbers, ["72", "73"]);
    assert.deepEqual(store.documentCalls, [["order_72", "order_73"]]);
  });

  it("ugyanazon intent két sorának különböző rendelés-halmaza nem dől el együtt (a megszokott út)", async () => {
    const store = new FakeStore();
    store.storedLines.set("pi_1", [
      { stripeTransactionId: "txn_pay", type: "charge", amount: 4700 },
    ]);
    const { svc } = service(store, {
      payouts: [[payout("po_diff", 10)]],
      transactions: {
        po_diff: [
          {
            transactions: [
              refundTxn("txn_ref1"),
              refundTxn("txn_ref2", {
                orders: [
                  {
                    id: "order_99",
                    display_id: 99,
                    total: 4700,
                    currency_code: "huf",
                  },
                ],
              }),
            ],
          },
        ],
      },
    });
    await svc.sync("MANUAL");
    assert.equal(lineOf(store, "txn_ref1").errorCode, "REFUND_UNCHECKED");
    assert.deepEqual(store.documentCalls, []);
  });

  it("visszatérítés nélküli intentnél a dokumentumokat nem kérdezi (a megszokott út)", async () => {
    const store = new FakeStore();
    const { svc } = service(store, {
      payouts: [[payout("po_plain", 10)]],
      transactions: { po_plain: [{ transactions: [txn("txn_pay")] }] },
    });
    await svc.sync("MANUAL");
    assert.equal(lineOf(store, "txn_pay").status, "RESOLVED");
    assert.deepEqual(store.documentCalls, []);
  });

  it("ha a webshop nem olvasta végig a rendeléseket, a visszatérítés nem dől el (a vegyes kosár másik rendelése hiányozhat), a számlákat sem kérdezi", async () => {
    const store = new FakeStore();
    store.storedLines.set("pi_1", [
      { stripeTransactionId: "txn_pay", type: "charge", amount: 4700 },
    ]);
    store.documents.set("order_72", [invoice({ cancelled: true }), storno()]);
    const { svc } = service(store, {
      payouts: [[payout("po_trunc", 10)]],
      transactions: {
        po_trunc: [
          {
            // one order IS found, but the backend stopped reading: a second order of a mixed cart may be missing
            transactions: [refundTxn("txn_ref")],
            orders_truncated: true,
          },
        ],
      },
    });
    await svc.sync("MANUAL");
    assert.equal(lineOf(store, "txn_ref").status, "NEEDS_REVIEW");
    assert.equal(lineOf(store, "txn_ref").errorCode, "REFUND_UNCHECKED");
    assert.deepEqual(store.documentCalls, []);
  });
});
