import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyPaidMarks,
  paidMarksReport,
  type PaymentMarkInput,
  type PaymentMarkState,
  type PaymentMarkStore,
} from "./outgoing-payment-marks.js";
import type { SzamlazzAgentResponse } from "./szamlazz-agent-xml.js";

/** 09-17 as the GLS dry run lists it in production (acrobot 25969). */
const MARKS: PaymentMarkInput[] = [
  ["ACRW-2026/00479", "27450", "GLS utánvét, 2026-09-17"],
  [
    "ACRW-2026/00481",
    "105831",
    "GLS utánvét, 2026-09-17, 5 Ft-os kerekítés: beszedve 105830",
  ],
  ["ACRW-2026/00485", "27600", "GLS utánvét, 2026-09-17"],
].map(([invoiceNumber, amount, note]) => ({
  invoiceNumber: invoiceNumber!,
  date: "2026-09-17",
  amount: amount!,
  title: "utánvét",
  note: note!,
  sourceRef: "bt-0917",
}));
const ALL = new Set(MARKS.map((m) => m.invoiceNumber));

type Event = string;

/** An in-memory log and invoice table; every call is recorded in order. */
function fakeStore(
  options: {
    invoices?: Record<string, { paidAmount: string; known?: boolean }>;
    rows?: Record<string, PaymentMarkState>;
    taken?: string[];
  } = {},
) {
  const events: Event[] = [];
  const keys: string[] = [];
  const rows = new Map<string, { id: string; state: PaymentMarkState }>();
  for (const [number, state] of Object.entries(options.rows ?? {}))
    rows.set(number, { id: `row-${number}`, state });
  const store: PaymentMarkStore = {
    async invoice(number) {
      const mark = MARKS.find((m) => m.invoiceNumber === number);
      if (!mark) return null;
      const known = options.invoices?.[number];
      return {
        paymentsKnown: known?.known ?? true,
        paidAmount: known?.paidAmount ?? "0",
        grossAmount: mark.amount,
        currency: "HUF",
      };
    },
    async logRow(source, number, sourceRef) {
      keys.push(`${source} ${number} ${sourceRef}`);
      return rows.get(number) ?? null;
    },
    async create(row) {
      keys.push(
        `${row.source} ${row.invoiceNumber} ${row.sourceRef} ${row.markDate}`,
      );
      if (options.taken?.includes(row.invoiceNumber)) return null;
      events.push(`create ${row.invoiceNumber} ${row.state}`);
      const created = { id: `row-${row.invoiceNumber}`, state: row.state };
      rows.set(row.invoiceNumber, created);
      return { id: created.id };
    },
    async update(id, patch) {
      events.push(`update ${id} ${patch.state}`);
      for (const row of rows.values())
        if (row.id === id) row.state = patch.state;
    },
  };
  return { store, events, rows, keys };
}

