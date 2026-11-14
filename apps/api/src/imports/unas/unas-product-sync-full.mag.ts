/**
 * THE BODY OF THE FULL UNAS PRODUCT RE-READ COMMAND (`unas-product-sync-full.cli.ts`).
 *
 * WHY THIS COMMAND EXISTS. `UnasProductSyncService.runIncremental(..., teljesOsszevetes = true)` has been
 * the only way to re-read EVERY product, and its only entry point is `POST /integrations/unas/products/
 * sync?full=true`, which needs a signed-in user with the PRODUCTS_MANAGE permission. Production has no
 * agent account and no button for it, so a re-read the owner decides on (card 7d63e55c: 13 products still
 * carry the lost-emoji "????" run after #2530, because the incremental sync only re-reads what UNAS marks
 * as modified) could not be started at all. This is an entry point, not new logic: the same service call
 * the controller makes, run from a scheduled task.
 *
 * MEASURED ON STAGE (2026-11-14, same call through the controller): a first full run rewrote 1556 products
 * (a one-time fingerprint rebase, not the emoji), 132.8 s; the second run wrote 0 of 1726, 56.5 s. The
 * fingerprint is stable, so a repeat is quiet.
 *
 * A FULL RUN NEVER STARTS BY ACCIDENT. The service documents that a full run only starts when somebody
 * explicitly asks for it (a wasted one multiplies the load on UNAS at an hour nobody expects it), so the
 * command refuses to start without `--teljes`, and does not read UNAS or the database before that.
 *
 * THE BODY HAS NO IMPORT OF THE COMMAND FILE, ON PURPOSE (acrobot 2026-09-17: a cycle between an entry
 * point and its body made a command exit 13 with no output; see `unas-kapcsolat-ujraepites.parancs.spec.ts`).
 * It takes its collaborators as arguments, so a spec can run it on fakes.
 *
 * It does the same as the controller and nothing more: it does NOT recompute `webshopSellable` afterwards
 * (the scheduler does that after each incremental run; the controller does not after a manual one).
 */

/** The run row, as `UnasProductSyncRepository.getRun` returns it (the fields printed here). */
export interface FullSyncRunRow {
  id: string;
  kind: string;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  productsSeen: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  conflictCount: number;
  missingCount: number;
  skippedCount: number;
  skippedSourceChangedCount: number;
  errorCode: string | null;
}

export interface FullSyncDeps {
  getToken(): Promise<string>;
  /** Runs the full comparison; resolves with the run id the service created. */
  runFull(token: string): Promise<{ runId: string }>;
  readRun(runId: string): Promise<FullSyncRunRow>;
}

export interface FullSyncIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export const FULL_SYNC_USAGE = `A UNAS termektorzs TELJES ujraolvasasanak parancsa.

  node dist/imports/unas/unas-product-sync-full.cli.js --teljes

    --teljes   kotelezo: a teljes futas CSAK kifejezett keresre indul
    --help     ez a szoveg

Minden termeket ujraolvas (a kurzort figyelmen kivul hagyja), mint a
POST /integrations/unas/products/sync?full=true. Egy JSON sort ir ki a futas
szamaival (csak szamok es kodok, leirasszoveg soha). Kilepesi kodok:
0 a futas lefutott (APPLIED), 1 hiba vagy FAILED, 2 rossz argumentum,
3 mar fut egy szinkron.
`;

/** Same shape as the scheduler's: only an upper-case code is safe to print, anything else is generic. */
function errorCodeOf(error: unknown): string {
  return error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)
    ? error.message.slice(0, 200)
    : "UNAS_PRODUCT_SYNC_FULL_FAILED";
}

export async function runUnasProductSyncFull(
  args: readonly string[],
  deps: FullSyncDeps,
  io: FullSyncIo,
): Promise<number> {
  const unknown = args.filter((arg) => arg !== "--teljes");
  if (unknown.length > 0 || !args.includes("--teljes")) {
    io.stderr(
      unknown.length > 0
        ? `ISMERETLEN ARGUMENTUM: ${unknown.join(" ")}\n\n`
        : "A teljes futas csak --teljes kapcsoloval indul.\n\n",
    );
    io.stderr(FULL_SYNC_USAGE);
    return 2;
  }

  let runId: string;
  try {
    const token = await deps.getToken();
    ({ runId } = await deps.runFull(token));
  } catch (error) {
    const code = errorCodeOf(error);
    io.stderr(`UNAS teljes szinkron NEM futott le: ${code}\n`);
    return code === "UNAS_PRODUCT_SYNC_ALREADY_RUNNING" ? 3 : 1;
  }

  let run: FullSyncRunRow;
  try {
    run = await deps.readRun(runId);
  } catch (error) {
    // The sync itself already ran (and committed): say so with the run id, so nobody starts a second full run
    // to find out. Only a code goes out, never the error text or a stack trace.
    io.stderr(
      `UNAS teljes szinkron LEFUTOTT (run ${runId}), de a futas sora nem olvashato: ${errorCodeOf(error)}\n`,
    );
    return 1;
  }
  const durationSeconds =
    run.startedAt && run.completedAt
      ? Math.round(
          (run.completedAt.getTime() - run.startedAt.getTime()) / 100,
        ) / 10
      : null;
  io.stdout(
    `${JSON.stringify({
      runId: run.id,
      kind: run.kind,
      status: run.status,
      durationSeconds,
      productsSeen: run.productsSeen,
      created: run.createdCount,
      updated: run.updatedCount,
      unchanged: run.unchangedCount,
      conflict: run.conflictCount,
      missing: run.missingCount,
      skipped: run.skippedCount,
      skippedSourceChanged: run.skippedSourceChangedCount,
      errorCode: run.errorCode,
    })}\n`,
  );
  return run.status === "APPLIED" ? 0 : 1;
}
