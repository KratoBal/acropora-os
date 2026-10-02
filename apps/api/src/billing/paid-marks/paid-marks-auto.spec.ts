import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  PaymentMarkInput,
  PaymentMarkStore,
} from "../../integrations/szamlazz/outgoing-payment-marks.js";
import type { SzamlazzAgentResponse } from "../../integrations/szamlazz/szamlazz-agent-xml.js";
import {
  paidMarksMode,
  paidMarksRunLine,
  runPaidMarksAuto,
} from "./paid-marks-auto.js";
import {
  describePaidMarksAuto,
  msUntilNextRun,
  PaidMarksAutoScheduler,
  runFrom,
} from "./paid-marks-auto.scheduler.js";
import {
  foxpostPlanFrom,
  glsPlanFrom,
  simplePayPlanFrom,
} from "./paid-marks-sources.js";

const mark = (invoiceNumber: string, amount = "1000"): PaymentMarkInput => ({
  invoiceNumber,
  date: "2026-09-17",
  amount,
  title: "utánvét",
  note: "GLS utánvét, 2026-09-17",
  sourceRef: "bt-1",
});

function fakeStore(paid: Record<string, string> = {}) {
  const calls: string[] = [];
  const store: PaymentMarkStore = {
    invoice: async (number) => ({
      paymentsKnown: true,
      paidAmount: paid[number] ?? "0",
      grossAmount: "1000",
      currency: "HUF",
    }),
    logRow: async () => null,
    create: async (row) => {
      calls.push(`create ${row.invoiceNumber} ${row.state}`);
      return { id: row.invoiceNumber };
    },
    update: async (id, patch) => void calls.push(`update ${id} ${patch.state}`),
  };
  return { store, calls };
}

const client = (answer: (xml: string) => SzamlazzAgentResponse) => ({
  registerPayment: async (xml: string) => answer(xml),
});

/*
  AZ AUTOMATIKUS FUTÁS (acrobot 26101). MI PIROSÍT: ha nem MINDEN jelölhető
  számla menne be (nincs ember, aki felsorolja); ha egy már kifizetett vagy egy
  magától rendeződő kimaradás figyelmet kérne; ha egy elutasított írás, egy
  bizonytalan korábbi futás vagy egy figyelmet kérő kimaradás NEM kérne.
*/
describe("runPaidMarksAuto", () => {
  it("writes every markable invoice, and lists what needs a person", async () => {
    const { store, calls } = fakeStore({ "A-2": "1000" });
    const result = await runPaidMarksAuto({
      plan: {
        source: "GLS_COD",
        marks: [mark("A-1"), mark("A-2"), mark("A-3")],
        exceptions: [
          { reference: "2026-10-01", reason: "NO_CREDIT", attention: true },
          { reference: "A-9", reason: "ALREADY_PAID", attention: false },
        ],
      },
      agentKey: "k",
      client: client((xml) =>
        xml.includes("A-3")
          ? { successful: false, errorCode: "7", errorMessage: "nincs" }
          : { successful: true, outstanding: 0 },
      ),
      store,
    });
    assert.deepEqual(calls, [
      "create A-1 PLANNED",
      "update A-1 WRITTEN",
      "create A-2 ALREADY_PAID",
      "create A-3 PLANNED",
      "update A-3 FAILED",
    ]);
    assert.deepEqual(
      [result.writtenCount, result.failedCount, result.summary],
      [
        1,
        1,
        {
          WRITTEN: 1,
          ALREADY_PAID: 2,
          FAILED: 1,
          NO_CREDIT: 1,
        },
      ],
    );
    assert.deepEqual(
      result.attention.map((a) => `${a.reference}:${a.reason}`),
      ["A-3:FAILED", "2026-10-01:NO_CREDIT"],
    );
    assert.equal(
      paidMarksRunLine(result),
      "Kifizetett-jelölés GLS_COD: beírva 1, kimaradt: ALREADY_PAID 2, FAILED 1, NO_CREDIT 1; figyelmet kér 2",
    );
  });

  it("the switch: auto, live, dry or off", () => {
    assert.deepEqual(
      [undefined, "", "on", "dry", "live", " auto "].map(paidMarksMode),
      ["off", "off", "off", "dry", "live", "auto"],
    );
  });
});

