import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  PaymentMarkInput,
  PaymentMarkStore,
} from "./outgoing-payment-marks.js";
import { runPaidMarksApply } from "./paid-marks-apply.cli.js";
import type { SzamlazzAgentResponse } from "./szamlazz-agent-xml.js";

const MARK: PaymentMarkInput = {
  invoiceNumber: "ACRW-2026/00470",
  date: "2026-09-23",
  amount: "12500",
  title: "utánvét",
  note: "Foxpost utánvét, 26H38",
  sourceRef: "bt-26h38",
};

function harness(
  answer: SzamlazzAgentResponse | Error = { successful: true, outstanding: 0 },
) {
  const events: string[] = [];
  const store: PaymentMarkStore = {
    invoice: async () => ({
      paymentsKnown: true,
      paidAmount: "0",
      grossAmount: "12500",
      currency: "HUF",
    }),
    logRow: async () => null,
    create: async (row) => {
      events.push(`create ${row.source} ${row.invoiceNumber} ${row.state}`);
      return { id: "row-1" };
    },
    update: async (_id, patch) => void events.push(`update ${patch.state}`),
  };
  const out: string[] = [];
  const err: string[] = [];
  const run = (
    argv: string[],
    mode: "off" | "dry" | "live" = "live",
    credential = async () => {
      events.push("credential");
      return { agentKey: "secret-key", revision: "db:7" };
    },
  ) =>
    runPaidMarksApply({
      argv,
      mode,
      switchName: "FOXPOST_MARK_PAID",
      source: "FOXPOST",
      what: "Foxpost elszámolások 2026-09-01 óta",
      loadMarks: async () => {
        events.push("load");
        return [MARK];
      },
      out: (text) => void out.push(text),
      err: (text) => void err.push(text),
      deps: {
        credential,
        client: {
          registerPayment: async () => {
            events.push("call");
            if (answer instanceof Error) throw answer;
            return answer;
          },
        },
        store,
      },
    });
  return { run, events, out, err };
}

/*
  AZ ÉLES ÍRÁS KAPUJA (acrobot 25989, 26031). MI PIROSÍT: ha a `live` kapcsoló
  vagy a nem üres --invoices lista nélkül bármi kimenne; ha a kulcs a napló
  ELŐTT nem lenne meg (élesen 2026-10-02-én pont ez állította meg, üres
  táblával); ha a kulcs a kimenetbe kerülne; ha egy elutasítás vagy egy
  bizonytalan hívás 0-val lépne ki.
*/
describe("runPaidMarksApply", () => {
  it("refuses without the live switch, and without approved invoices", async () => {
    for (const mode of ["off", "dry"] as const) {
      const h = harness();
      assert.equal(await h.run(["--apply", "--invoices", "A"], mode), 1);
      assert.deepEqual(h.events, []);
      assert.match(h.err.join(""), /FOXPOST_MARK_PAID=live kell/);
    }
    for (const argv of [
      ["--apply"],
      ["--apply", "--invoices"],
      ["--apply", "--invoices", " , "],
    ]) {
      const h = harness();
      assert.equal(await h.run(argv), 2, argv.join(" "));
      assert.deepEqual(h.events, []);
    }
  });

  it("the key first, then the marks, the log before the call; the key is never printed", async () => {
    const h = harness();
    assert.equal(
      await h.run(["--apply", "--invoices", "ACRW-2026/00470,ACRW-2026/00999"]),
      0,
    );
    assert.deepEqual(h.events, [
      "credential",
      "load",
      "create FOXPOST ACRW-2026/00470 PLANNED",
      "call",
      "update WRITTEN",
    ]);
    const printed = h.out.join("");
    assert.match(printed, /kulcs: db:7/);
    assert.match(printed, /ACRW-2026\/00999\tnincs a jelölhetők között/);
    assert.doesNotMatch(printed, /secret-key/);
  });

  it("no key: it stops before anything is loaded or logged", async () => {
    const h = harness();
    await assert.rejects(
      h.run(["--apply", "--invoices", "ACRW-2026/00470"], "live", async () => {
        throw new Error("SZAMLAZZ_CONNECTION_NOT_CONFIGURED");
      }),
      /SZAMLAZZ_CONNECTION_NOT_CONFIGURED/,
    );
    assert.deepEqual(h.events, []);
  });

  it("exits 3 on a rejection and on an uncertain call", async () => {
    for (const answer of [
      { successful: false, errorCode: "7", errorMessage: "nincs" },
      new Error("fetch failed"),
    ]) {
      const h = harness(answer);
      assert.equal(
        await h.run(["--apply", "--invoices", "ACRW-2026/00470"]),
        3,
      );
    }
  });
});
