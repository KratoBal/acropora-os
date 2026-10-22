import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GoogleReadonlyError } from "../integrations/google/google-readonly.client.js";
import {
  ExternalInvoiceMailPdfScheduler,
  externalInvoiceMailPdfScheduleOn,
  externalMailPdfRunLine,
  msUntilNextAt,
  runExternalInvoiceMailPdfFill,
  type ExternalMailPdfRunDeps,
} from "./external-invoice-mail-pdf.scheduler.js";
import type { MailPdf, MailPdfCandidate } from "./external-invoice-mail-pdf.js";
import { externalInvoicePdfScheduleOn } from "./external-invoice-pdf.scheduler.js";

/**
 * THE DAILY PDF CATCH-UP FROM THE CMFX LETTERS (card 10964cc7 follow-up, acrobot
 * 35299). What turns red: the run is off by default, or shares its switch with
 * the Számlázz.hu catch-up; it reads the mailbox for a month with nothing to
 * fill; it looks at other months than this and the previous one; a letter that
 * failed a check, or a month that could not be read, goes unseen in the line or
 * stops the other month; a letter's file name or an invoice number reaches the
 * log line; a row that got a PDF in the meantime is counted as stored.
 */
const NOW = new Date("2026-10-22T04:00:00Z");
// the payable total as pdfTextLines puts it in a line, matching the default gross below
const PAYABLE = "HUF | FIZETENDŐ BRUTTÓ VÉGÖSSZEG: | 29 210";

