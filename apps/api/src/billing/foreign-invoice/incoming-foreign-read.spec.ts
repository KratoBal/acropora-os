import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import { prismaErrorSummary } from "./error-summary.js";
import { formatReport, parseArguments } from "./incoming-foreign-read.cli.js";
import {
  foreignReadSettings,
  IncomingForeignReadScheduler,
} from "./incoming-foreign-read.scheduler.js";
import type {
  IncomingReviewService,
  PendingReport,
} from "./incoming-review.service.js";

/**
 * A KÜLFÖLDI SZÁMLA KINYERÉS KAPCSOLÓI (kártya e4c3b0fb). MI PIROSÍT: ha a
 * parancs kapcsoló nélkül írna; ha egy elgépelt kapcsoló csendben kimaradna
 * (például `--aply`, és a futás csak olvasna, miközben írást vártak); ha az
 * időzítő magától bekapcsolna.
 */

describe("the CLI options", () => {
  it("reads only by default", () => {
    assert.deepEqual(parseArguments([]), {
      apply: false,
      json: false,
      since: null,
      limit: null,
    });
  });

  it("writes only with --apply, and takes since and limit", () => {
    assert.deepEqual(
      parseArguments(["--apply", "--since=2026-09-01", "--limit=5", "--json"]),
      { apply: true, json: true, since: "2026-09-01", limit: 5 },
    );
  });

  it("refuses an unknown or malformed option instead of ignoring it", () => {
    assert.throws(() => parseArguments(["--aply"]), /ismeretlen kapcsoló/);
    assert.throws(() => parseArguments(["--since=2026.09.01"]), /--since/);
    assert.throws(() => parseArguments(["--limit=0"]), /--limit/);
  });

  it("the report names the mode and carries no supplier name", () => {
    const text = formatReport(
      {
        total: 1,
        alreadyRead: 0,
        read: 1,
        written: 0,
        failed: 1,
        failures: [
          {
            documentId: "doc-2",
            error: "PrismaClientKnownRequestError P2000 (currency)",
          },
        ],
        withText: 1,
        withAdapter: 0,
        complete: 0,
        byCurrency: { EUR: 1 },
        bySenderDomain: { "kitalalt.example": 1 },
        rows: [
          {
            documentId: "doc-1",
            date: "2026-10-03",
            currency: "EUR",
            senderDomain: "kitalalt.example",
            hasText: true,
            adapter: false,
            filled: 9,
            missing: ["vatAmount"],
            warnings: 0,
          },
        ],
      },
      false,
    );
    assert.match(text, /^mód: csak olvas/);
    // a „csak olvas” nem teljes igazság: a párosítás a gyorsítótárat kitöltheti
    assert.match(text, /payeeCheck/);
    assert.match(
      text,
      /doc-1\t2026-10-03\tEUR\tkitalalt\.example\tigen\tnem\t9\tvatAmount\t0/,
    );
    assert.match(text, /kimaradt \(hiba\): 1/);
    assert.match(
      text,
      /kimaradt: doc-2 PrismaClientKnownRequestError P2000 \(currency\)/,
    );
  });
});

