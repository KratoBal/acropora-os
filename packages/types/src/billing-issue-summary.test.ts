import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkBillingIssueDates,
  isCardPayment,
} from "./billing-issue-summary.js";

/**
 * THE THREE EDITABLE DATES OF THE INVOICE CONFIRMATION (card 7ba97e0d). WHAT TURNS IT RED: a future issue date or a
 * due date before it passes; a non-date or an impossible day ("2026-02-30") passes; a card payment keeps a due date
 * apart from the issue date; a delivery note gets a due date.
 */
const today = "2026-11-11";
const invoice = {
  today,
  showsPaymentFields: true,
  dueDateFollowsIssueDate: false,
};

describe("checkBillingIssueDates", () => {
  it("takes three real days, the issue date not after today, the due date not before it", () => {
    assert.deepEqual(
      checkBillingIssueDates(
        {
          issueDate: "2026-11-10",
          fulfillmentDate: "2026-11-01",
          dueDate: "2026-11-18",
        },
        invoice,
      ),
      {
        ok: true,
        value: {
          issueDate: "2026-11-10",
          fulfillmentDate: "2026-11-01",
          dueDate: "2026-11-18",
        },
      },
    );
    assert.equal(
      checkBillingIssueDates(
        { issueDate: today, fulfillmentDate: today, dueDate: today },
        invoice,
      ).ok,
      true,
    );
  });

  it("refuses a future issue date, a due date before the issue date and anything that is not a calendar day", () => {
    for (const [dates, error] of [
      [
        {
          issueDate: "2026-11-12",
          fulfillmentDate: today,
          dueDate: "2026-11-20",
        },
        "A számla kelte nem lehet későbbi a mai napnál.",
      ],
      [
        { issueDate: today, fulfillmentDate: today, dueDate: "2026-11-10" },
        "A fizetési határidő nem lehet korábbi a számla kelténél.",
      ],
      [
        { issueDate: "2026-02-30", fulfillmentDate: today, dueDate: today },
        "A számla kelte egy naptári nap lehet.",
      ],
      [
        { issueDate: today, fulfillmentDate: "11/01/2026", dueDate: today },
        "A teljesítés ideje egy naptári nap lehet.",
      ],
      [
        { issueDate: today, fulfillmentDate: today, dueDate: null },
        "A fizetési határidő egy naptári nap lehet.",
      ],
      [
        { fulfillmentDate: today, dueDate: today },
        "A számla kelte egy naptári nap lehet.",
      ],
    ] as const)
      assert.deepEqual(
        checkBillingIssueDates(dates, invoice),
        { ok: false, error },
        JSON.stringify(dates),
      );
  });

  it("a card payment is due on the issue date, whatever due date was sent", () => {
    assert.deepEqual(
      checkBillingIssueDates(
        {
          issueDate: "2026-11-10",
          fulfillmentDate: "2026-11-10",
          dueDate: "2026-12-31",
        },
        { ...invoice, dueDateFollowsIssueDate: true },
      ),
      {
        ok: true,
        value: {
          issueDate: "2026-11-10",
          fulfillmentDate: "2026-11-10",
          dueDate: "2026-11-10",
        },
      },
    );
  });

  it("without payment fields (a delivery note) there is no due date", () => {
    assert.deepEqual(
      checkBillingIssueDates(
        { issueDate: today, fulfillmentDate: today, dueDate: "2026-11-20" },
        { ...invoice, showsPaymentFields: false },
      ),
      {
        ok: true,
        value: { issueDate: today, fulfillmentDate: today, dueDate: null },
      },
    );
  });
});

describe("isCardPayment", () => {
  it("is the shared classifier's card-at-order: a card or online payment, not a transfer, cash or COD", () => {
    assert.deepEqual(
      [
        "Bankkártya",
        "Online bankkártya",
        "SimplePay",
        "Átutalás",
        "Készpénz",
        "Utánvét",
        null,
      ].map(isCardPayment),
      [true, true, true, false, false, false, false],
    );
  });
});