const pdf = (
  fileName: string,
  text: string,
  authenticated = true,
  gross = PAYABLE,
): MailPdf => ({
  messageId: "m1",
  fileName,
  buffer: Buffer.from(
    `%PDF-1.4\nEladó adószáma: 23916229-2-42\n${text}\n${gross}\n`,
  ),
  authenticated,
});
const textOf = async (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("utf8").split("\n");
const candidate = (n: number, month = "2026-10"): MailPdfCandidate => ({
  id: `e${n}`,
  documentNumber: `ACRW-2026/0050${n}`,
  issueDate: new Date(`${month}-05T00:00:00.000Z`),
  grossAmount: "29210.00",
});
const letter = (n: number, over: Partial<MailPdf> = {}): MailPdf => ({
  ...pdf(`E-ACRW-2026-0050${n}-f00d.pdf`, `Számla ACRW-2026/0050${n}`),
  ...over,
});

function fixture(
  byMonth: Record<string, MailPdfCandidate[]>,
  letters: Record<string, MailPdf[] | Error> = {},
) {
  const candidatesAsked: string[] = [];
  const mailAsked: string[] = [];
  const sets: [string, string][] = [];
  const puts: string[] = [];
  const deps: ExternalMailPdfRunDeps = {
    now: NOW,
    candidates: async (month) => {
      candidatesAsked.push(month);
      return byMonth[month] ?? [];
    },
    mail: async (month) => {
      mailAsked.push(month);
      const found = letters[month] ?? [];
      if (found instanceof Error) throw found;
      return found;
    },
    textOf,
    documents: {
      put: async (key) => void puts.push(`${key.ownerId}/${key.documentId}`),
    },
    store: { setPdf: async (id, key) => void sets.push([id, key]) },
  };
  return { deps, candidatesAsked, mailAsked, sets, puts };
}

describe("the switch", () => {
  it("is ON by default and off only for an explicit off value", () => {
    assert.equal(externalInvoiceMailPdfScheduleOn({}), true);
    for (const value of ["", "1", "true", "igen"])
      assert.equal(
        externalInvoiceMailPdfScheduleOn({
          EXTERNAL_INVOICE_MAIL_PDF_SCHEDULE: value,
        }),
        true,
        value,
      );
    for (const value of ["0", "false", "OFF", " no "])
      assert.equal(
        externalInvoiceMailPdfScheduleOn({
          EXTERNAL_INVOICE_MAIL_PDF_SCHEDULE: value,
        }),
        false,
        value,
      );
  });

  it("is its own: the Számlázz.hu catch-up's switch does not move it, and the other way round", () => {
    assert.equal(
      externalInvoiceMailPdfScheduleOn({ EXTERNAL_INVOICE_PDF_SCHEDULE: "0" }),
      true,
    );
    assert.equal(
      externalInvoicePdfScheduleOn({ EXTERNAL_INVOICE_MAIL_PDF_SCHEDULE: "0" }),
      true,
    );
  });
});

describe("the time of the run", () => {
  it("is the next 06:10 local time, today if it is still ahead, otherwise tomorrow", () => {
    const minutes = (now: Date) => msUntilNextAt(now, 6, 10) / 60_000;
    assert.equal(minutes(new Date(2026, 9, 22, 5, 0, 0)), 70);
    assert.equal(minutes(new Date(2026, 9, 22, 6, 9, 0)), 1);
    assert.equal(minutes(new Date(2026, 9, 22, 6, 10, 0)), 24 * 60);
    assert.equal(minutes(new Date(2026, 9, 22, 6, 11, 0)), 24 * 60 - 1);
  });
});

describe("a run", () => {
  it("asks the previous and the current month, reads the mailbox only where there is a candidate, and stores what checks out", async () => {
    const f = fixture(
      { "2026-10": [candidate(1), candidate(2)] },
      { "2026-10": [letter(1), letter(2)] },
    );
    const summary = await runExternalInvoiceMailPdfFill(f.deps);
    assert.deepEqual(f.candidatesAsked, ["2026-09", "2026-10"]);
    // 2026-09 had no candidate: its letters are not read
    assert.deepEqual(f.mailAsked, ["2026-10"]);
    assert.deepEqual(
      [summary.skipped, summary.examined, summary.stored, summary.failed],
      [null, 2, 2, 0],
    );
    assert.equal(f.puts.length, 2);
  });

  it("a row whose letter did not come is counted apart and is not a failure", async () => {
    const f = fixture(
      { "2026-10": [candidate(1), candidate(2)] },
      { "2026-10": [letter(1)] },
    );
    const summary = await runExternalInvoiceMailPdfFill(f.deps);
    assert.deepEqual(
      [summary.stored, summary.noMail, summary.failed],
      [1, 1, 0],
    );
  });

  it("a letter that fails a check, or comes unauthenticated, is a failure and stores nothing", async () => {
    const f = fixture(
      { "2026-10": [candidate(1), candidate(2), candidate(3)] },
      {
        "2026-10": [
          // the payable total is not the feed row's
          letter(
            1,
            pdf(
              "E-ACRW-2026-00501-f00d.pdf",
              "Számla ACRW-2026/00501",
              true,
              "HUF | FIZETENDŐ BRUTTÓ VÉGÖSSZEG: | 1 000",
            ),
          ),
          // the number is not in the PDF text
          letter(
            2,
            pdf("E-ACRW-2026-00502-f00d.pdf", "Számla ACRW-2026/00999"),
          ),
          // not signed by cmfx (DKIM / DMARC)
          letter(3, { authenticated: false }),
        ],
      },
    );
    const summary = await runExternalInvoiceMailPdfFill(f.deps);
    assert.deepEqual([summary.stored, summary.failed], [0, 3]);
    assert.deepEqual([f.sets.length, f.puts.length], [0, 0]);
  });

  it("a row that got a PDF in the meantime is counted apart, not as stored", async () => {
    const f = fixture(
      { "2026-10": [candidate(1), candidate(2)] },
      { "2026-10": [letter(1), letter(2)] },
    );
    f.deps.store = { setPdf: async (id) => id !== "e2" };
    const summary = await runExternalInvoiceMailPdfFill(f.deps);
    assert.deepEqual(
      [summary.stored, summary.alreadyHad, summary.failed],
      [1, 1, 0],
    );
  });

  it("a month whose mailbox read fails is a counted failure with its code, and the other month still runs", async () => {
    const f = fixture(
      { "2026-09": [candidate(1, "2026-09")], "2026-10": [candidate(2)] },
      {
        "2026-09": new GoogleReadonlyError("GOOGLE_RATE_LIMITED"),
        "2026-10": [letter(2)],
      },
    );
    const summary = await runExternalInvoiceMailPdfFill(f.deps);
    assert.deepEqual(
      [summary.stored, summary.failed, summary.errorCodes],
      [1, 1, ["GOOGLE_RATE_LIMITED"]],
    );
    assert.deepEqual(f.mailAsked, ["2026-09", "2026-10"]);
  });

  it("an error with no safe code is reported with a fixed code, never its text", async () => {
    const f = fixture(
      { "2026-10": [candidate(1)] },
      { "2026-10": new Error("a levél tárgya: Titkos számla 99") },
    );
    const summary = await runExternalInvoiceMailPdfFill(f.deps);
    assert.deepEqual(summary.errorCodes, ["MAIL_PDF_FILL_FAILED"]);
  });

  it("without a document store nothing is asked, nothing is read, nothing is written", async () => {
    const f = fixture(
      { "2026-10": [candidate(1)] },
      { "2026-10": [letter(1)] },
    );
    const summary = await runExternalInvoiceMailPdfFill({
      ...f.deps,
      documents: null,
    });
    assert.equal(summary.skipped, "DOCUMENT_STORE_NOT_SET");
    assert.deepEqual(
      [f.candidatesAsked.length, f.mailAsked.length, f.sets.length],
      [0, 0, 0],
    );
  });
});

describe("the log line", () => {
  it("carries counts and codes only: no invoice number, no file name, no letter text", async () => {
    const f = fixture(
      { "2026-10": [candidate(1), candidate(2)] },
      {
        "2026-10": [
          letter(1),
          letter(2, {
            authenticated: false,
            fileName: "E-ACRW-2026-00502-ab12.pdf",
          }),
        ],
      },
    );
    const line = externalMailPdfRunLine(
      await runExternalInvoiceMailPdfFill(f.deps),
    );
    assert.equal(
      line,
      "Külső számla PDF-pótlás cmfx-levélből (2026-09, 2026-10): vizsgált 2, pótolt 1, közben már volt 0, levél nélkül 0, hiba 1",
    );
    assert.doesNotMatch(line, /ACRW|cmfx\.hu|\.pdf|ertesito/);
  });

  it("names the codes of the months that could not be read", () => {
    assert.match(
      externalMailPdfRunLine({
        skipped: null,
        months: ["2026-10", "2026-09"],
        examined: 3,
        stored: 0,
        alreadyHad: 0,
        noMail: 0,
        failed: 1,
        errorCodes: ["GOOGLE_RATE_LIMITED"],
      }),
      /hiba 1 \[GOOGLE_RATE_LIMITED\]$/,
    );
  });
});

describe("the scheduler", () => {
  const scheduler = (env: NodeJS.ProcessEnv = {}) =>
    new ExternalInvoiceMailPdfScheduler(undefined, env);

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
    const f = fixture(
      { "2026-10": [candidate(1)] },
      { "2026-10": [letter(1)] },
    );
    const { documents: _documents, ...rest } = f.deps;
    const summary = await scheduler({}).runOnce(NOW, rest);
    assert.equal(summary.skipped, "DOCUMENT_STORE_NOT_SET");
    assert.equal(f.mailAsked.length, 0);
  });

  it("with a DOCUMENT_STORE_ROOT it runs through the given deps", async () => {
    const f = fixture(
      { "2026-10": [candidate(1)] },
      { "2026-10": [letter(1)] },
    );
    const summary = await scheduler({
      DOCUMENT_STORE_ROOT: "/tmp/nem-hasznalt",
    }).runOnce(NOW, f.deps);
    assert.deepEqual([summary.skipped, summary.stored], [null, 1]);
  });
});
