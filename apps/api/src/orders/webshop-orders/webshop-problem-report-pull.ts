import type {
  MedusaOrderDetailRow,
  MedusaProblemReport,
} from "../../integrations/medusa/medusa-admin.client.js";

/**
 * THE CUSTOMERS' PROBLEM REPORTS COME TO THE OS (V1.2, slice 2). The shop stores a report with its photos
 * (commerce `order_problem_report`); the OS PULLS it (acrobot's decision: no new public OS endpoint) and files a
 * TASK, not a service ticket: a service ticket needs a partner and a site (Balázs, 2026-09-23: "Kötelező"), and a
 * guest customer has neither. The task has a title, the text, the link to the order, and the shop's (source,
 * sourceRef) key makes the pull IDEMPOTENT: the same report pulled twice is one task.
 *
 * WITHOUT AN ASSIGNEE NOTHING IS CREATED (acrobot, 2026-11-04): `WEBSHOP_COMPLAINT_ASSIGNEE_ID` names the user
 * the tasks go to (a task cannot exist without one). Unset or unknown: the reports stay `new` in the shop, and
 * EVERY round says so in the log, so they are not lost and not silent.
 *
 * ORDER OF THE TWO WRITES: the task first, then the pulled mark. If the mark fails, the next round finds the task
 * already there (the key) and only retries the mark. A report is never marked pulled without its task.
 */
export const PULL_BATCH = 50;
export const COMPLAINT_SOURCE = "WEBSHOP_COMPLAINT" as const;

export const KIND_LABELS: Record<string, string> = {
  animal_dead: "Az állat elpusztult",
  animal_hurt: "Az állat sérült vagy beteg",
  item_damaged: "A termék sérült vagy hibás",
  item_missing: "Hiányzik egy tétel",
  other: "Más",
};

export interface ComplaintTaskData {
  title: string;
  description: string;
  linkUrl: string;
  assigneeId: string;
  sourceRef: string;
}

/** The task for a report: only what the staff needs to act, in Hungarian, with the photos as links. */
export function complaintTask(
  report: MedusaProblemReport,
  order: Pick<MedusaOrderDetailRow, "display_id" | "items"> | null,
  assigneeId: string,
): ComplaintTaskData {
  const kind = KIND_LABELS[report.kind] ?? report.kind;
  const number = order ? `#${order.display_id}` : report.order_id;
  const titleOf = (id: string) =>
    order?.items.find((item) => item.id === id)?.title ?? id;
  const lines = [
    `Ok: ${kind}`,
    `Érintett tételek: ${report.item_ids.map(titleOf).join(", ")}`,
    ...(report.received_at ? [`Átvétel ideje: ${report.received_at}`] : []),
    `Leírás: ${report.description}`,
    ...(report.phone ? [`Telefonszám: ${report.phone}`] : []),
    report.photos.length
      ? `Fotók (${report.photos.length}): ${report.photos.map((photo) => photo.url).join(" ")}`
      : "Fotó nincs.",
    `Bejelentés azonosítója: ${report.id}`,
  ];
  return {
    title: `Webshop bejelentés, rendelés ${number}: ${kind}`,
    description: lines.join("\n"),
    linkUrl: `/webshop/rendelesek/${encodeURIComponent(report.order_id)}`,
    assigneeId,
    sourceRef: `report:${report.id}`,
  };
}

export interface ProblemPullDeps {
  list(limit: number): Promise<MedusaProblemReport[]>;
  order(
    id: string,
  ): Promise<Pick<MedusaOrderDetailRow, "display_id" | "items"> | null>;
  /** Is this an active user (a task cannot be assigned to anyone else)? */
  assigneeActive(id: string): Promise<boolean>;
  /** Creates the task, or leaves the existing one (the key): "exists" for the second. */
  createTask(data: ComplaintTaskData): Promise<"created" | "exists">;
  markPulled(id: string): Promise<void>;
}

export interface ProblemPullReport {
  seen: number;
  created: number;
  alreadyThere: number;
  /** reports left `new` because there is no usable assignee */
  waiting: number;
  assigneeProblem: "unset" | "unknown" | null;
  failed: { reportId: string; error: string }[];
}

export const errorCode = (error: unknown): string => {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z0-9_]+$/.test(code)) return code;
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return `HTTP_${status}`;
  }
  return "ERROR";
};

export async function pullProblemReports(
  deps: ProblemPullDeps,
  env: NodeJS.ProcessEnv,
): Promise<ProblemPullReport> {
  const reports = await deps.list(PULL_BATCH);
  const report: ProblemPullReport = {
    seen: reports.length,
    created: 0,
    alreadyThere: 0,
    waiting: 0,
    assigneeProblem: null,
    failed: [],
  };
  if (reports.length === 0) return report;
  const assigneeId = env.WEBSHOP_COMPLAINT_ASSIGNEE_ID?.trim() ?? "";
  if (assigneeId === "") {
    report.waiting = reports.length;
    report.assigneeProblem = "unset";
    return report;
  }
  if (!(await deps.assigneeActive(assigneeId))) {
    report.waiting = reports.length;
    report.assigneeProblem = "unknown";
    return report;
  }
  for (const item of reports) {
    try {
      const order = await deps.order(item.order_id);
      const outcome = await deps.createTask(
        complaintTask(item, order, assigneeId),
      );
      if (outcome === "created") report.created += 1;
      else report.alreadyThere += 1;
      await deps.markPulled(item.id);
    } catch (error) {
      report.failed.push({ reportId: item.id, error: errorCode(error) });
    }
  }
  return report;
}

/** The report as log lines: empty when there was nothing to pull. */
export function describePullReport(report: ProblemPullReport): string {
  if (report.seen === 0) return "";
  const lines = [
    `Webshop problem reports: ${report.seen} waiting, ${report.created} tasks created, ${report.alreadyThere} already had a task.`,
  ];
  if (report.assigneeProblem)
    lines.push(
      `${report.waiting} report(s) STAY NEW in the shop: ` +
        (report.assigneeProblem === "unset"
          ? "WEBSHOP_COMPLAINT_ASSIGNEE_ID is not set, so no task can be created."
          : "WEBSHOP_COMPLAINT_ASSIGNEE_ID names no active user, so no task can be created.") +
        " The customers were told the report arrived.",
    );
  if (report.failed.length)
    lines.push(
      `Failed: ${report.failed.map((f) => `${f.reportId} (${f.error})`).join(", ")}.`,
    );
  return lines.join("\n");
}
