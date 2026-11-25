import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BILLING_DOCUMENT_STATUSES,
  BILLING_EMAIL_STATUSES,
  type BillingEmailStatus,
} from "./billing-document.js";
import {
  billingDocumentPath,
  billingEmailModeFor,
} from "./billing-document-read.js";

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

describe("billingDocumentPath", () => {
  const link = (overrides: Record<string, unknown> = {}) => ({
    serviceJobId: null,
    jobKind: null,
    partnerOrderId: null,
    certificateNumber: "TI-2026-009",
    ...overrides,
  });

  it("keeps the billing routes for an ordinary row", () => {
    assert.equal(
      billingDocumentPath({ id: "a", opens: "EDITOR" }),
      "/penzugy/szamlazas/a/szerkesztes",
    );
    assert.equal(
      billingDocumentPath({ id: "a", opens: "DETAIL", maintenanceDraft: null }),
      "/penzugy/szamlazas/a",
    );
  });

  it("takes a TIG invoice draft to its job's or order's page, not to a billing page", () => {
    assert.equal(
      billingDocumentPath({
        id: "a",
        opens: "DETAIL",
        maintenanceDraft: link({
          serviceJobId: "job-9",
          jobKind: "MAINTENANCE",
        }),
      }),
      "/szerviz/karbantartas/job-9",
    );
    assert.equal(
      billingDocumentPath({
        id: "a",
        opens: "DETAIL",
        maintenanceDraft: link({ serviceJobId: "job-9", jobKind: "REPAIR" }),
      }),
      "/szerviz/hibajegyek/job-9",
    );
    assert.equal(
      billingDocumentPath({
        id: "a",
        opens: "DETAIL",
        maintenanceDraft: link({ partnerOrderId: "order-3" }),
      }),
      "/megrendelesek/order-3",
    );
  });

  it("falls back to the billing detail when the draft names neither a job nor an order", () => {
    assert.equal(
      billingDocumentPath({
        id: "a",
        opens: "DETAIL",
        maintenanceDraft: link(),
      }),
      "/penzugy/szamlazas/a",
    );
  });
});
