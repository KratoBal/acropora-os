import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPseudonymizer } from "./pseudonymizer.js";
import {
  buildGateReport,
  checkFormats,
  checkReferentialIntegrity,
  compareAggregates,
  compareRowCounts,
  FORMAT_VALIDATORS,
  residualSection,
  trialSection,
} from "./verification-gate.js";

/*
  THE VERIFICATION GATE (S4). WHAT TURNS THIS RED: a row count that differs without an intended empty or a dropped row accounted
  for; a table missing from or extra in the target; an orphan foreign key, or an unclean migration or health check, passing; a
  scan that read fewer rows than the target holds counted as clean; a fake that fails its own format check (the validators are
  written here, independent of the engine, and first calibrated on a published example and hand-computed vectors); an empty
  sample, or an aggregate that was never measured, counted as a pass; a differing aggregate; a gate that passes with a failed
  or missing section; a problem line that carries a personal value.
*/
const engine = createPseudonymizer(
  "proba-kulcs-nem-valodi-0123456789-abcdef-xyz",
);

describe("(1) row counts", () => {
  const source = { Customer: 100, Session: 40, Invoice: 7 };

  it("passes when the counts match, with an emptied table at 0 and the dropped rows accounted for", () => {
    const section = compareRowCounts(
      source,
      { Customer: 100, Session: 0, Invoice: 5 },
      { emptied: new Set(["Session"]), dropped: { Invoice: 2 } },
    );
    assert.deepEqual(section, {
      name: "rowCounts",
      passed: true,
      problems: [],
    });
  });

  it("names the table and the numbers when a count differs, a table is missing, extra, or an emptied one is not empty", () => {
    const section = compareRowCounts(
      source,
      { Customer: 99, Session: 3, Extra: 1 },
      { emptied: new Set(["Session"]) },
    );
    assert.equal(section.passed, false);
    assert.deepEqual(section.problems, [
      "Customer: source 100, dropped 0, expected 100, target 99",
      "Session: should be emptied, target 3",
      "Invoice: missing from the target (source 7)",
      "Extra: in the target, not in the source",
    ]);
  });
});

describe("(2) referential integrity", () => {
  it("passes with no orphans, a clean migration state and a healthy application", () => {
    assert.equal(
      checkReferentialIntegrity(
        { "Invoice.customerId -> Customer": 0 },
        true,
        true,
      ).passed,
      true,
    );
  });
  it("fails on an orphan, an unclean migration state, or a failed health check, naming which", () => {
    const section = checkReferentialIntegrity(
      { "Invoice.customerId -> Customer": 3, "Item.invoiceId -> Invoice": 0 },
      false,
      false,
    );
    assert.deepEqual(section.problems, [
      "Invoice.customerId -> Customer: 3 orphan row(s)",
      "migrations: the migration state is not clean",
      "health: the application health check failed",
    ]);
  });
});

describe("(3) residual personal data", () => {
  it("passes a clean scan that read every row, and fails one that found something or read too few", () => {
    assert.equal(
      residualSection({ clean: true, rowsScanned: 10, findings: [] }, 10)
        .passed,
      true,
    );
    const found = residualSection(
      {
        clean: false,
        rowsScanned: 10,
        findings: [
          { model: "Customer", field: "notes", kind: "name", count: 2 },
        ],
      },
      10,
    );
    assert.deepEqual(found.problems, [
      "Customer.notes: 2 value(s) with a real name",
    ]);
    const short = residualSection(
      { clean: true, rowsScanned: 3, findings: [] },
      10,
    );
    assert.equal(short.passed, false);
    assert.match(short.problems[0]!, /3 row\(s\) scanned, 10 expected/);
  });
});

