"use client";
import { Alert, Badge, Button, Card, ConfirmDialog } from "@acropora/ui";
import type {
  CatalogActionKind,
  CatalogActionRun,
  CatalogActionView,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";
import { catalogActionsApi } from "@/lib/api/catalog-actions";

/** How often a running run is asked about again. */
export const CATALOG_ACTION_POLL_MS = 2000;
/** The lines of a run's output shown without opening the full text. */
const SUMMARY_LINES = 14;

/*
  WHAT AN APPLY DOES AND HOW IT IS UNDONE, per kind: the confirmation names the
  consequence, not "are you sure" (ConfirmDialog). A kind without an entry gets
  the generic text, so a new kind cannot slip through with an empty dialog.
*/
const APPLY_TEXT: Partial<
  Record<CatalogActionKind, { consequence: string; recovery: string }>
> = {
  "brand-backfill": {
    consequence:
      "Az OS adatbázisába márka-rekordok kerülnek, és a próba szerinti termékek márkát kapnak. A napló téged nevez meg felelősként.",
    recovery:
      "Nincs egy gombos visszavonás: egy márka a Márkák oldalon archiválható, a termék márkája a termék lapján törölhető. Az újrafuttatás a már márkás termékeket kihagyja.",
  },
  "brand-links": {
    consequence:
      "A teszt webshop márka-moduljába kikerülnek a márkák adatai és a termékek márka-kötése. A termékek törzse nem változik.",
    recovery:
      "Egy újabb futás az OS mostani állapotára írja vissza a kötéseket; egy archivált márka kötése ilyenkor törlődik.",
  },
};
const GENERIC_APPLY_TEXT = {
  consequence: "A művelet a próba szerint ír.",
  recovery: "A visszaállítás módja ennél a műveletnél nincs megadva.",
};

export function runSummary(output: string): string {
  const lines = output.trimEnd().split("\n");
  return lines.slice(-SUMMARY_LINES).join("\n");
}

function statusBadge(run: CatalogActionRun) {
  const label = `${run.mode === "plan" ? "Próba" : "Végrehajtás"}: ${
    run.status === "running"
      ? "fut"
      : run.status === "succeeded"
        ? "kész"
        : "hiba"
  }`;
  const variant =
    run.status === "running"
      ? "neutral"
      : run.status === "succeeded"
        ? "success"
        : "danger";
  return <Badge variant={variant}>{label}</Badge>;
}

/**
 * THE CATALOG OPERATIONS (kezdolap-marka-sav-os): each one a plan first, then
 * an apply confirmed from that plan. Rendered only for `settings.manage`, and
 * only where the server says the operations exist (`enabled`); production
 * answers `enabled: false`, so nothing shows there.
 */
export function CatalogActionsPanel({ token }: { token: string }) {
  const [actions, setActions] = useState<CatalogActionView[] | null>(null);
  const [runs, setRuns] = useState<
    Partial<Record<CatalogActionKind, CatalogActionRun>>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<CatalogActionKind | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    catalogActionsApi
      .overview(token, controller.signal)
      .then((view) => {
        if (!view.enabled) return;
        setActions(view.actions);
        const latest: Partial<Record<CatalogActionKind, CatalogActionRun>> = {};
        for (const action of view.actions)
          if (action.lastRun) latest[action.kind] = action.lastRun;
        setRuns(latest);
      })
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A katalógus-műveletek nem tölthetők be.",
          );
      });
    return () => controller.abort();
  }, [token]);

  const running = Object.values(runs).find((run) => run?.status === "running");
  const runningId = running?.id;
  useEffect(() => {
    if (!runningId) return;
    const timer = window.setTimeout(() => {
      catalogActionsApi
        .run(token, runningId)
        .then((run) => setRuns((current) => ({ ...current, [run.kind]: run })))
        .catch((cause) =>
          setError(
            cause instanceof Error
              ? cause.message
              : "A futás állapota nem kérdezhető le.",
          ),
        );
    }, CATALOG_ACTION_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [runningId, runs, token]);

  const start = useCallback(async (call: () => Promise<CatalogActionRun>) => {
    setBusy(true);
    setError(null);
    try {
      const run = await call();
      setRuns((current) => ({ ...current, [run.kind]: run }));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A művelet nem indult el.",
      );
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }, []);

  if (!actions && !error) return null;
  const confirmText =
    (confirming && APPLY_TEXT[confirming]) || GENERIC_APPLY_TEXT;
  const confirmRun = confirming ? runs[confirming] : undefined;

  return (
    <Card className="space-y-4 p-4" aria-label="Katalógus-műveletek">
      <div>
        <h2 className="text-base font-semibold">Katalógus-műveletek</h2>
        <p className="text-sm text-dusk-500">
          Előbb próba (semmit nem ír), utána a próba megerősítésével a
          végrehajtás. Egyszerre egy művelet fut.
        </p>
      </div>
      {error ? (
        <Alert variant="danger" title="Hiba" description={error} />
      ) : null}
      {(actions ?? []).map((action) => {
        const run = runs[action.kind];
        const canApply =
          run?.mode === "plan" &&
          run.status === "succeeded" &&
          !run.appliedByRunId;
        return (
          <section
            key={action.kind}
            aria-label={action.title}
            className="space-y-2 border-t pt-3 first:border-0 first:pt-0"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-medium">{action.title}</h3>
                <p className="text-sm text-dusk-500">{action.description}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  disabled={busy || Boolean(running)}
                  onClick={() =>
                    void start(() => catalogActionsApi.plan(token, action.kind))
                  }
                >
                  Próba
                </Button>
                <Button
                  disabled={busy || Boolean(running) || !canApply}
                  onClick={() => setConfirming(action.kind)}
                >
                  Végrehajtás
                </Button>
              </div>
            </div>
            {run ? (
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  {statusBadge(run)}
                  <span className="text-dusk-500">
                    {new Date(run.startedAt).toLocaleString("hu-HU")}
                  </span>
                </div>
                {run.error ? (
                  <Alert
                    variant="danger"
                    title="A futás félbeszakadt"
                    description={run.error}
                  />
                ) : null}
                {run.output ? (
                  <>
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-dusk-50 p-2 text-xs">
                      {runSummary(run.output)}
                    </pre>
                    <details>
                      <summary className="cursor-pointer text-xs text-brand-700">
                        Teljes kimenet
                      </summary>
                      <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-dusk-50 p-2 text-xs">
                        {run.output}
                      </pre>
                    </details>
                  </>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}
      <ConfirmDialog
        open={Boolean(confirming)}
        title={`Végrehajtod? ${
          actions?.find((a) => a.kind === confirming)?.title ?? ""
        }`}
        consequence={confirmText.consequence}
        recovery={confirmText.recovery}
        confirmLabel="Végrehajtás a próba szerint"
        busy={busy}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const kind = confirming;
          const plan = kind ? runs[kind] : undefined;
          if (!kind || !plan) return;
          void start(() => catalogActionsApi.apply(token, kind, plan.id));
        }}
      >
        {confirmRun ? (
          <pre
            aria-label="A próba összesítője"
            className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-dusk-50 p-2 text-xs"
          >
            {runSummary(confirmRun.output)}
          </pre>
        ) : null}
      </ConfirmDialog>
    </Card>
  );
}
