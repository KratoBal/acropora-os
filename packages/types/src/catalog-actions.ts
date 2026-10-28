/**
 * ONE-OFF CATALOG OPERATIONS STARTED FROM THE OS (kezdolap-marka-sav-os).
 *
 * Each kind is an existing command-line operation (`unas:brand-backfill`,
 * `medusa:brand-links`, `medusa:categories`), run by the API with the same code path. A run is
 * either a PLAN (reads, writes nothing) or an APPLY, and an apply is accepted
 * only after a successful plan of the same kind.
 */
export const CATALOG_ACTION_KINDS = [
  "brand-backfill",
  "brand-links",
  "categories",
] as const;
export type CatalogActionKind = (typeof CATALOG_ACTION_KINDS)[number];

export type CatalogActionMode = "plan" | "apply";
export type CatalogActionRunStatus = "running" | "succeeded" | "failed";

export interface CatalogActionRun {
  id: string;
  kind: CatalogActionKind;
  mode: CatalogActionMode;
  status: CatalogActionRunStatus;
  startedAt: string;
  finishedAt: string | null;
  actorUserId: string;
  /** The command's exit code; null while running or when it threw. */
  exitCode: number | null;
  /** Everything the command printed, in order. */
  output: string;
  /** The thrown error's message, when the command did not return. */
  error: string | null;
  /** For an apply: the plan it was confirmed from. */
  planRunId: string | null;
  /** For a plan: the apply that has used it (a plan confirms one apply). */
  appliedByRunId: string | null;
}

export interface CatalogActionView {
  kind: CatalogActionKind;
  title: string;
  description: string;
  /** The most recent run of this kind, if any since the API started. */
  lastRun: CatalogActionRun | null;
}

/**
 * THE SECOND GUARD'S STATE (the Medusa host list): whether the operations may
 * run against the Medusa this OS points at. `host` is the host NAME found in
 * `MEDUSA_ADMIN_URL` (never the rest of the address), `null` when there is none
 * or it is not a URL. `message` says why not, in Hungarian; `null` when allowed.
 */
export interface CatalogActionsHostGuard {
  allowed: boolean;
  host: string | null;
  message: string | null;
}

export interface CatalogActionsResponse {
  /** False where the environment does not allow these operations (production). */
  enabled: boolean;
  actions: CatalogActionView[];
  /** Present when `enabled`. */
  hostGuard?: CatalogActionsHostGuard;
}
