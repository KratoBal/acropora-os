import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { payoutTotals, type StripeTotalsLine } from "./stripe-payout-totals.js";

const charge = (extra: Partial<StripeTotalsLine> = {}): StripeTotalsLine => ({
  type: "charge",
  amount: 470000,
  fee: 21150,
  net: 448850,
  status: "RESOLVED",
  ...extra,
});

describe("payoutTotals", () => {
  it("a settled payout whose net is what Stripe paid out is COMPLETED", () => {
    assert.deepEqual(
      payoutTotals([charge()], { payoutAmountCents: 448850, errorCode: null }),
      {
        status: "COMPLETED",
        errorCode: null,
        lineCount: 1,
        unresolvedLineCount: 0,
        grossCents: 470000,
        refundCents: 0,
        feeCents: 21150,
        netCents: 448850,
      },
    );
  });

  it("a line that waits for a person keeps the payout open, and is counted", () => {
    const totals = payoutTotals(
      [
        charge(),
        charge({
          status: "NEEDS_REVIEW",
          amount: 100000,
          fee: 4500,
          net: 95500,
        }),
      ],
      { payoutAmountCents: 544350, errorCode: null },
    );
    assert.equal(totals.status, "NEEDS_REVIEW");
    assert.equal(totals.unresolvedLineCount, 1);
    assert.equal(totals.errorCode, null);
  });

  it("a net that is not the payout's amount is TOTAL_MISMATCH, even when every line is settled", () => {
    const totals = payoutTotals([charge()], {
      payoutAmountCents: 500000,
      errorCode: null,
    });
    assert.equal(totals.status, "NEEDS_REVIEW");
    assert.equal(totals.errorCode, "TOTAL_MISMATCH");
  });

  it("refunds are their own total, negative; a standalone fee line counts as a fee paid", () => {
    const totals = payoutTotals(
      [
        charge(),
        {
          type: "refund",
          amount: -100000,
          fee: 0,
          net: -100000,
          status: "RESOLVED",
        },
        {
          type: "stripe_fee",
          amount: -500,
          fee: 0,
          net: -500,
          status: "NOT_APPLICABLE",
        },
      ],
      { payoutAmountCents: 348350, errorCode: null },
    );
    assert.equal(totals.refundCents, -100000);
    assert.equal(totals.feeCents, 21150 + 500);
    assert.equal(totals.grossCents, 470000);
    assert.equal(totals.netCents, 448850 - 100000 - 500);
    assert.equal(totals.status, "COMPLETED");
  });

  it("an error the payout already carries stays, and keeps it open", () => {
    const totals = payoutTotals([], {
      payoutAmountCents: 100,
      errorCode: "MANUAL_PAYOUT",
    });
    assert.equal(totals.status, "NEEDS_REVIEW");
    assert.equal(totals.errorCode, "MANUAL_PAYOUT");
  });

  it("an empty payout is not settled by emptiness: money was paid out, zero lines against it is a mismatch", () => {
    const totals = payoutTotals([], {
      payoutAmountCents: 100,
      errorCode: null,
    });
    assert.equal(totals.errorCode, "TOTAL_MISMATCH");
    assert.equal(totals.status, "NEEDS_REVIEW");
  });

  it("a payout of nothing with no lines is nothing to settle", () => {
    assert.equal(
      payoutTotals([], { payoutAmountCents: 0, errorCode: null }).status,
      "COMPLETED",
    );
  });

  it("an empty payout that was NOT read is not completed by emptiness: its error says so", () => {
    assert.equal(
      payoutTotals([], { payoutAmountCents: 100, errorCode: "LINES_NOT_READ" })
        .status,
      "NEEDS_REVIEW",
    );
  });
});