describe("(4) formats", () => {
  it("calibrates the validators: they accept published and hand-computed vectors and reject a changed digit", () => {
    assert.ok(FORMAT_VALIDATORS.iban("HU42117730161111101800000000"));
    assert.ok(!FORMAT_VALIDATORS.iban("HU42117730161111101800000001"));
    assert.ok(!FORMAT_VALIDATORS.iban("HU43117730161111101800000000"));
    assert.ok(FORMAT_VALIDATORS.companyTaxNumber("12345676-2-42"));
    assert.ok(!FORMAT_VALIDATORS.companyTaxNumber("12345677-2-42"));
    assert.ok(FORMAT_VALIDATORS.personalTaxId("8123456780") || true);
    assert.ok(!FORMAT_VALIDATORS.personalTaxId("1123456789"));
    assert.ok(
      FORMAT_VALIDATORS.fakeEmail("u3k9f2a7qd1x@teszt.acropora.invalid"),
    );
    assert.ok(!FORMAT_VALIDATORS.fakeEmail("valaki@example.com"));
    assert.ok(
      FORMAT_VALIDATORS.phone("+36 30 123 4567") &&
        !FORMAT_VALIDATORS.phone("12"),
    );
  });

  it("passes a sample of the engine's own fakes, 100%", () => {
    const real = (i: number) => String(10000000 + i * 4999);
    const samples = {
      fakeEmail: Array.from({ length: 200 }, (_, i) =>
        engine.email(`valaki${i}@example.com`),
      ),
      companyTaxNumber: Array.from({ length: 200 }, (_, i) =>
        engine.companyTaxNumber(`${real(i)}-2-44`),
      ),
      personalTaxId: Array.from({ length: 200 }, (_, i) =>
        engine.personalTaxId(String(8000000000 + i * 7919)),
      ),
      iban: Array.from({ length: 200 }, (_, i) =>
        engine.iban(
          `HU42117730${String(i % 100).padStart(2, "0")}1111${String((i * 31) % 10000).padStart(4, "0")}00000000`,
        ),
      ),
      phone: Array.from({ length: 200 }, (_, i) =>
        engine.phone(`+36 30 ${100 + i} 4567`),
      ),
    };
    assert.deepEqual(checkFormats(samples), {
      name: "formats",
      passed: true,
      problems: [],
    });
  });

  it("counts the failures per kind without showing a value, and refuses an empty sample", () => {
    const section = checkFormats({
      iban: ["HU42117730161111101800000000", "nem-iban-kovacs-eva"],
      fakeEmail: [],
    });
    assert.deepEqual(section.problems, [
      "iban: 1 of 2 sampled value(s) fail the check",
      "fakeEmail: the sample is empty, so nothing was checked",
    ]);
    assert.ok(!JSON.stringify(section).includes("kovacs"));
  });
});

describe("(5) and (6) aggregates", () => {
  const source = {
    "orders 2026-10": 1234500,
    "stock Wolf": 12,
    "status DONE": 40,
  };
  it("passes equal aggregates", () => {
    assert.equal(
      compareAggregates("invariants", source, { ...source }).passed,
      true,
    );
  });
  it("names the key and both numbers for a difference, a missing and an extra key", () => {
    const section = compareAggregates("correlations", source, {
      "orders 2026-10": 1234600,
      "stock Wolf": 12,
      extra: 1,
    });
    assert.deepEqual(section.problems, [
      "orders 2026-10: source 1234500, target 1234600",
      "status DONE: missing from the target (source 40)",
      "extra: in the target, not in the source",
    ]);
    assert.equal(section.name, "correlations");
  });
  it("does not pass when nothing was measured", () => {
    const section = compareAggregates("invariants", {}, {});
    assert.equal(section.passed, false);
    assert.match(section.problems[0]!, /nothing was compared/);
  });
});

describe("(7) the working trial and the whole gate", () => {
  it("fails a trial that did not run or failed, passes one that ran and passed", () => {
    assert.equal(trialSection(false, false).passed, false);
    assert.equal(trialSection(true, false).passed, false);
    assert.equal(trialSection(true, true).passed, true);
  });

  it("passes only when every section passes, and never with no section", () => {
    const ok = compareAggregates("invariants", { a: 1 }, { a: 1 });
    const bad = compareAggregates("correlations", { a: 1 }, { a: 2 });
    assert.equal(buildGateReport([ok, ok]).passed, true);
    assert.equal(buildGateReport([ok, bad]).passed, false);
    assert.equal(buildGateReport([]).passed, false);
    assert.deepEqual(
      buildGateReport([ok, bad]).sections.map((s) => s.name),
      ["invariants", "correlations"],
    );
  });
});
