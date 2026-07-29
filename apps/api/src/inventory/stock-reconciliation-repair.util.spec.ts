import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import {
  buildRepairIdempotencyKey,
  evaluateLocalFromProvenLedgerPreconditions,
  evaluateRepublishPreconditions,
} from "./stock-reconciliation-repair.util.js";

function d(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

describe("buildRepairIdempotencyKey", () => {
  it("is deterministic for the same (repairType, stockItemId, expectedCurrentOnHand)", () => {
    const a = buildRepairIdempotencyKey("LOCAL_FROM_PROVEN_LEDGER", "si-1", "5");
    const b = buildRepairIdempotencyKey("LOCAL_FROM_PROVEN_LEDGER", "si-1", "5");
    assert.equal(a, b);
  });

  it("differs when expectedCurrentOnHand differs - a later, distinct repair gets its own key", () => {
    const a = buildRepairIdempotencyKey("LOCAL_FROM_PROVEN_LEDGER", "si-1", "5");
    const b = buildRepairIdempotencyKey("LOCAL_FROM_PROVEN_LEDGER", "si-1", "7");
    assert.notEqual(a, b);
  });

  it("differs between the two repair types for the same StockItem/value", () => {
    const a = buildRepairIdempotencyKey("LOCAL_FROM_PROVEN_LEDGER", "si-1", "5");
    const b = buildRepairIdempotencyKey("REPUBLISH_LOCAL_TO_UNAS", "si-1", "5");
    assert.notEqual(a, b);
  });

  it("differs between two different StockItems asserting the same value", () => {
    const a = buildRepairIdempotencyKey("LOCAL_FROM_PROVEN_LEDGER", "si-1", "5");
    const b = buildRepairIdempotencyKey("LOCAL_FROM_PROVEN_LEDGER", "si-2", "5");
    assert.notEqual(a, b);
  });

  it("never embeds anything beyond repairType/stockItemId/expectedCurrentOnHand (no sensitive data)", () => {
    const key = buildRepairIdempotencyKey("LOCAL_FROM_PROVEN_LEDGER", "si-1", "5");
    assert.equal(key, "RECONCILIATION_REPAIR:LOCAL_FROM_PROVEN_LEDGER:si-1:5");
  });
});

describe("evaluateLocalFromProvenLedgerPreconditions", () => {
  it("rejects with LEDGER_NOT_PROVABLE when ledgerProvable is false, regardless of the value match", () => {
    const code = evaluateLocalFromProvenLedgerPreconditions({
      ledgerProvable: false,
      localOnHand: d("5"),
      expectedCurrentOnHand: d("5"),
    });
    assert.equal(code, "LEDGER_NOT_PROVABLE");
  });

  it("rejects with STALE_EXPECTED_CURRENT_VALUE when localOnHand no longer matches the caller's snapshot", () => {
    const code = evaluateLocalFromProvenLedgerPreconditions({
      ledgerProvable: true,
      localOnHand: d("6"),
      expectedCurrentOnHand: d("5"),
    });
    assert.equal(code, "STALE_EXPECTED_CURRENT_VALUE");
  });

  it("rejects with STALE_EXPECTED_CURRENT_VALUE when localOnHand is null (no StockItem)", () => {
    const code = evaluateLocalFromProvenLedgerPreconditions({
      ledgerProvable: true,
      localOnHand: null,
      expectedCurrentOnHand: d("5"),
    });
    assert.equal(code, "STALE_EXPECTED_CURRENT_VALUE");
  });

  it("treats differently-formatted but numerically-equal decimals as a match, not a stale rejection", () => {
    const code = evaluateLocalFromProvenLedgerPreconditions({
      ledgerProvable: true,
      localOnHand: d("5.000000"),
      expectedCurrentOnHand: d("5"),
    });
    assert.equal(code, null);
  });

  it("passes (returns null) when the ledger is provable and the value matches", () => {
    const code = evaluateLocalFromProvenLedgerPreconditions({
      ledgerProvable: true,
      localOnHand: d("5"),
      expectedCurrentOnHand: d("5"),
    });
    assert.equal(code, null);
  });

  it("LEDGER_NOT_PROVABLE takes precedence over a stale value (checked first)", () => {
    const code = evaluateLocalFromProvenLedgerPreconditions({
      ledgerProvable: false,
      localOnHand: d("999"),
      expectedCurrentOnHand: d("5"),
    });
    assert.equal(code, "LEDGER_NOT_PROVABLE");
  });
});

describe("evaluateRepublishPreconditions", () => {
  it("rejects with MISSING_UNAS_LINK when the variant has no UNAS link, regardless of everything else", () => {
    const code = evaluateRepublishPreconditions({
      hasUnasLink: false,
      localOnHand: d("5"),
      expectedCurrentOnHand: d("5"),
      hasCompetingOpenOutboxRow: false,
    });
    assert.equal(code, "MISSING_UNAS_LINK");
  });

  it("rejects with STALE_EXPECTED_CURRENT_VALUE when localOnHand has moved since the caller's snapshot", () => {
    const code = evaluateRepublishPreconditions({
      hasUnasLink: true,
      localOnHand: d("6"),
      expectedCurrentOnHand: d("5"),
      hasCompetingOpenOutboxRow: false,
    });
    assert.equal(code, "STALE_EXPECTED_CURRENT_VALUE");
  });

  it("rejects with ALREADY_QUEUED when a PENDING/PROCESSING row already covers this pair", () => {
    const code = evaluateRepublishPreconditions({
      hasUnasLink: true,
      localOnHand: d("5"),
      expectedCurrentOnHand: d("5"),
      hasCompetingOpenOutboxRow: true,
    });
    assert.equal(code, "ALREADY_QUEUED");
  });

  it("passes (returns null) when linked, current, and nothing competing is queued", () => {
    const code = evaluateRepublishPreconditions({
      hasUnasLink: true,
      localOnHand: d("5"),
      expectedCurrentOnHand: d("5"),
      hasCompetingOpenOutboxRow: false,
    });
    assert.equal(code, null);
  });
});
