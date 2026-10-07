import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatReport, parseArguments } from "./incoming-foreign-read.cli.js";
import { foreignReadSettings } from "./incoming-foreign-read.scheduler.js";

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
    assert.match(
      text,
      /doc-1\t2026-10-03\tEUR\tkitalalt\.example\tigen\tnem\t9\tvatAmount\t0/,
    );
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
