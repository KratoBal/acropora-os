import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mailListItem,
  suggestedLineCount,
  type MailArrivalRow,
} from "./expected-arrival.service.js";

// What must fail: a line without a product counted as suggested; a missing
// or malformed store counted as anything but zero.
describe("the list's suggestion count", () => {
  it("counts only the lines with a product suggestion", () => {
    assert.equal(
      suggestedLineCount([
        { result: { suggestion: { variantId: "v-1" } } },
        { result: { suggestion: null, conflict: true } },
        { result: { suggestion: { variantId: "v-2" } } },
      ]),
      2,
    );
    assert.equal(suggestedLineCount(null), 0);
    assert.equal(suggestedLineCount({ nem: "lista" }), 0);
  });
});

// What must fail: a booked arrival with a late correction offered for booking
// (an editor path) or shown as bookable; an open arrival's replaced version
// shown instead of its correction.
describe("a mail arrival's list row", () => {
  const reading = (netTotal: number) => ({
    invoiceDate: "2026-06-18",
    currency: "EUR",
    netTotal,
    lines: [{ isCharge: false }, { isCharge: true }],
  });
  const row = (
    status: "OPEN" | "RECEIVED",
    documents: MailArrivalRow["documents"],
  ): MailArrivalRow => ({
    id: "arr-1",
    status,
    supplierName: "Marine Aquatics s.r.o.",
    supplierId: "sup-1",
    orderReference: "18319",
    invoiceNumber: "32600434",
    documents,
  });
  const document = (
    status: string,
    netTotal: number,
    minute: number,
  ): MailArrivalRow["documents"][number] => ({
    kind: "INVOICE",
    status,
    receivedAt: new Date(Date.UTC(2026, 5, 18, 12, minute)),
    createdAt: new Date(Date.UTC(2026, 5, 18, 12, minute)),
    importResult: reading(netTotal),
    lineSuggestions: [],
  });

  it("an open arrival shows its invoice, bookable", () => {
    const item = mailListItem(row("OPEN", [document("READ", 254, 43)]));
    assert.equal(item.stage, "INVOICE");
    assert.equal(item.netTotal, 254);
    assert.equal(item.editorPath, "/beszerzes/uj?beerkezes=arr-1");
  });

  it("a booked arrival with a late correction shows the correction, and no way into the editor", () => {
    const item = mailListItem(
      row("RECEIVED", [
        document("LATE_CORRECTION", 254, 43),
        document("READ", 180, 28),
      ]),
    );
    assert.equal(item.stage, "LATE_CORRECTION");
    assert.equal(item.netTotal, 254);
    assert.equal(item.editorPath, null);
    assert.equal(item.suggestedLineCount, null);
  });
});
