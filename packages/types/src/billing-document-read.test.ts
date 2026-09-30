import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BILLING_DOCUMENT_STATUSES,
  BILLING_EMAIL_STATUSES,
  type BillingEmailStatus,
} from "./billing-document.js";
import { billingEmailModeFor } from "./billing-document-read.js";

describe("billingEmailModeFor", () => {
  it("offers a mode only for an issued document", () => {
    for (const status of BILLING_DOCUMENT_STATUSES) {
      if (status === "ISSUED") continue;
      for (const emailStatus of [null, ...BILLING_EMAIL_STATUSES]) {
        assert.equal(billingEmailModeFor(status, emailStatus), null);
      }
    }
  });

  it("maps every e-mail state of an issued document to the contract's mode", () => {
    // The whole table, so a new e-mail state cannot slip through unmapped.
    const expected: [BillingEmailStatus | null, string | null][] = [
      [null, "SEND"],
      ["NOT_REQUIRED", "SEND"],
      ["PENDING", "SEND"],
      ["SENDING", null],
      ["SENT", "RESEND"],
      ["FAILED", "RETRY"],
    ];
    assert.deepEqual(
      [null, ...BILLING_EMAIL_STATUSES].map((emailStatus) => [
        emailStatus,
        billingEmailModeFor("ISSUED", emailStatus),
      ]),
      expected,
    );
  });
});
