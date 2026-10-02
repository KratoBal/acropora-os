import {
  applyPaidMarks,
  type PaymentMarkInput,
  type PaymentMarkLine,
  type PaymentMarkSource,
  type PaymentMarkStore,
} from "../../integrations/szamlazz/outgoing-payment-marks.js";
import type { SzamlazzAgentPaymentClient } from "../../integrations/szamlazz/szamlazz-agent.client.js";

/**
 * THE PAID MARKS WITHOUT A PERSON (Balázs, 2026-10-02 11:36 UTC: „ezek ugye
 * azért majd automatikusan mennek és nem kellesz hozzá?”; acrobot 26101). A
 * source with its switch on `auto` writes EVERY mark its dry run calls
 * markable, through the shared loop (`applyPaidMarks`) and its guards
 * (PLANNED before the call, no blind retry of UNKNOWN, FAILED retried, the
 * invoice read again). What is not markable or is skipped does not go in by
 * itself: when it needs a person, it is listed for the attention tile.
 */
export type PaidMarksMode = "off" | "dry" | "live" | "auto";

export function paidMarksMode(value: string | undefined): PaidMarksMode {
  const v = value?.trim();
  return v === "dry" || v === "live" || v === "auto" ? v : "off";
}

/** One thing the dry run did not mark, and whether a person must look at it. */
export interface PaidMarkException {
  /** The transfer day, the settlement code, the order or the invoice. */
  readonly reference: string;
  readonly reason: string;
  /** False when it resolves itself (already paid, not a card order, ...). */
  readonly attention: boolean;
  readonly detail?: string;
}

/** What a source's dry run says, ready for the writer. */
export interface PaidMarkPlan {
  readonly source: PaymentMarkSource;
  readonly marks: readonly PaymentMarkInput[];
  readonly exceptions: readonly PaidMarkException[];
}

export interface PaidMarksRunResult {
  readonly source: PaymentMarkSource;
  readonly writtenCount: number;
  readonly failedCount: number;
  /** Per reason: WRITTEN, and every skip or exception reason. */
  readonly summary: Readonly<Record<string, number>>;
  readonly attention: readonly {
    reference: string;
    reason: string;
    detail?: string;
  }[];
}

/** The writer's outcomes that need a person: an uncertain or refused write. */
const OUTCOME_ATTENTION: ReadonlySet<PaymentMarkLine["outcome"]["kind"]> =
  new Set(["FAILED", "UNKNOWN", "UNCERTAIN_BEFORE", "NOT_UNPAID"]);

export async function runPaidMarksAuto(input: {
  plan: PaidMarkPlan;
  agentKey: string;
  client: SzamlazzAgentPaymentClient;
  store: PaymentMarkStore;
}): Promise<PaidMarksRunResult> {
  const { plan } = input;
  const lines = await applyPaidMarks({
    source: plan.source,
    marks: plan.marks,
    // every markable invoice: there is no person to name them (acrobot 26101)
    approved: new Set(plan.marks.map((m) => m.invoiceNumber)),
    agentKey: input.agentKey,
    client: input.client,
    store: input.store,
  });
  const summary: Record<string, number> = {};
  const count = (key: string) => (summary[key] = (summary[key] ?? 0) + 1);
  const attention: { reference: string; reason: string; detail?: string }[] =
    [];
  for (const line of lines) {
    count(line.outcome.kind);
    if (OUTCOME_ATTENTION.has(line.outcome.kind))
      attention.push({
        reference: line.invoiceNumber,
        reason: line.outcome.kind,
        detail: outcomeDetail(line.outcome),
      });
  }
  for (const exception of plan.exceptions) {
    count(exception.reason);
    if (exception.attention)
      attention.push({
        reference: exception.reference,
        reason: exception.reason,
        ...(exception.detail ? { detail: exception.detail } : {}),
      });
  }
  return {
    source: plan.source,
    writtenCount: summary.WRITTEN ?? 0,
    failedCount:
      (summary.FAILED ?? 0) +
      (summary.UNKNOWN ?? 0) +
      (summary.UNCERTAIN_BEFORE ?? 0),
    summary,
    attention,
  };
}

function outcomeDetail(outcome: PaymentMarkLine["outcome"]): string {
  switch (outcome.kind) {
    case "FAILED":
      return `a Számlázz.hu elutasította (${outcome.code ?? "?"}): ${outcome.message ?? ""}`;
    case "UNKNOWN":
      return `bizonytalan kimenet: ${outcome.error}`;
    case "UNCERTAIN_BEFORE":
      return `egy korábbi futás állapota ${outcome.state}`;
    case "NOT_UNPAID":
      return `a számla állapota ${outcome.state}, nem bizonyíthatóan fizetetlen`;
    default:
      return outcome.kind;
  }
}

/** The run's one log line: written N, and the rest per reason. */
export function paidMarksRunLine(result: PaidMarksRunResult): string {
  const rest = Object.entries(result.summary)
    .filter(([key]) => key !== "WRITTEN")
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, n]) => `${key} ${n}`)
    .join(", ");
  return `Kifizetett-jelölés ${result.source}: beírva ${result.writtenCount}${rest ? `, kimaradt: ${rest}` : ""}; figyelmet kér ${result.attention.length}`;
}
