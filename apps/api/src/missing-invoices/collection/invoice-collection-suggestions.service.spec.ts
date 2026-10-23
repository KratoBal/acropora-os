import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  InvoiceCollectionSuggestionsRepository,
  SuggestionRow,
} from "./invoice-collection-suggestions.repository.js";
import {
  InvoiceCollectionSuggestionsService,
  UNASSIGNED_STALE_AFTER_DAYS,
  toSuggestion,
} from "./invoice-collection-suggestions.service.js";

const NOW = new Date("2026-12-31T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function row(
  id: string,
  reviewState: string,
  ageDays: number,
  overrides: Partial<SuggestionRow> = {},
): SuggestionRow {
  return {
    id,
    reviewState,
    fileName: `${id}.pdf`,
    sender: "invoice@szallito.example",
    subject: "Invoice",
    receivedAt: null,
    suggestionConfidence: null,
    suggestionDecisionRunId: null,
    textReading: {
      invoiceNumber: "RE67456",
      gross: "1063.00",
      currency: "EUR",
    },
    createdAt: new Date(NOW.getTime() - ageDays * DAY),
    ...overrides,
  } as SuggestionRow;
}

/**
 * A DÖNTÉS NÉLKÜL MARADT FÁJL FIGYELMEZTETÉSE (acrobot 35565): 60 nap után jelez,
 * automatikusan NEM töröl. MI PIROSÍT: ha a határ nem 60 nap, vagy a pont a
 * határon már régi (a határ fölött kell lennie); ha a Jev javaslata is régi lenne;
 * ha az állapot rossz; ha a darabszám nem a régi, döntés nélküli fájlokat számolja.
 */
describe("toSuggestion state and staleness", () => {
  it("warns only about an UNASSIGNED file older than the limit, and not at the limit itself", () => {
    assert.equal(UNASSIGNED_STALE_AFTER_DAYS, 60);
    assert.equal(toSuggestion(row("a", "UNASSIGNED", 59), NOW).stale, false);
    assert.equal(toSuggestion(row("b", "UNASSIGNED", 60), NOW).stale, false);
    assert.equal(toSuggestion(row("c", "UNASSIGNED", 60.01), NOW).stale, true);
    assert.equal(toSuggestion(row("d", "UNASSIGNED", 200), NOW).stale, true);
  });

  it("never calls a Jev suggestion stale, however old", () => {
    const suggestion = toSuggestion(
      row("e", "SUGGESTED", 200, { suggestionConfidence: "0.9" as never }),
      NOW,
    );
    assert.equal(suggestion.stale, false);
    assert.equal(suggestion.state, "SUGGESTED");
    assert.equal(suggestion.confidence, 0.9);
  });

  it("maps the state and leaves an unassigned file without a confidence", () => {
    const unassigned = toSuggestion(row("f", "UNASSIGNED", 1), NOW);
    assert.equal(unassigned.state, "UNASSIGNED");
    assert.equal(unassigned.confidence, null);
    assert.equal(unassigned.invoiceNumber, "RE67456");
  });
});

describe("InvoiceCollectionSuggestionsService.list", () => {
  it("returns the limit and the count of the stale unassigned files, and deletes nothing", async () => {
    const calls: string[] = [];
    const repository = {
      list: async () => {
        calls.push("list");
        return [
          row("old-1", "UNASSIGNED", 90),
          row("old-2", "UNASSIGNED", 61),
          row("new-1", "UNASSIGNED", 5),
          row("jev-old", "SUGGESTED", 400),
        ];
      },
    } as unknown as InvoiceCollectionSuggestionsRepository;
    const result = await new InvoiceCollectionSuggestionsService(
      repository,
    ).list(NOW);
    assert.equal(result.staleAfterDays, 60);
    assert.equal(result.staleCount, 2);
    assert.equal(result.items.length, 4);
    assert.deepEqual(
      result.items.filter((item) => item.stale).map((item) => item.documentId),
      ["old-1", "old-2"],
    );
    assert.deepEqual(calls, ["list"]);
  });

  it("is zero when nothing waits long", async () => {
    const repository = {
      list: async () => [row("n", "UNASSIGNED", 1)],
    } as unknown as InvoiceCollectionSuggestionsRepository;
    const result = await new InvoiceCollectionSuggestionsService(
      repository,
    ).list(NOW);
    assert.equal(result.staleCount, 0);
  });
});
