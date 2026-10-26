import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  classifyIssuing,
  numberInNote,
  report,
  summarize,
  type StuckRow,
} from "./billing-issuing-diagnose.js";

const NOW = new Date("2026-10-26T12:00:00Z");
const row = (over: Partial<StuckRow>): StuckRow => ({
  id: "inv-1",
  documentType: "INVOICE",
  status: "ISSUING",
  syncError: null,
  invoiceNumber: null,
  issueAttemptCount: 1,
  updatedAt: new Date("2026-10-26T06:00:00Z"),
  ...over,
});

/** The sentences exactly as the issue and preview services write them. */
const NOTE = {
  noReply:
    "A Számlázz.hu válasza nem érkezett meg (HTTP 504). Ellenőrizd a Számlázz.hu-n, készült-e bizonylat, mielőtt bármit újra próbálsz.",
  unclear:
    "A Számlázz.hu válasza nem mondta meg egyértelműen, elkészült-e a bizonylat (nincs hibakód és nincs szám). Ellenőrizd a Számlázz.hu-n.",
  recording:
    "A Számlázz.hu kiállította a(z) ACR-2026-77 bizonylatot, de a rögzítése nálunk nem sikerült. Rögzítsd kézzel ezt a számot.",
  stray:
    "Egy előnézet-kérés valódi bizonylatot hozott létre a Számlázz.hu-n: ACR-2026-78. Ellenőrizd a Számlázz.hu-n, mielőtt bármit újra próbálsz.",
};

describe("classifyIssuing", () => {
  it("names the six ways into ISSUING from the notes the services write", () => {
    const kinds = [
      NOTE.noReply,
      NOTE.unclear,
      NOTE.recording,
      NOTE.stray,
      null,
      "valami egészen más",
    ].map((syncError) => classifyIssuing(row({ syncError }), NOW).kind);
    assert.deepEqual(kinds, [
      "NO_REPLY",
      "UNCLEAR_REPLY",
      "RECORDING_FAILED",
      "STRAY_PREVIEW",
      "NO_NOTE",
      "OTHER",
    ]);
  });

  it("an empty or blank note is NO_NOTE, not OTHER", () => {
    for (const syncError of ["", "   "])
      assert.equal(classifyIssuing(row({ syncError }), NOW).kind, "NO_NOTE");
  });

  it("only the recording failure and the stray preview are certain to exist, and only they carry the number", () => {
    const facts = [
      NOTE.noReply,
      NOTE.unclear,
      NOTE.recording,
      NOTE.stray,
      null,
    ].map((syncError) => {
      const c = classifyIssuing(row({ syncError }), NOW);
      return [c.existsForSure, c.knownNumber];
    });
    assert.deepEqual(facts, [
      [false, null],
      [false, null],
      [true, "ACR-2026-77"],
      [true, "ACR-2026-78"],
      [false, null],
    ]);
  });

  it("measures the age in hours from the last update", () => {
    assert.equal(classifyIssuing(row({}), NOW).ageHours, 6);
    assert.equal(
      classifyIssuing(row({ updatedAt: new Date("2026-10-26T11:15:00Z") }), NOW)
        .ageHours,
      0.8,
    );
  });
});

describe("numberInNote", () => {
  it("reads the number out of both known sentences, and nothing out of the others", () => {
    assert.equal(numberInNote(NOTE.recording), "ACR-2026-77");
    assert.equal(numberInNote(NOTE.stray), "ACR-2026-78");
    assert.equal(numberInNote(NOTE.noReply), null);
    assert.equal(numberInNote(NOTE.unclear), null);
  });
});

describe("summarize and report", () => {
  const rows = [
    row({
      id: "a",
      syncError: NOTE.noReply,
      updatedAt: new Date("2026-10-20T12:00:00Z"),
    }),
    row({ id: "b", syncError: NOTE.recording }),
    row({
      id: "c",
      status: "ISSUE_FAILED",
      syncError: "A Számlázz.hu elutasította (3): ...",
    }),
    row({ id: "d", syncError: null, documentType: "STORNO" }),
  ];

  it("counts ISSUING by kind apart from ISSUE_FAILED, which is not a dead end, and lists the oldest first", () => {
    const { summary, stuck } = summarize(rows, NOW);
    assert.equal(summary.issuing, 3);
    assert.equal(summary.failed, 1);
    assert.equal(summary.existForSure, 1);
    assert.deepEqual(summary.byKind, {
      RECORDING_FAILED: 1,
      STRAY_PREVIEW: 0,
      NO_REPLY: 1,
      UNCLEAR_REPLY: 0,
      NO_NOTE: 1,
      OTHER: 0,
    });
    assert.deepEqual(
      stuck.map((s) => s.id),
      ["a", "b", "d"],
    );
  });

  it("the report puts the totals first and names the number where there is one", () => {
    const text = report(rows, NOW);
    assert.match(text, /^CSAK OLVASÁS/);
    assert.match(
      text,
      /ISSUING: 3 \(ebből biztosan létező bizonylat: 1\), ISSUE_FAILED: 1/,
    );
    assert.match(text, /b {2}INVOICE {2}RECORDING_FAILED {2}szám: ACR-2026-77/);
  });

  it("says plainly when nothing is stuck", () => {
    assert.match(report([], NOW), /Nincs ISSUING-ben álló bizonylat\./);
  });
});

/**
 * The classifier reads sentences that live in the services. If someone rewords one there, the kind silently
 * becomes OTHER; so the markers are pinned to the source files themselves.
 */
describe("the classifier markers still stand in the services", () => {
  // the test runs from apps/api, as the other source-reading specs do
  const issue = readFileSync(
    "src/billing/billing-document-issue.service.ts",
    "utf8",
  );
  const preview = readFileSync(
    "src/billing/billing-document-preview.service.ts",
    "utf8",
  );

  it("the issue service writes the three notes", () => {
    for (const marker of [
      // the note written to the row (with its parenthesis), not the exception text shown to the user
      "válasza nem érkezett meg (",
      "nem mondta meg egyértelműen",
      "a rögzítése nálunk nem sikerült",
      // the number is read out of these two whole sentences (numberInNote): the part after it is pinned too
      "A Számlázz.hu kiállította a(z) ${response.invoiceNumber} bizonylatot, de a rögzítése nálunk nem sikerült",
    ])
      assert.ok(issue.includes(marker), marker);
  });

  it("the preview service writes the stray note", () => {
    assert.ok(
      preview.includes(
        "Egy előnézet-kérés valódi bizonylatot hozott létre a Számlázz.hu-n: ${response.invoiceNumber}. Ellenőrizd",
      ),
    );
  });
});