describe("the source plans: what needs a person", () => {
  it("GLS: a refused transfer and an amount difference do, an already paid invoice does not", () => {
    const plan = glsPlanFrom([
      {
        transferDate: "2026-10-01",
        markable: false,
        refusal: "NO_CREDIT",
        transferred: "15527",
      },
      {
        transferDate: "2026-09-17",
        markable: true,
        transferred: "1000",
        creditId: "bt",
        marks: [
          {
            invoiceNumber: "A-1",
            date: "2026-09-17",
            amount: "1000",
            title: "utánvét",
            note: "n",
          },
        ],
        skipped: [
          { invoiceNumber: "A-2", reason: "ALREADY_PAID" },
          { invoiceNumber: "A-3", reason: "AMOUNT_MISMATCH" },
        ],
      },
    ]);
    assert.deepEqual(
      plan.marks.map((m) => m.invoiceNumber),
      ["A-1"],
    );
    assert.deepEqual(
      plan.exceptions.map((e) => `${e.reference}:${e.reason}:${e.attention}`),
      [
        "2026-10-01:NO_CREDIT:true",
        "A-2:ALREADY_PAID:false",
        "A-3:AMOUNT_MISMATCH:true",
      ],
    );
  });

  it("Foxpost: a settlement that failed to read, with its error", () => {
    const plan = foxpostPlanFrom([
      {
        settlementCode: "26H39",
        markable: false,
        refusal: "SETTLEMENT_INCOMPLETE",
        transferred: null,
        errorCode: "FOXPOST_TRANSFER_TOTAL_MISMATCH",
      },
    ]);
    assert.deepEqual(plan.exceptions, [
      {
        reference: "26H39",
        reason: "SETTLEMENT_INCOMPLETE",
        attention: true,
        detail: "FOXPOST_TRANSFER_TOTAL_MISMATCH",
      },
    ]);
  });

  it("SimplePay: a partial refund and a refund after a mark do; a non-card order and an earlier mark do not", () => {
    const plan = simplePayPlanFrom({
      decisions: [
        {
          orderKey: "47679-1",
          markable: true,
          mark: {
            invoiceNumber: "W-1",
            date: "2026-09-28",
            amount: "29210",
            title: "bankkártya",
            note: "SimplePay",
            sourceRef: "t1",
          },
        },
        {
          orderKey: "47679-2",
          markable: true,
          mark: {
            invoiceNumber: "W-2",
            date: "2026-09-28",
            amount: "100",
            title: "bankkártya",
            note: "SimplePay",
            sourceRef: "t2",
          },
        },
        {
          orderKey: "47679-3",
          markable: false,
          reason: "NOT_CARD",
          invoiceNumber: "W-3",
          completed: "0",
          refunded: "0",
        },
        {
          orderKey: "47679-4",
          markable: false,
          reason: "PARTLY_REFUNDED",
          invoiceNumber: "W-4",
          completed: "100",
          refunded: "40",
        },
      ],
      markedBefore: new Set(["W-2"]),
      refundsAfter: [
        {
          invoiceNumber: "W-5",
          orderKey: "47679-5",
          markDate: "2026-09-20",
          markAmount: "500",
          refunded: "500",
          refundDates: ["2026-09-25"],
          full: true,
        },
      ],
    });
    assert.deepEqual(
      plan.marks.map((m) => m.invoiceNumber),
      ["W-1"],
    );
    assert.deepEqual(
      plan.exceptions.map((e) => `${e.reference}:${e.reason}:${e.attention}`),
      [
        "W-3:NOT_CARD:false",
        "W-4:PARTLY_REFUNDED:true",
        "W-2:MARKED_BEFORE:false",
        "W-5:REFUNDED_AFTER_MARK:true",
      ],
    );
  });
});

/*
  AZ ÜTEMEZÉS. MI PIROSÍT: ha a napi futás a megadott óra helyett máskor, vagy
  ugyanazon a napon kétszer indulna; ha kulcs nélkül bármi lefutna, és a
  futásról nem maradna sor; ha egy forrás hibája a többit megállítaná.
*/
describe("the daily schedule", () => {
  it("the next run at the hour, today or tomorrow; the window's first day", () => {
    const at = (s: string) => new Date(s);
    assert.equal(msUntilNextRun(at("2026-10-02T05:30:00"), 7), 90 * 60_000);
    assert.equal(msUntilNextRun(at("2026-10-02T07:00:00"), 7), 24 * 3_600_000);
    assert.equal(msUntilNextRun(at("2026-10-02T08:00:00"), 7), 23 * 3_600_000);
    assert.equal(runFrom(at("2026-10-02T12:00:00Z"), 60), "2026-08-03");
  });

  it("says in one line whether it runs", () => {
    assert.match(
      describePaidMarksAuto(
        [
          { source: "GLS_COD", mode: "auto" },
          { source: "FOXPOST", mode: "live" },
        ],
        7,
        60,
      ),
      /naponta 7:00-kor, 60 napra vissza \(GLS_COD=auto, FOXPOST=live\)/,
    );
    assert.match(
      describePaidMarksAuto([{ source: "GLS_COD", mode: "live" }], 7, 60),
      /KI, egyik forrás sincs auto állásban/,
    );
  });

  it("no key: nothing is planned, every auto source gets a failed run", async () => {
    const saved: string[] = [];
    let planned = 0;
    const scheduler = new PaidMarksAutoScheduler(
      {
        resolve: async () => {
          throw new Error("SZAMLAZZ_CONNECTION_NOT_CONFIGURED");
        },
      } as never,
      {
        save: async () => void saved.push("save"),
        saveFailed: async (source: string, code: string) =>
          void saved.push(`${source} ${code}`),
      } as never,
    );
    const source = (name: "GLS_COD" | "FOXPOST") => ({
      source: name,
      switchName: "X",
      plan: async () => {
        planned++;
        return { source: name, marks: [], exceptions: [] };
      },
    });
    await scheduler.runOnce(new Date(), [source("GLS_COD"), source("FOXPOST")]);
    assert.equal(planned, 0);
    assert.deepEqual(saved, [
      "GLS_COD SZAMLAZZ_CONNECTION_NOT_CONFIGURED",
      "FOXPOST SZAMLAZZ_CONNECTION_NOT_CONFIGURED",
    ]);
  });

  it("one source failing does not stop the next", async () => {
    const saved: string[] = [];
    const scheduler = new PaidMarksAutoScheduler(
      { resolve: async () => ({ agentKey: "k", revision: "db:1" }) } as never,
      {
        save: async (r: { source: string }) =>
          void saved.push(`saved ${r.source}`),
        saveFailed: async (source: string, code: string) =>
          void saved.push(`${source} ${code}`),
      } as never,
    );
    await scheduler.runOnce(new Date(), [
      {
        source: "GLS_COD",
        switchName: "X",
        plan: async () => {
          throw new Error("GLS_LOAD_FAILED");
        },
      },
      {
        source: "FOXPOST",
        switchName: "Y",
        plan: async () => ({ source: "FOXPOST", marks: [], exceptions: [] }),
      },
    ]);
    assert.deepEqual(saved, ["GLS_COD GLS_LOAD_FAILED", "saved FOXPOST"]);
  });
});
