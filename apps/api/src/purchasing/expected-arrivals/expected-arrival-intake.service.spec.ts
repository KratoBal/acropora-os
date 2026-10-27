import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SupplierLineSuggestionService } from "../line-suggestions/supplier-line-suggestion.service.js";
import { SupplierInvoiceImportService } from "../supplier-invoice-import/supplier-invoice-import.service.js";
import { ExpectedArrivalIntakeService } from "./expected-arrival-intake.service.js";
import type { SupplierInvoiceMailClient } from "./supplier-invoice-mail.client.js";
import { supplierInvoiceMailQuery } from "./supplier-invoice-mail.config.js";

// What must fail: De Jong's invoice from Exact Online (no-reply@exact.com,
// 26009990, 2026-10-26) left out of the Gmail query again, because only the
// adapters' own addresses are watched.
describe("the supplier invoice mail intake's senders", () => {
  const intake = new ExpectedArrivalIntakeService(
    {} as SupplierInvoiceMailClient,
    new SupplierInvoiceImportService(),
    {} as SupplierLineSuggestionService,
    {},
  );

  it("watches the shared invoicing platform beside the real adapters' senders", () => {
    const senders = intake.senders();
    for (const sender of [
      "no-reply@exact.com",
      "info@dejongmarinelife.nl",
      "info@coralsands.de",
    ])
      assert.ok(senders.includes(sender), sender);
  });

  it("the Gmail query lists the shared platform's address", () => {
    assert.match(
      supplierInvoiceMailQuery(intake.senders()) ?? "",
      /^from:\([^)]*\bno-reply@exact\.com\b[^)]*\) has:attachment /,
    );
  });
});