function fakeClient(
  answer: (xml: string) => SzamlazzAgentResponse | Error,
  events: Event[],
) {
  const sent: string[] = [];
  return {
    sent,
    client: {
      async registerPayment(xml: string) {
        const number = /<szamlaszam>([^<]+)</.exec(xml)?.[1] ?? "?";
        events.push(`call ${number}`);
        sent.push(xml);
        const result = answer(xml);
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
}

const ok = (outstanding = 0): SzamlazzAgentResponse => ({
  successful: true,
  outstanding,
});

/*
  MI PIROSÍT: ha egy nem jóváhagyott számla is kimenne; ha a napló a hívás UTÁN
  íródna; ha egy már kifizetett vagy korábban beírt számla második jóváírást
  kapna; ha egy bizonytalan (UNKNOWN vagy félbemaradt PLANNED) jelölés vakon
  újra kimenne; ha egy elutasított (FAILED) jelölés nem lenne újrapróbálható;
  ha a kulcs a napló lenyomatába kerülne; ha egy hálózati hiba elutasításnak
  látszana.
*/
describe("applyPaidMarks", () => {
  it("09-17: only the approved invoices, each logged PLANNED before its call, then WRITTEN", async () => {
    const { store, events, keys } = fakeStore();
    const { client, sent } = fakeClient(() => ok(), events);
    const lines = await applyPaidMarks({
      source: "GLS_COD",
      marks: MARKS,
      approved: new Set(["ACRW-2026/00479", "ACRW-2026/00485"]),
      agentKey: "secret-key",
      client,
      store,
    });
    assert.deepEqual(events, [
      "create ACRW-2026/00479 PLANNED",
      "call ACRW-2026/00479",
      "update row-ACRW-2026/00479 WRITTEN",
      "create ACRW-2026/00485 PLANNED",
      "call ACRW-2026/00485",
      "update row-ACRW-2026/00485 WRITTEN",
    ]);
    assert.deepEqual(
      lines.map((l) => [l.invoiceNumber, l.outcome.kind]),
      [
        ["ACRW-2026/00479", "WRITTEN"],
        ["ACRW-2026/00485", "WRITTEN"],
      ],
    );
    // the log key is the source, the invoice and the source-side reference
    assert.deepEqual(keys.slice(0, 2), [
      "GLS_COD ACRW-2026/00479 bt-0917",
      "GLS_COD ACRW-2026/00479 bt-0917 2026-09-17",
    ]);
    assert.match(sent[0]!, /<additiv>true<\/additiv>/);
    assert.match(sent[0]!, /<szamlaagentkulcs>secret-key</);
    assert.match(sent[0]!, /<osszeg>27450<\/osszeg>/);
  });

  it("the fingerprint in the log is of the request without the key", async () => {
    const fingerprintWith = async (agentKey: string) => {
      const { store } = fakeStore();
      let fingerprint: string | null = null;
      const create = store.create.bind(store);
      store.create = async (row) => {
        fingerprint = row.requestSha256;
        return create(row);
      };
      await applyPaidMarks({
        source: "GLS_COD",
        marks: MARKS,
        approved: new Set(["ACRW-2026/00479"]),
        agentKey,
        client: fakeClient(() => ok(), []).client,
        store,
      });
      return fingerprint;
    };
    const first = await fingerprintWith("one-key");
    assert.match(first ?? "", /^[0-9a-f]{64}$/);
    assert.equal(await fingerprintWith("another-key"), first);
  });

  it("already paid in Számlázz.hu (any source, 2 Ft): logged ALREADY_PAID, no call", async () => {
    const { store, events } = fakeStore({
      invoices: { "ACRW-2026/00481": { paidAmount: "105830" } },
    });
    const { client } = fakeClient(() => ok(), events);
    const lines = await applyPaidMarks({
      source: "GLS_COD",
      marks: MARKS,
      approved: new Set(["ACRW-2026/00481"]),
      agentKey: "k",
      client,
      store,
    });
    assert.deepEqual(events, ["create ACRW-2026/00481 ALREADY_PAID"]);
    assert.equal(lines[0]!.outcome.kind, "ALREADY_PAID");
  });

  it("not provably unpaid (payments unknown, partly paid): no call, no log", async () => {
    const { store, events } = fakeStore({
      invoices: {
        "ACRW-2026/00479": { paidAmount: "0", known: false },
        "ACRW-2026/00485": { paidAmount: "100" },
      },
    });
    const { client } = fakeClient(() => ok(), events);
    const lines = await applyPaidMarks({
      source: "GLS_COD",
      marks: MARKS,
      approved: new Set(["ACRW-2026/00479", "ACRW-2026/00485"]),
      agentKey: "k",
      client,
      store,
    });
    assert.deepEqual(events, []);
    assert.deepEqual(
      lines.map((l) => l.outcome),
      [
        { kind: "NOT_UNPAID", state: "UNKNOWN" },
        { kind: "NOT_UNPAID", state: "PARTIAL" },
      ],
    );
  });

  it("a second run: WRITTEN and ALREADY_PAID are done, UNKNOWN and PLANNED wait for a person, FAILED is retried", async () => {
    const { store, events } = fakeStore({
      rows: {
        "ACRW-2026/00479": "WRITTEN",
        "ACRW-2026/00481": "UNKNOWN",
        "ACRW-2026/00485": "FAILED",
      },
    });
    const { client } = fakeClient(() => ok(), events);
    const lines = await applyPaidMarks({
      source: "GLS_COD",
      marks: MARKS,
      approved: ALL,
      agentKey: "k",
      client,
      store,
    });
    assert.deepEqual(
      lines.map((l) => [l.invoiceNumber, l.outcome.kind]),
      [
        ["ACRW-2026/00479", "LOGGED_BEFORE"],
        ["ACRW-2026/00481", "UNCERTAIN_BEFORE"],
        ["ACRW-2026/00485", "WRITTEN"],
      ],
    );
    assert.deepEqual(events, [
      "update row-ACRW-2026/00485 PLANNED",
      "call ACRW-2026/00485",
      "update row-ACRW-2026/00485 WRITTEN",
    ]);
    // a PLANNED row left by a crash is uncertain too
    const planned = fakeStore({ rows: { "ACRW-2026/00479": "PLANNED" } });
    const again = await applyPaidMarks({
      source: "GLS_COD",
      marks: MARKS,
      approved: new Set(["ACRW-2026/00479"]),
      agentKey: "k",
      client: fakeClient(() => ok(), planned.events).client,
      store: planned.store,
    });
    assert.deepEqual(planned.events, []);
    assert.equal(again[0]!.outcome.kind, "UNCERTAIN_BEFORE");
  });

  it("a key taken by a parallel runner: no call", async () => {
    const { store, events } = fakeStore({ taken: ["ACRW-2026/00479"] });
    const { client } = fakeClient(() => ok(), events);
    const lines = await applyPaidMarks({
      source: "GLS_COD",
      marks: MARKS,
      approved: new Set(["ACRW-2026/00479"]),
      agentKey: "k",
      client,
      store,
    });
    assert.deepEqual(events, []);
    assert.deepEqual(lines[0]!.outcome, {
      kind: "UNCERTAIN_BEFORE",
      state: "TAKEN",
    });
  });

  it("a rejection is FAILED, a thrown error UNKNOWN; an open balance after the write is reported", async () => {
    const { store, events } = fakeStore();
    const { client } = fakeClient((xml) => {
      if (xml.includes("00479"))
        return {
          successful: false,
          errorCode: "7",
          errorMessage: "nincs ilyen számla",
        };
      if (xml.includes("00481")) return new Error("fetch failed");
      return ok(150);
    }, events);
    const lines = await applyPaidMarks({
      source: "GLS_COD",
      marks: MARKS,
      approved: ALL,
      agentKey: "k",
      client,
      store,
    });
    assert.deepEqual(
      events.filter((e) => e.startsWith("update")),
      [
        "update row-ACRW-2026/00479 FAILED",
        "update row-ACRW-2026/00481 UNKNOWN",
        "update row-ACRW-2026/00485 WRITTEN",
      ],
    );
    const report = paidMarksReport(lines, new Set([...ALL, "ACRW-2026/09999"]));
    assert.match(
      report,
      /ACRW-2026\/00479\t27450 Ft\t2026-09-17\tELUTASÍTVA \(7\): nincs ilyen számla/,
    );
    assert.match(
      report,
      /ACRW-2026\/00481\t105831 Ft\t2026-09-17\tBIZONYTALAN, kézi ellenőrzés kell: Error: fetch failed/,
    );
    assert.match(
      report,
      /ACRW-2026\/00485\t27600 Ft\t2026-09-17\tBEÍRVA, DE a Számlázz.hu szerint még nyitott: 150/,
    );
    assert.match(
      report,
      /ACRW-2026\/09999\tnincs a jelölhetők között, nem írtam/,
    );
    assert.match(report, /összesen: 1 beírva, 3 jóváhagyott jelölésből/);
  });
});
