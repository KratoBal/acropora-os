import type {
  MedusaOrderDetailRow,
  MedusaWithdrawal,
} from "../../integrations/medusa/medusa-admin.client.js";
import { PULL_BATCH, errorCode } from "./webshop-problem-report-pull.js";

/**
 * THE CUSTOMERS' WITHDRAWAL DECLARATIONS COME TO THE OS (V0.3, slice 4). The shop stores a declaration (commerce
 * `order_withdrawal`); the OS PULLS it (no new public OS endpoint) and files a TASK that links to the order, the same
 * way as the problem reports (`webshop-problem-report-pull.ts`): the shop's (source, sourceRef) key makes the pull
 * IDEMPOTENT, so a declaration pulled twice is one task. The task reuses the `WEBSHOP_COMPLAINT` source (a webshop
 * notification the staff must act on) with its own key prefix `withdrawal:`, so no new task source is needed.
 *
 * THE OS RECORDS, IT DOES NOT JUDGE, AND NEITHER DOES THE SHOP: whether the right exists (the 14 days, the goods it
 * does not cover, a company as buyer) is the staff's and the owner's. The task says so. The wording of anything the
 * customer receives is NOT here.
 *
 * WITHOUT AN ASSIGNEE NOTHING IS CREATED (a task cannot exist without one): `WEBSHOP_WITHDRAWAL_ASSIGNEE_ID`, and when
 * it is unset `WEBSHOP_COMPLAINT_ASSIGNEE_ID` (the same people handle both). Unset or unknown: the declarations stay
 * `new` in the shop and EVERY round says so in the log.
 *
 * ORDER OF THE TWO WRITES: the task first, then the pulled mark. A declaration is never marked pulled without its task.
 */
export interface WithdrawalTaskData {
  title: string;
  description: string;
  linkUrl: string;
  assigneeId: string;
  sourceRef: string;
}

/** The task for a declaration: only what the staff needs to act, in Hungarian. */
export function withdrawalTask(
  withdrawal: MedusaWithdrawal,
  order: Pick<MedusaOrderDetailRow, "display_id" | "items"> | null,
  assigneeId: string,
): WithdrawalTaskData {
  const number = order ? `#${order.display_id}` : withdrawal.order_id;
  const titleOf = (id: string) =>
    order?.items.find((item) => item.id === id)?.title ?? id;
  const lines = [
    "Elállási nyilatkozat érkezett a webshopból.",
    `Nyilatkozó neve: ${withdrawal.customer_name}`,
    `Érintett tételek: ${withdrawal.item_ids.map(titleOf).join(", ")}`,
    `Beérkezés ideje (a bolt szerverének órája): ${withdrawal.created_at}`,
    `Nyilatkozat azonosítója: ${withdrawal.id}`,
    "A bolt nem vizsgálta, hogy az elállási jog fennáll-e (határidő, kizárt termékek, céges vevő): ezt ellenőrizni kell.",
  ];
  return {
    title: `Webshop elállás, rendelés ${number}`,
    description: lines.join("\n"),
    linkUrl: `/webshop/rendelesek/${encodeURIComponent(withdrawal.order_id)}`,
    assigneeId,
    sourceRef: `withdrawal:${withdrawal.id}`,
  };
}

export interface WithdrawalPullDeps {
  list(limit: number): Promise<MedusaWithdrawal[]>;
  order(
    id: string,
  ): Promise<Pick<MedusaOrderDetailRow, "display_id" | "items"> | null>;
  /** Is this an active user (a task cannot be assigned to anyone else)? */
  assigneeActive(id: string): Promise<boolean>;
  /** Creates the task, or leaves the existing one (the key): "exists" for the second. */
  createTask(data: WithdrawalTaskData): Promise<"created" | "exists">;
  markPulled(id: string): Promise<void>;
}

export interface WithdrawalPullReport {
  seen: number;
  created: number;
  alreadyThere: number;
  /** declarations left `new` because there is no usable assignee */
  waiting: number;
  assigneeProblem: "unset" | "unknown" | null;
  failed: { withdrawalId: string; error: string }[];
}

/** The assignee: the withdrawal's own setting, else the complaints'. */
export const withdrawalAssigneeId = (env: NodeJS.ProcessEnv): string =>
  env.WEBSHOP_WITHDRAWAL_ASSIGNEE_ID?.trim() ||
  env.WEBSHOP_COMPLAINT_ASSIGNEE_ID?.trim() ||
  "";

export async function pullWithdrawals(
  deps: WithdrawalPullDeps,
  env: NodeJS.ProcessEnv,
): Promise<WithdrawalPullReport> {
  const withdrawals = await deps.list(PULL_BATCH);
  const report: WithdrawalPullReport = {
    seen: withdrawals.length,
    created: 0,
    alreadyThere: 0,
    waiting: 0,
    assigneeProblem: null,
    failed: [],
  };
  if (withdrawals.length === 0) return report;
  const assigneeId = withdrawalAssigneeId(env);
  if (assigneeId === "") {
    report.waiting = withdrawals.length;
    report.assigneeProblem = "unset";
    return report;
  }
  if (!(await deps.assigneeActive(assigneeId))) {
    report.waiting = withdrawals.length;
    report.assigneeProblem = "unknown";
    return report;
  }
  for (const item of withdrawals) {
    try {
      const order = await deps.order(item.order_id);
      const outcome = await deps.createTask(
        withdrawalTask(item, order, assigneeId),
      );
      if (outcome === "created") report.created += 1;
      else report.alreadyThere += 1;
      await deps.markPulled(item.id);
    } catch (error) {
      report.failed.push({ withdrawalId: item.id, error: errorCode(error) });
    }
  }
  return report;
}

/** The report as log lines: empty when there was nothing to pull. */
export function describeWithdrawalPull(report: WithdrawalPullReport): string {
  if (report.seen === 0) return "";
  const lines = [
    `Webshop withdrawals: ${report.seen} waiting, ${report.created} tasks created, ${report.alreadyThere} already had a task.`,
  ];
  if (report.assigneeProblem)
    lines.push(
      `${report.waiting} withdrawal(s) STAY NEW in the shop: ` +
        (report.assigneeProblem === "unset"
          ? "neither WEBSHOP_WITHDRAWAL_ASSIGNEE_ID nor WEBSHOP_COMPLAINT_ASSIGNEE_ID is set, so no task can be created."
          : "the assignee id names no active user, so no task can be created.") +
        " The customers were told the declaration arrived.",
    );
  if (report.failed.length)
    lines.push(
      `Failed: ${report.failed.map((f) => `${f.withdrawalId} (${f.error})`).join(", ")}.`,
    );
  return lines.join("\n");
}
