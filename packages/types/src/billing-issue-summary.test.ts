import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkBillingIssueDates,
  isCardPayment,
  proposedIssueDueDate,
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

  it("takes a fulfilment date at most a year before or after the issue date, and refuses one further away", () => {
    const at = (fulfillmentDate: string) =>
      checkBillingIssueDates(
        { issueDate: "2026-11-10", fulfillmentDate, dueDate: "2026-11-18" },
        invoice,
      );
    for (const day of ["2025-11-10", "2027-11-10", "2026-01-01"])
      assert.equal(at(day).ok, true, day);
    for (const day of ["2025-11-09", "2027-11-11", "2062-11-10"])
      assert.deepEqual(
        at(day),
        {
          ok: false,
          error:
            "A teljesítés ideje legfeljebb egy évvel térhet el a számla keltétől.",
        },
        day,
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

describe("proposedIssueDueDate", () => {
  it("keeps the draft's due date when it is not before the issue date", () => {
    assert.equal(proposedIssueDueDate("2026-11-20", today, 30), "2026-11-20");
    assert.equal(proposedIssueDueDate(today, today, 30), today);
  });

  it("counts from the issue date with the buyer's payment days when the draft's falls before it", () => {
    assert.equal(proposedIssueDueDate("2026-11-03", today, 30), "2026-12-11");
    assert.equal(proposedIssueDueDate("2026-11-10", today, 0), today);
    assert.equal(
      proposedIssueDueDate("2026-12-01", "2026-12-28", 8),
      "2027-01-05",
    );
  });

  it("leaves a missing due date missing", () => {
    assert.equal(proposedIssueDueDate(null, today, 8), null);
  });
});
