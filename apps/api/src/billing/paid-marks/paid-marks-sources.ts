import {
  decideFoxpostSettlement,
  foxpostPaidMarkInputs,
  type FoxpostSettlementDecision,
} from "../../integrations/foxpost/foxpost-paid-marks.js";
import { loadFoxpostSettlements } from "../../integrations/foxpost/foxpost-paid-marks.dry-run.js";
import {
  decideGlsTransfer,
  glsPaidMarkInputs,
  type GlsTransferDecision,
} from "../../integrations/gls/gls-cod-paid-marks.js";
import { loadGlsTransfers } from "../../integrations/gls/gls-cod-paid-marks.dry-run.js";
import {
  decideSimplePayOrder,
  type SimplePayOrderDecision,
} from "../../integrations/simplepay/simplepay-paid-marks.js";
import { loadSimplePayOrders } from "../../integrations/simplepay/simplepay-paid-marks.dry-run.js";
import {
  loadRefundsAfterMarks,
  loadSimplePayMarkedBefore,
  loadWrittenSimplePayMarks,
  simplePayMarksToWrite,
} from "../../integrations/simplepay/simplepay-paid-marks.live.js";
import type { RefundAfterMark } from "../../integrations/simplepay/simplepay-paid-marks.refunds.js";
import type { PaidMarkException, PaidMarkPlan } from "./paid-marks-auto.js";

/*
  WHAT A PERSON MUST LOOK AT, PER SOURCE (acrobot 26101: partial refund,
  several candidates, an amount difference, a failed settlement). An invoice
  already paid, a non-card order or a SimplePay order not settled yet resolves
  itself, so it is counted, not listed.
*/
const SETTLES_ITSELF: ReadonlySet<string> = new Set([
  "ALREADY_PAID",
  "NOT_CARD",
  "NOT_SETTLED",
  "MARKED_BEFORE",
]);
const exception = (
  reference: string,
  reason: string,
  detail?: string,
): PaidMarkException => ({
  reference,
  reason,
  attention: !SETTLES_ITSELF.has(reason),
  ...(detail ? { detail } : {}),
});

/** GLS: a refused transfer, and every invoice a markable transfer skipped. */
export function glsPlanFrom(
  decisions: readonly GlsTransferDecision[],
): PaidMarkPlan {
  return {
    source: "GLS_COD",
    marks: glsPaidMarkInputs(decisions),
    exceptions: decisions.flatMap((d) =>
      d.markable
        ? d.skipped.map((s) =>
            exception(s.invoiceNumber, s.reason, `GLS ${d.transferDate}`),
          )
        : [exception(d.transferDate, d.refusal, `utalt ${d.transferred} Ft`)],
    ),
  };
}

/** Foxpost: a refused settlement (with its read error), and every skip. */
export function foxpostPlanFrom(
  decisions: readonly FoxpostSettlementDecision[],
): PaidMarkPlan {
  return {
    source: "FOXPOST",
    marks: foxpostPaidMarkInputs(decisions),
    exceptions: decisions.flatMap((d) =>
      d.markable
        ? d.skipped.map((s) =>
            exception(s.reference, s.reason, `Foxpost ${d.settlementCode}`),
          )
        : [
            exception(
              d.settlementCode,
              d.refusal,
              d.errorCode ?? `utalt ${d.transferred ?? "?"} Ft`,
            ),
          ],
    ),
  };
}

/**
 * SimplePay: every order not markable, an invoice already marked by SimplePay
 * (counted), and a refund that arrived after a mark (a person must look).
 */
export function simplePayPlanFrom(input: {
  decisions: readonly SimplePayOrderDecision[];
  markedBefore: ReadonlySet<string>;
  refundsAfter: readonly RefundAfterMark[];
}): PaidMarkPlan {
  const markable = new Set(
    input.decisions.flatMap((d) => (d.markable ? [d.mark.invoiceNumber] : [])),
  );
  const { marks, markedBefore } = simplePayMarksToWrite({
    decisions: input.decisions,
    approved: markable,
    markedBefore: input.markedBefore,
  });
  return {
    source: "SIMPLEPAY",
    marks,
    exceptions: [
      ...input.decisions.flatMap((d) =>
        d.markable
          ? []
          : [
              exception(
                d.invoiceNumber ?? d.orderKey,
                d.reason,
                `rendelés ${d.orderKey}`,
              ),
            ],
      ),
      ...markedBefore.map((number) => exception(number, "MARKED_BEFORE")),
      ...input.refundsAfter.map((r) =>
        exception(
          r.invoiceNumber,
          r.full ? "REFUNDED_AFTER_MARK" : "PARTLY_REFUNDED_AFTER_MARK",
          `rendelés ${r.orderKey}, visszatérítve ${r.refunded} (${r.refundDates.join(", ")})`,
        ),
      ),
    ],
  };
}

export async function glsPaidMarkPlan(from: string): Promise<PaidMarkPlan> {
  return glsPlanFrom(
    (await loadGlsTransfers(from)).map((t) => decideGlsTransfer(t)),
  );
}

export async function foxpostPaidMarkPlan(from: string): Promise<PaidMarkPlan> {
  return foxpostPlanFrom(
    (await loadFoxpostSettlements(from)).map((s) => decideFoxpostSettlement(s)),
  );
}

export async function simplePayPaidMarkPlan(
  from: string,
): Promise<PaidMarkPlan> {
  const decisions = (await loadSimplePayOrders(from)).orders.map((order) =>
    decideSimplePayOrder(order),
  );
  const markable = new Set(
    decisions.flatMap((d) => (d.markable ? [d.mark.invoiceNumber] : [])),
  );
  return simplePayPlanFrom({
    decisions,
    markedBefore: await loadSimplePayMarkedBefore(markable),
    refundsAfter: await loadRefundsAfterMarks(
      await loadWrittenSimplePayMarks(),
    ),
  });
}
