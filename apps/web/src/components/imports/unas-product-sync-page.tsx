"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
  StatCard,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type UnasProductSyncRun,
  type UnasProductSyncRunStatus,
  type UnasProductSyncSummary,
} from "@acropora/types";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { unasProductSyncApi } from "@/lib/api/unas-product-sync";

const STATUS_LABEL: Record<UnasProductSyncRunStatus, string> = {
  PENDING: "Várakozik",
  RUNNING: "Folyamatban",
  APPLIED: "Sikeres",
  FAILED: "Sikertelen",
};
const STATUS_VARIANT: Record<
  UnasProductSyncRunStatus,
  "neutral" | "info" | "success" | "danger"
> = {
  PENDING: "neutral",
  RUNNING: "info",
  APPLIED: "success",
  FAILED: "danger",
};
const dateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("hu-HU", {
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date(value))
    : "—";

export function UnasProductSyncPage() {
  const { session } = useAuth();
  const [runs, setRuns] = useState<UnasProductSyncRun[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<UnasProductSyncSummary | null>(
    null,
  );
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_MANAGE),
  );
  const token = session?.token ?? "";

  const load = useCallback(
    async (signal?: AbortSignal, quiet = false) => {
      if (!canView) return;
      if (!quiet) setLoading(true);
      setError(null);
      try {
        setRuns(await unasProductSyncApi.listRuns(token, 20, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A szinkronfutások nem tölthetők be.",
          );
      } finally {
        if (!signal?.aborted && !quiet) setLoading(false);
      }
    },
    [canView, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const hasActiveRun = runs?.some((run) => run.status === "RUNNING") ?? false;
  useEffect(() => {
    if (!hasActiveRun) return;
    const timer = window.setInterval(() => void load(undefined, true), 5000);
    return () => window.clearInterval(timer);
  }, [hasActiveRun, load]);

  const latest = runs?.[0] ?? null;
  const successRate = useMemo(() => {
    const completed = runs?.filter((run) =>
      ["APPLIED", "FAILED"].includes(run.status),
    );
    if (!completed?.length) return "—";
    return `${Math.round((completed.filter((run) => run.status === "APPLIED").length / completed.length) * 100)}%`;
  }, [runs]);

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed az UNAS szinkronhoz"
        description="products.view jogosultság szükséges."
      />
    );

  const start = async () => {
    if (!canManage || starting) return;
    setStarting(true);
    setError(null);
    setLastResult(null);
    try {
      setLastResult(await unasProductSyncApi.run(token));
      await load(undefined, true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A szinkron nem indítható.",
      );
      await load(undefined, true);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Integráció"
        title="UNAS termékszinkron"
        description="Az UNAS Product Master read-only tükrének futásai. A szinkron nem módosítja az Acropora készlet-ledgert vagy a beszerzési adatokat."
        actions={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={loading}
              onClick={() => void load()}
            >
              Frissítés
            </Button>
            {canManage ? (
              <Button
                disabled={starting || hasActiveRun}
                onClick={() => void start()}
              >
                {starting ? "Szinkronizálás…" : "Szinkron indítása"}
              </Button>
            ) : null}
          </div>
        }
      />

      {error ? (
        <Alert
          variant="danger"
          title="A művelet nem sikerült"
          description={error}
          action={
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Újrapróbálás
            </Button>
          }
        />
      ) : null}
      {lastResult ? (
        <Alert
          variant="info"
          title="A termékszinkron sikeresen befejeződött"
          description={`${lastResult.productsSeen} termék feldolgozva, ${lastResult.counts.CREATE} létrehozva, ${lastResult.counts.UPDATE} frissítve, ${lastResult.missingCount} hiányzó.`}
        />
      ) : null}

      {loading && !runs ? (
        <div aria-label="Szinkronfutások betöltése" className="space-y-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-64" />
        </div>
      ) : null}

      {runs ? (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <StatCard
              label="Legutóbbi állapot"
              value={latest ? STATUS_LABEL[latest.status] : "Nincs futás"}
              change={
                latest
                  ? dateTime(latest.completedAt ?? latest.startedAt)
                  : undefined
              }
              changeLabel=""
            />
            <StatCard label="Utolsó 20 sikeressége" value={successRate} />
            <StatCard
              label="Legutóbb feldolgozott"
              value={latest ? String(latest.productsSeen) : "—"}
              change={
                latest
                  ? `${latest.createdCount} új · ${latest.updatedCount} frissített`
                  : undefined
              }
              changeLabel=""
            />
          </div>

          {runs.length ? (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-left text-sm">
                <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-3">Állapot</th>
                    <th>Típus</th>
                    <th>Kezdés</th>
                    <th>Befejezés</th>
                    <th>Feldolgozott</th>
                    <th>Új</th>
                    <th>Frissített</th>
                    <th>Hiányzó</th>
                    <th>Hiba</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-b last:border-0">
                      <td className="p-3">
                        <Badge variant={STATUS_VARIANT[run.status]}>
                          {STATUS_LABEL[run.status]}
                        </Badge>
                        <div className="mt-1 font-mono text-[10px] text-slate-400">
                          {run.id}
                        </div>
                      </td>
                      <td>
                        {run.kind === "FULL" ? "Teljes" : "Inkrementális"}
                      </td>
                      <td>{dateTime(run.startedAt)}</td>
                      <td>{dateTime(run.completedAt)}</td>
                      <td>{run.productsSeen}</td>
                      <td>{run.createdCount}</td>
                      <td>{run.updatedCount}</td>
                      <td>{run.missingCount}</td>
                      <td className="max-w-64 font-mono text-xs text-rose-700">
                        {run.errorCode ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : (
            <EmptyState
              title="Még nincs termékszinkron"
              description={
                canManage
                  ? "Indítsd el az első kontrollált teljes szinkront."
                  : "Az első futást products.manage jogosultságú felhasználó indíthatja."
              }
            />
          )}
        </>
      ) : null}
    </div>
  );
}
