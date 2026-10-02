import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ATTENTION_SOURCES,
  attentionItemsOf,
  sortAttentionItems,
} from "./attention.js";

describe("Figyelmet igényel: the figures", () => {
  it("never reads a shadow measurement or the frozen webshop", () => {
    for (const id of [
      "supplier-matching",
      "jev-intelligence",
      "webshop-orders",
      "pos-today",
    ])
      assert.ok(
        !(ATTENTION_SOURCES as readonly string[]).includes(id),
        `${id} must not feed the attention list`,
      );
  });

  it("takes only the actionable figure of each widget, and drops zeros", () => {
    assert.deepEqual(
      attentionItemsOf("overdue-invoices", {
        overdue: { count: 2, openAmounts: [] },
        dueToday: 9,
        dueWithinWeek: 9,
        noPaymentDataPastDue: 9,
      }).map((i) => [i.key, i.count]),
      [["overdue", 2]],
      "due-soon and no-payment-data figures are not overdue",
    );
    assert.deepEqual(
      attentionItemsOf("worksheets", {
        draft: 5,
        awaitingSignatureNotSent: 0,
        awaitingSignatureSent: 4,
        certificatesAwaitingSignedForm: 1,
      }),
      [],
    );
    assert.deepEqual(
      attentionItemsOf("service-tickets", {
        openCount: 9,
        byStatus: { NEW: 3, IN_PROGRESS: 6 },
        oldestOpenAt: null,
      }).map((i) => [i.key, i.count]),
      [["new", 3]],
    );
    assert.deepEqual(
      attentionItemsOf("stock-sync-outbox", {
        queued: 4,
        retrying: 1,
        deadLetter: 2,
        lastSuccessfulSyncAt: null,
      }).map((i) => [i.key, i.count]),
      [["dead-letter", 2]],
      "queued and retrying rows resolve themselves",
    );
  });

  it("settlements: errors and a failed last run are danger, review a warning", () => {
    const items = attentionItemsOf("settlements", {
      sources: [
        {
          source: "FOXPOST",
          needsReview: 2,
          errors: 1,
          lastRun: { status: "APPLIED", startedAt: "2026-10-01T00:00:00Z" },
        },
        {
          source: "GLS",
          needsReview: 1,
          errors: 0,
          lastRun: { status: "FAILED", startedAt: "2026-10-01T00:00:00Z" },
        },
        { source: "SIMPLEPAY", needsReview: 0, errors: 0, lastRun: null },
      ],
    });
    assert.deepEqual(
      items.map((i) => [i.key, i.count, i.tone]),
      [
        ["failed", 2, "danger"],
        ["review", 3, "warning"],
      ],
    );
  });

  it("danger first, then warning, then info, the source order kept within a tone", () => {
    const sorted = sortAttentionItems([
      ...attentionItemsOf("material-requests", {
        openCount: 1,
        oldestSubmittedAt: null,
        latest: [],
      }),
      ...attentionItemsOf("missing-invoices", {
        months: [
          {
            month: "2026-09",
            missing: 2,
            originalMissing: 1,
            notMatched: 1,
            noInvoice: 0,
            missingAmountHuf: "0",
            status: "OPEN",
          },
        ],
      }),
      ...attentionItemsOf("aquarium-alerts", {
        checked: 1,
        outOfRangeCount: 1,
        staleCount: 0,
        staleAfterDays: 14,
        items: [],
      }),
    ]);
    assert.deepEqual(
      sorted.map((i) => i.widgetId),
      ["aquarium-alerts", "missing-invoices", "material-requests"],
    );
  });
});
