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
  ALL_TIME_FROM,
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

  // Balázs's live run 2026-11-05: "ACRW-2026/00469: NOT_FOUND" while the GLS page showed it paired; the line says which case
  it("GLS: a NOT_FOUND line says whether the invoice is missing from the feed or stored only under another source", () => {
    const plan = glsPlanFrom(
      [
        {
          transferDate: "2026-09-10",
          markable: true,
          transferred: "57800",
          creditId: "bt",
          marks: [],
          skipped: [
            { invoiceNumber: "ACRW-2026/00469", reason: "NOT_FOUND" },
            { invoiceNumber: "ACRW-2026/00468", reason: "NOT_FOUND" },
            { invoiceNumber: "ACRW-2026/00467", reason: "AMOUNT_MISMATCH" },
          ],
        },
      ],
      new Map([
        ["ACRW-2026/00469", ["EBIZ"]],
        ["ACRW-2026/00467", ["EBIZ"]],
      ]),
    );
    assert.deepEqual(
      plan.exceptions.map((e) => `${e.reference}: ${e.detail}`),
      [
        "ACRW-2026/00469: GLS 2026-09-10; a feedben csak EBIZ forrással",
        "ACRW-2026/00468: GLS 2026-09-10; nincs a Számlázz.hu feedben",
        "ACRW-2026/00467: GLS 2026-09-10",
      ],
    );
  });

  // barracuda, #2246 a: WHAT TURNS THIS RED: a GLS line keyed by the invoice alone, so a person's "Kézzel rendezve" on
  // one transfer would silently close a later transfer's line for the same invoice
  it("GLS: a line's key is the invoice and the transfer day", () => {
    const transfer = (transferDate: string) => ({
      transferDate,
      markable: true as const,
      transferred: "100",
      creditId: `bt-${transferDate}`,
      marks: [],
      skipped: [
        { invoiceNumber: "ACRW-2026/00469", reason: "NOT_FOUND" as const },
      ],
    });
    const plan = glsPlanFrom([transfer("2026-09-10"), transfer("2026-10-01")]);
    assert.deepEqual(
      plan.exceptions.map((e) => e.key),
      ["ACRW-2026/00469@2026-09-10", "ACRW-2026/00469@2026-10-01"],
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
      /KI, egyik forrás sincs auto vagy dry állásban/,
    );
    // e64540fd: a dry source runs too (it records the plan)
    assert.match(
      describePaidMarksAuto([{ source: "BANK_TRANSFER", mode: "dry" }], 7, 60),
      /naponta 7:00-kor/,
    );
  });

  /*
    "FUTTATAS MOST" (e64540fd). MI PIROSIT: egy dry forras ir, vagy Szamlazz-kulcsot ker; a dry terv
    szamlaszam es osszeg nelkul tarolodik; ket futas egyszerre indul (a kezi a napira, vagy ket kezi);
    a futas a gombot nyomo felhasznalo nelkul tarolodik.
  */
  describe("Futtatás most", () => {
    const envBefore = { ...process.env };
    const bank = (gate?: Promise<void>) => ({
      source: "BANK_TRANSFER" as const,
      switchName: "BANK_TRANSFER_MARK_PAID",
      plan: async () => {
        await gate;
        return {
          source: "BANK_TRANSFER" as const,
          marks: [
            {
              invoiceNumber: "ACR-2026/00042",
              date: "2026-11-04",
              amount: "12700",
              title: "átutalás",
              note: "n",
              sourceRef: "credit-1",
            },
          ],
          exceptions: [],
        };
      },
    });
    const fakeRuns = (log: string[]) =>
      ({
        save: async () => void log.push("save"),
        saveDry: async (
          r: { source: string; summary: Record<string, number> },
          planned: { invoiceNumber: string; amount: string }[],
          trigger: { kind: string; userId?: string },
        ) =>
          void log.push(
            `dry ${r.source} ${planned.map((p) => `${p.invoiceNumber}:${p.amount}`).join(",")} PLANNED=${r.summary.PLANNED} by ${trigger.kind}:${trigger.userId ?? "-"}`,
          ),
        saveFailed: async (source: string, code: string) =>
          void log.push(`failed ${source} ${code}`),
      }) as never;

    it("a dry source records its plan with invoice number and amount, writes nothing and asks for no key", async () => {
      process.env.BANK_TRANSFER_MARK_PAID = "dry";
      try {
        const log: string[] = [];
        let keyAsked = 0;
        const scheduler = new PaidMarksAutoScheduler(
          { resolve: async () => (keyAsked++, { agentKey: "k" }) } as never,
          fakeRuns(log),
        );
        await scheduler.runOnce(new Date(), [bank()], {
          kind: "manual",
          userId: "user-1",
        });
        assert.deepEqual(log, [
          "dry BANK_TRANSFER ACR-2026/00042:12700 PLANNED=1 by manual:user-1",
        ]);
        assert.equal(keyAsked, 0);
      } finally {
        process.env = { ...envBefore };
      }
    });

    it("a second press while a run is in flight does not start another; after it, it does", async () => {
      process.env.BANK_TRANSFER_MARK_PAID = "dry";
      try {
        const log: string[] = [];
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        const scheduler = new PaidMarksAutoScheduler(
          {} as never,
          fakeRuns(log),
        );
        const first = scheduler.runOnce(new Date(), [bank(gate)], {
          kind: "manual",
          userId: "user-1",
        });
        assert.equal(scheduler.status().running, true);
        // the daily timer firing meanwhile does not double it either
        await scheduler.runOnce(new Date(), [bank()]);
        release();
        await first;
        assert.equal(log.length, 1);
        assert.equal(scheduler.status().running, false);
        await scheduler.runOnce(new Date(), [bank()]);
        assert.equal(log.length, 2);
      } finally {
        process.env = { ...envBefore };
      }
    });

    // acrobot 43776: WHAT TURNS THIS RED: the one look without an age limit still bounded by the daily window, or the
    // daily run (and a plain press) losing its window
    it("the one look without an age limit starts at ALL_TIME_FROM; the daily run and a plain press keep the window", async () => {
      process.env.BANK_TRANSFER_MARK_PAID = "dry";
      process.env.PAID_MARKS_AUTO_DAYS = "60";
      try {
        const froms: string[] = [];
        const source = {
          ...bank(),
          plan: async (from: string) => {
            froms.push(from);
            return {
              source: "BANK_TRANSFER" as const,
              marks: [],
              exceptions: [],
            };
          },
        };
        const scheduler = new PaidMarksAutoScheduler({} as never, fakeRuns([]));
        const now = new Date("2026-11-05T20:00:00Z");
        await scheduler.runOnce(
          now,
          [source],
          { kind: "manual", userId: "u" },
          ALL_TIME_FROM,
        );
        await scheduler.runOnce(now, [source]);
        assert.deepEqual(froms, [ALL_TIME_FROM, runFrom(now, 60)]);
        assert.equal(ALL_TIME_FROM, "2000-01-01");

        const asked: (string | undefined)[] = [];
        scheduler.runOnce = async (_now, _sources, _trigger, from) =>
          void asked.push(from);
        scheduler.runNow("u", now, { allTime: true });
        scheduler.runNow("u", now);
        assert.deepEqual(asked, [ALL_TIME_FROM, undefined]);
      } finally {
        process.env = { ...envBefore };
      }
    });

    // acrobot 43822: WHAT TURNS THIS RED: the dry look before the run without an age limit planning from the daily
    // window, writing or recording a run, losing a source's planned lines, or a failed plan hiding the other sources
    it("the dry look without an age limit plans every source from ALL_TIME_FROM and writes nothing", async () => {
      process.env.BANK_TRANSFER_MARK_PAID = "auto";
      delete process.env.GLS_COD_MARK_PAID;
      try {
        const log: string[] = [];
        const froms: string[] = [];
        const planned = {
          ...bank(),
          plan: async (from: string) => {
            froms.push(from);
            return (await bank().plan())!;
          },
        };
        const broken = {
          ...bank(),
          source: "GLS_COD" as const,
          switchName: "GLS_COD_MARK_PAID",
          plan: async () => {
            throw new Error("GLS_READ_FAILED");
          },
        };
        const scheduler = new PaidMarksAutoScheduler(
          {} as never,
          fakeRuns(log),
        );
        const unpaid = {
          logRow: async () => null,
          invoice: async () => ({
            paymentsKnown: true,
            paidAmount: "0",
            grossAmount: "12700",
            currency: "HUF",
          }),
        };
        const preview = await scheduler.previewAllTime(
          [broken, planned],
          unpaid,
        );
        assert.deepEqual(froms, [ALL_TIME_FROM]);
        assert.deepEqual(log, []);
        assert.deepEqual(
          preview.map((p) => [
            p.source,
            p.mode,
            p.planned.map((m) => m.invoiceNumber),
            p.errorCode,
          ]),
          [
            ["GLS_COD", "off", [], "GLS_READ_FAILED"],
            ["BANK_TRANSFER", "auto", ["ACR-2026/00042"], null],
          ],
        );
      } finally {
        process.env = { ...envBefore };
      }
    });

    // acrobot 43886, barracuda on #2251: WHAT TURNS THIS RED: the preview counting a mark the writer would leave out
    // (already written in the log, already paid by the feed, not provably unpaid, an uncertain earlier call), so the
    // number on the confirmation is more than the writer tries; or a left-out mark not counted by its reason
    it("the preview counts only what the writer would try, and the rest per reason", async () => {
      process.env.BANK_TRANSFER_MARK_PAID = "auto";
      try {
        const marks = ["W", "A", "P", "U", "O", "F"].map((n) => ({
          invoiceNumber: `ACR-2026/0000${n}`,
          date: "2026-09-07",
          amount: "100",
          title: "átutalás",
          note: "n",
          sourceRef: `credit-${n}`,
        }));
        const source = {
          ...bank(),
          plan: async () => ({
            source: "BANK_TRANSFER" as const,
            marks,
            exceptions: [],
          }),
        };
        // W: written by a daily run; A: logged already paid; U: an uncertain earlier call; P: paid by the feed;
        // O: partly paid (not provably unpaid); F: an earlier FAILED row on an unpaid invoice, so tried again
        const logged: Record<string, string> = {
          "ACR-2026/0000W": "WRITTEN",
          "ACR-2026/0000A": "ALREADY_PAID",
          "ACR-2026/0000U": "UNKNOWN",
          "ACR-2026/0000F": "FAILED",
        };
        const paid: Record<string, string> = {
          "ACR-2026/0000P": "100",
          "ACR-2026/0000O": "40",
        };
        const store = {
          logRow: async (_s: string, invoiceNumber: string) =>
            logged[invoiceNumber]
              ? { id: invoiceNumber, state: logged[invoiceNumber] as never }
              : null,
          invoice: async (invoiceNumber: string) => ({
            paymentsKnown: true,
            paidAmount: paid[invoiceNumber] ?? "0",
            grossAmount: "100",
            currency: "HUF",
          }),
        };
        const scheduler = new PaidMarksAutoScheduler({} as never, fakeRuns([]));
        const [preview] = await scheduler.previewAllTime([source], store);
        assert.deepEqual(
          preview!.planned.map((m) => m.invoiceNumber),
          ["ACR-2026/0000F"],
        );
        assert.deepEqual(preview!.skipped, {
          LOGGED_BEFORE: 2,
          UNCERTAIN_BEFORE: 1,
          ALREADY_PAID: 1,
          NOT_UNPAID: 1,
        });
      } finally {
        process.env = { ...envBefore };
      }
    });

    it("the status names the next run while the timer is set, and none after it stops", () => {
      process.env.BANK_TRANSFER_MARK_PAID = "dry";
      try {
        const scheduler = new PaidMarksAutoScheduler({} as never, fakeRuns([]));
        assert.equal(scheduler.status().nextRunAt, null);
        scheduler.onModuleInit();
        const next = Date.parse(scheduler.status().nextRunAt!);
        assert.ok(next > Date.now() && next <= Date.now() + 86_400_000);
        scheduler.onModuleDestroy();
        assert.equal(scheduler.status().nextRunAt, null);
      } finally {
        process.env = { ...envBefore };
      }
    });

    it("runNow answers started, then running while in flight, and nothing without a source on auto or dry", async () => {
      const scheduler = new PaidMarksAutoScheduler({} as never, fakeRuns([]));
      const original = process.env.BANK_TRANSFER_MARK_PAID;
      for (const s of [
        "GLS_COD_MARK_PAID",
        "FOXPOST_MARK_PAID",
        "SIMPLEPAY_MARK_PAID",
        "BANK_TRANSFER_MARK_PAID",
      ])
        delete process.env[s];
      try {
        assert.deepEqual(scheduler.runNow("user-1"), {
          status: "nothing",
          reason: "no-source-on-auto-or-dry",
        });
      } finally {
        process.env = { ...envBefore };
        void original;
      }
    });
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