/*
  A HIBA FAJTÁJA, A TARTALMA NÉLKÜL (kulfoldi-szamla-olvasas-hiba). MI PIROSÍT:
  ha a naplóba csak az osztály neve kerül (2026-10-13 óta 24 futás bukott így,
  a kód nélkül); ha a Prisma `meta`-jából egy érték is a naplóba jut (a P2020
  `details`-e magát a túl nagy összeget idézi); ha egy nem Prisma hiba üzenete
  kiíródik.
*/
const known = (code: string, meta: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError("Kitalált üzenet 123456789,99 EUR", {
    code,
    clientVersion: "6.19.3",
    meta,
  });

describe("the error summary", () => {
  it("names the code and the field, never a value", () => {
    assert.equal(
      prismaErrorSummary(known("P2000", { column_name: "currency" })),
      "PrismaClientKnownRequestError P2000 (currency)",
    );
    assert.equal(
      prismaErrorSummary(
        known("P2002", {
          modelName: "IncomingDocumentReading",
          target: ["documentId"],
        }),
      ),
      "PrismaClientKnownRequestError P2002 (IncomingDocumentReading, documentId)",
    );
    const overflow = prismaErrorSummary(
      known("P2020", {
        details: "Value 123456789012345678901,00 out of range",
      }),
    );
    assert.equal(overflow, "PrismaClientKnownRequestError P2020");
    // a meta-ba csempészett érték sem kerül át, ha nem azonosító alakú
    assert.equal(
      prismaErrorSummary(
        known("P2003", { field_name: "Kitalált Kft. 81,30 EUR" }),
      ),
      "PrismaClientKnownRequestError P2003",
    );
    assert.equal(
      prismaErrorSummary(new TypeError("Kitalált Kft. számla")),
      "TypeError",
    );
    assert.equal(prismaErrorSummary("szöveg"), "UNKNOWN");
  });
});

describe("the scheduler run", () => {
  const report = (over: Partial<PendingReport>): PendingReport => ({
    total: 0,
    alreadyRead: 0,
    read: 0,
    written: 0,
    failed: 0,
    failures: [],
    withText: 0,
    withAdapter: 0,
    complete: 0,
    byCurrency: {},
    bySenderDomain: {},
    rows: [],
    ...over,
  });
  const scheduler = (readPending: () => Promise<PendingReport>) => {
    const lines: string[] = [];
    const run = new IncomingForeignReadScheduler({
      readPending,
    } as unknown as IncomingReviewService);
    const logger = {
      log: (m: string) => lines.push(`log ${m}`),
      warn: (m: string) => lines.push(`warn ${m}`),
      error: (m: string) => lines.push(`error ${m}`),
    };
    Object.assign(run, { logger });
    return { run, lines };
  };

  it("a skipped row is a warning with its id and code; the run still applies", async () => {
    const { run, lines } = scheduler(async () =>
      report({
        written: 2,
        failed: 1,
        failures: [
          { documentId: "doc-9", error: "PrismaClientKnownRequestError P2020" },
        ],
      }),
    );
    assert.equal(await run.runOnce(), "APPLIED");
    assert.deepEqual(lines, [
      "log Foreign invoice reading: 2 new",
      "warn Foreign invoice reading: 1 row(s) skipped: doc-9 PrismaClientKnownRequestError P2020",
    ]);
  });

  it("a failed run logs the code, not the message", async () => {
    const { run, lines } = scheduler(async () => {
      throw known("P2022", { column_name: "currency" });
    });
    assert.equal(await run.runOnce(), "FAILED");
    assert.deepEqual(lines, [
      "error Foreign invoice reading failed: PrismaClientKnownRequestError P2022 (currency)",
    ]);
  });
});

describe("the scheduler switch", () => {
  it("is off unless the switch is exactly true", () => {
    assert.equal(foreignReadSettings({}).on, false);
    assert.equal(
      foreignReadSettings({ INCOMING_FOREIGN_READ_ENABLED: "1" }).on,
      false,
    );
    assert.equal(
      foreignReadSettings({ INCOMING_FOREIGN_READ_ENABLED: " TRUE " }).on,
      true,
    );
  });

  it("keeps the interval sane and ignores a malformed since", () => {
    assert.deepEqual(
      foreignReadSettings({
        INCOMING_FOREIGN_READ_ENABLED: "true",
        INCOMING_FOREIGN_READ_INTERVAL_MINUTES: "1",
        INCOMING_FOREIGN_READ_SINCE: "tegnap",
      }),
      { on: true, intervalMinutes: 60, since: null },
    );
    assert.equal(
      foreignReadSettings({ INCOMING_FOREIGN_READ_SINCE: "2026-09-01" }).since,
      "2026-09-01",
    );
  });
});
