import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SzamlazzAgentPdfClient } from "../integrations/szamlazz/szamlazz-agent.client.js";
import {
  ExternalInvoicePdfScheduler,
  externalInvoicePdfScheduleOn,
  externalPdfRunLine,
  lastTwoMonths,
  runExternalInvoicePdfFill,
  type ExternalPdfRunDeps,
} from "./external-invoice-pdf.scheduler.js";
import type {
  ExternalPdfCandidate,
  ExternalPdfStore,
} from "./external-invoice-pdf-fill.js";

/**
 * THE DAILY PDF CATCH-UP (card 10964cc7 follow-up, acrobot 35286). What turns
 * red: the run is off by default or ignores its switch; it looks at other
 * months than this and the previous one (Budapest calendar); it asks the
 * Agent API for a row the store did not list (a row with a PDF); a failure of
 * the credential, the store or one invoice stops the run or the schedule
 * instead of staying in the summary; the summary counts are wrong.
 */
const PDF = Buffer.from("%PDF-1.4\n%valami\n");
const NOW = new Date("2026-10-22T04:00:00Z");

const row = (n: number, month = "2026-10"): ExternalPdfCandidate => ({
  id: `e${n}`,
  documentNumber: `ACRW-2026/0050${n}`,
  issueDate: new Date(`${month}-15T00:00:00Z`),
});

function fixture(
  byMonth: Record<string, ExternalPdfCandidate[]>,
  options: { reject?: string[] } = {},
) {
  const asked: string[] = [];
  const monthsAsked: (string | null)[] = [];
  const marks: [string, string | null, string | null][] = [];
  const puts: string[] = [];
  const client = {
    downloadInvoicePdf: async (xml: string) => {
      const number = /<szamlaszam>([^<]*)<\/szamlaszam>/.exec(xml)?.[1] ?? "";
      asked.push(number);
      return options.reject?.includes(number)
        ? { successful: false, errorCode: "9" }
        : { successful: true, pdf: PDF };
    },
  } as unknown as SzamlazzAgentPdfClient;
  const store: ExternalPdfStore = {
    candidates: async (month) => {
      monthsAsked.push(month);
      return byMonth[month ?? ""] ?? [];
    },
    setPdf: async (id, key, reason) => void marks.push([id, key, reason]),
  };
  const deps: ExternalPdfRunDeps = {
    now: NOW,
    store,
    credential: async () => ({ agentKey: "kulcs" }),
    client,
    documents: {
      put: async (key) => void puts.push(`${key.ownerId}/${key.documentId}`),
    },
  };
  return { deps, asked, monthsAsked, marks, puts };
}

describe("the switch", () => {
  it("is ON by default and for anything but an explicit off value", () => {
    for (const value of [undefined, "", "1", "true", "on", "igen"])
      assert.equal(
        externalInvoicePdfScheduleOn({ EXTERNAL_INVOICE_PDF_SCHEDULE: value }),
        true,
        String(value),
      );
    assert.equal(externalInvoicePdfScheduleOn({}), true);
  });

  it("is OFF for 0, false, off, no, whatever the case and the spaces", () => {
    for (const value of ["0", "false", "FALSE", "off", " Off ", "no"])
      assert.equal(
        externalInvoicePdfScheduleOn({ EXTERNAL_INVOICE_PDF_SCHEDULE: value }),
        false,
        value,
      );
  });
});

describe("the two months", () => {
  it("are this month and the previous one, by the Budapest calendar", () => {
    assert.deepEqual(lastTwoMonths(new Date("2026-10-22T04:00:00Z")), [
      "2026-10",
      "2026-09",
    ]);
    assert.deepEqual(lastTwoMonths(new Date("2026-01-15T10:00:00Z")), [
      "2026-01",
      "2025-12",
    ]);
    // 23:30 UTC on Sep 30 is already Oct 1 in Budapest (CEST)
    assert.deepEqual(lastTwoMonths(new Date("2026-09-30T23:30:00Z")), [
      "2026-10",
      "2026-09",
    ]);
  });
});

describe("a run", () => {
  it("asks the store for exactly the two months and the Agent API only for what the store listed", async () => {
    const f = fixture({
      "2026-09": [row(1, "2026-09")],
      "2026-10": [row(2), row(3)],
    });
    const summary = await runExternalInvoicePdfFill(f.deps);
    assert.deepEqual(f.monthsAsked, ["2026-09", "2026-10"]);
    assert.deepEqual(f.asked, [
      "ACRW-2026/00501",
      "ACRW-2026/00502",
      "ACRW-2026/00503",
    ]);
    assert.deepEqual(
      [summary.skipped, summary.examined, summary.stored, summary.failed],
      [null, 3, 3, 0],
    );
    assert.equal(f.puts.length, 3);
  });

  it("with nothing to do touches neither the Agent API nor the store, and says so in the line", async () => {
    const f = fixture({});
    let resolved = 0;
    f.deps.credential = async () => {
      resolved += 1;
      return { agentKey: "kulcs" };
    };
    const summary = await runExternalInvoicePdfFill(f.deps);
    assert.equal(resolved, 0);
    assert.deepEqual(
      [f.asked.length, f.marks.length, f.puts.length],
      [0, 0, 0],
    );
    assert.equal(
      externalPdfRunLine(summary),
      "Külső számla PDF-pótlás (2026-09, 2026-10): vizsgált 0, pótolt 0, közben már volt 0, hiba 0",
    );
  });

  it("a rejected invoice is counted and marked with its reason, the others are still stored", async () => {
    const f = fixture(
      { "2026-10": [row(1), row(2), row(3)] },
      { reject: ["ACRW-2026/00502"] },
    );
    const summary = await runExternalInvoicePdfFill(f.deps);
    assert.deepEqual(
      [summary.skipped, summary.examined, summary.stored, summary.failed],
      [null, 3, 2, 1],
    );
    assert.deepEqual(
      f.marks.filter(([, , reason]) => reason !== null),
      [["e2", null, "SZAMLAZZ_PDF_REJECTED_9"]],
    );
    assert.equal(
      externalPdfRunLine(summary),
      "Külső számla PDF-pótlás (2026-09, 2026-10): vizsgált 3, pótolt 2, közben már volt 0, hiba 1",
    );
  });

  it("a PDF that arrives for a row that got one in the meantime is counted apart, not as stored", async () => {
    const f = fixture({ "2026-10": [row(1), row(2), row(3)] });
    f.deps.store = {
      ...f.deps.store,
      // the second row already has a PDF by the time of the write
      setPdf: async (id, key, reason) => {
        f.marks.push([id, key, reason]);
        return id !== "e2";
      },
    };
    const summary = await runExternalInvoicePdfFill(f.deps);
    assert.deepEqual(
      [summary.stored, summary.alreadyHad, summary.failed],
      [2, 1, 0],
    );
    assert.equal(
      externalPdfRunLine(summary),
      "Külső számla PDF-pótlás (2026-09, 2026-10): vizsgált 3, pótolt 2, közben már volt 1, hiba 0",
    );
  });

  it("without a document store nothing is asked and nothing is written (the memory store would lose the bytes)", async () => {
    const f = fixture({ "2026-10": [row(1)] });
    const summary = await runExternalInvoicePdfFill({
      ...f.deps,
      documents: null,
    });
    assert.equal(summary.skipped, "DOCUMENT_STORE_NOT_SET");
    assert.deepEqual([f.asked.length, f.marks.length], [0, 0]);
    assert.match(
      externalPdfRunLine(summary),
      /nem futott le \(DOCUMENT_STORE_NOT_SET\)/,
    );
  });

  it("without a Számlázz.hu key nothing is asked and no row is marked as failed", async () => {
    const f = fixture({ "2026-10": [row(1), row(2)] });
    f.deps.credential = async () => {
      throw new Error("nincs kulcs");
    };
    const summary = await runExternalInvoicePdfFill(f.deps);
    assert.deepEqual(
      [summary.skipped, summary.examined, summary.stored],
      ["SZAMLAZZ_CREDENTIAL_UNAVAILABLE", 2, 0],
    );
    assert.deepEqual([f.asked.length, f.marks.length], [0, 0]);
  });

  it("a failing candidate query ends the run with a code instead of throwing", async () => {
    const f = fixture({});
    f.deps.store = {
      ...f.deps.store,
      candidates: async () => {
        throw new Error("db");
      },
    };
    const summary = await runExternalInvoicePdfFill(f.deps);
    assert.equal(summary.skipped, "CANDIDATES_FAILED");
    assert.equal(f.asked.length, 0);
  });
});

describe("the scheduler", () => {
  const scheduler = (env: NodeJS.ProcessEnv = {}) =>
    new ExternalInvoicePdfScheduler(
      { resolve: async () => ({ agentKey: "kulcs" }) } as never,
      undefined,
      env,
    );

  it("never throws, whatever goes wrong inside the run", async () => {
    const f = fixture({});
    const hostile = Object.defineProperty({ ...f.deps }, "documents", {
      get() {
        throw new Error("váratlan");
      },
    });
    const summary = await scheduler().runOnce(NOW, hostile);
    assert.equal(summary.skipped, "RUN_FAILED");
  });

  it("with no DOCUMENT_STORE_ROOT it does not run, whatever store the app holds", async () => {
    const f = fixture({ "2026-10": [row(1)] });
    const { documents: _documents, ...rest } = f.deps;
    const summary = await scheduler({}).runOnce(NOW, rest);
    assert.equal(summary.skipped, "DOCUMENT_STORE_NOT_SET");
    assert.equal(f.asked.length, 0);
  });

  it("with a DOCUMENT_STORE_ROOT it runs through the given deps", async () => {
    const f = fixture({ "2026-10": [row(1)] });
    const summary = await scheduler({
      DOCUMENT_STORE_ROOT: "/tmp/nem-hasznalt",
    }).runOnce(NOW, f.deps);
    assert.deepEqual([summary.skipped, summary.stored], [null, 1]);
  });
});
