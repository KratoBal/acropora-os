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
import { useRouter } from "next/navigation";
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
/**
 * AZ ÜRES FUTÁS (Picasso 3.23): egy sikeres futás, amelynek MINDEN számlálója nulla (látott, létrehozott, frissített, változatlan, ütközés, hiányzó, kihagyott, elveszett kapcsolat, írt kapcsolat) és nincs hibakódja (barracuda a #2952-n: a számlálók felsorolása teljes legyen). A teszten húsz majdnem azonos
 * "Sikeres, Inkrementális, 0, 0, 0" sor közt veszett el a két érdemi futás (1919 feldolgozott, 13 új, 1556 frissített). Az egymás utáni üres futások egy sorba vonódnak, és kinyithatók.
 */
export function isIdleRun(run: UnasProductSyncRun): boolean {
  return (
    run.status === "APPLIED" &&
    run.productsSeen === 0 &&
    run.createdCount === 0 &&
    run.updatedCount === 0 &&
    run.unchangedCount === 0 &&
    run.conflictCount === 0 &&
    run.missingCount === 0 &&
    run.skippedCount === 0 &&
    run.skippedSourceChangedCount === 0 &&
    run.similarRelationsWritten === 0 &&
    run.accessoryRelationsWritten === 0 &&
    run.similarReferencesUnresolved === 0 &&
    run.accessoryReferencesUnresolved === 0 &&
    !run.errorCode
  );
}

export type RunRow =
  | { kind: "run"; run: UnasProductSyncRun }
  | { kind: "idle"; runs: UnasProductSyncRun[] };

/** A futások sorrendje marad; csak az EGYMÁS UTÁNI, KETTŐNÉL TÖBB üres futás vonódik össze (egy-két üres futás magában is rövid). */
export function groupRuns(runs: readonly UnasProductSyncRun[]): RunRow[] {
  const rows: RunRow[] = [];
  let idle: UnasProductSyncRun[] = [];
  const flush = () => {
    if (idle.length > 2) rows.push({ kind: "idle", runs: idle });
    else for (const run of idle) rows.push({ kind: "run", run });
    idle = [];
  };
  for (const run of runs) {
    if (isIdleRun(run)) idle.push(run);
    else {
      flush();
      rows.push({ kind: "run", run });
    }
  }
  flush();
  return rows;
}

const dateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("hu-HU", {
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date(value))
    : "—";

export function UnasProductSyncPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [runs, setRuns] = useState<UnasProductSyncRun[] | null>(null);
  const [openIdle, setOpenIdle] = useState<ReadonlySet<string>>(new Set());
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
  const canManageConnection = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SETTINGS_MANAGE),
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

  const renderRun = (run: UnasProductSyncRun) => (
    <tr key={run.id} className="border-b last:border-0">
      <td className="p-3">
        <Badge variant={STATUS_VARIANT[run.status]}>
          {STATUS_LABEL[run.status]}
        </Badge>
        <div className="mt-1 font-mono text-[10px] text-dusk-400">{run.id}</div>
      </td>
      <td className="px-3 py-2">
        {run.kind === "FULL" ? "Teljes" : "Inkrementális"}
      </td>
      <td className="px-3 py-2">{dateTime(run.startedAt)}</td>
      <td className="px-3 py-2">{dateTime(run.completedAt)}</td>
      <td className="px-3 py-2">{run.productsSeen}</td>
      <td className="px-3 py-2">{run.createdCount}</td>
      <td className="px-3 py-2">{run.updatedCount}</td>
      <td className="px-3 py-2">{run.missingCount}</td>
      {/*
                        AZ ELVESZETT KAPCSOLATOK -- ES EZ A SZAM 2026-09-17 OTA
                        TULELI A FUTAST. Addig csak a naplóban állt, a napló
                        viszont a konténer indulásakor kezdődik, tehát egy
                        újratelepítés után a tegnapi veszteség sehol nem volt meg.

                        A KETTO OSSZEGE all itt, a bontás a sorban: egy tizedik
                        oszlop többet venne el a táblából, mint amennyit ad, és
                        a kérdés ("veszett-e el valami") az összegen dől el.
                      */}
      <td
        className={
          run.similarReferencesUnresolved + run.accessoryReferencesUnresolved >
          0
            ? "px-3 py-2 font-semibold text-amber-700"
            : "px-3 py-2 text-dusk-400"
        }
        title={`hasonló: ${run.similarReferencesUnresolved}, kiegészítő: ${run.accessoryReferencesUnresolved}`}
      >
        {run.similarReferencesUnresolved + run.accessoryReferencesUnresolved}
      </td>
      {/*
                        A nulla halvany, a nem-nulla kiemelt. Ez a szam a legtobb
                        futason nulla, es epp attol jelzes, hogy amikor nem az,
                        az egy sorbol kiugrik.
                      */}
      <td
        className={
          run.skippedSourceChangedCount > 0
            ? "px-3 py-2 font-semibold text-amber-700"
            : "px-3 py-2 text-dusk-400"
        }
      >
        {run.skippedSourceChangedCount}
      </td>
      <td className="max-w-64 px-3 py-2 font-mono text-xs text-rose-700">
        {run.errorCode ?? "—"}
      </td>
    </tr>
  );

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
          <div className="flex flex-wrap gap-2">
            {canManageConnection ? (
              <Button
                variant="secondary"
                onClick={() =>
                  router.push("/admin/integrations/unas/connection")
                }
              >
                Kapcsolat beállításai
              </Button>
            ) : null}
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
                <thead className="border-b bg-dusk-50 text-xs uppercase text-dusk-500">
                  <tr>
                    <th className="p-3">Állapot</th>
                    <th className="px-3 py-3">Típus</th>
                    <th className="px-3 py-3">Kezdés</th>
                    <th className="px-3 py-3">Befejezés</th>
                    <th className="px-3 py-3">Feldolgozott</th>
                    <th className="px-3 py-3">Új</th>
                    <th className="px-3 py-3">Frissített</th>
                    <th className="px-3 py-3">Hiányzó</th>
                    <th
                      className="px-3 py-3"
                      title="Ahány kapcsolat-hivatkozás elveszett: a célpont nincs a katalógusunkban. A hasonló és a kiegészítő ág összege; a bontás a futás sorában áll. Az önhivatkozás és a duplikátum NEM számít bele, azok szándékos kihagyások."
                    >
                      Elveszett kapcsolat
                    </th>
                    <th
                      className="px-3 py-3"
                      title="A kihagyottak közül ahánynál a boltban is változott a termék, tehát a változás nem jött át. A legtöbb futáson nulla."
                    >
                      Elavult
                    </th>
                    <th className="px-3 py-3">Hiba</th>
                  </tr>
                </thead>
                <tbody>
                  {groupRuns(runs).flatMap((row) => {
                    if (row.kind === "run") return [renderRun(row.run)];
                    const key = row.runs[0]!.id;
                    const isOpen = openIdle.has(key);
                    return [
                      <tr
                        key={`idle-${key}`}
                        className="border-b bg-dusk-50/40"
                      >
                        <td className="p-3" colSpan={11}>
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            onClick={() =>
                              setOpenIdle((current) => {
                                const next = new Set(current);
                                if (next.has(key)) next.delete(key);
                                else next.add(key);
                                return next;
                              })
                            }
                            className="text-sm text-dusk-600 hover:underline"
                          >
                            {isOpen
                              ? "Üres futások elrejtése"
                              : `${row.runs.length} üres futás (nem volt változás), ${dateTime(row.runs[row.runs.length - 1]!.startedAt)} és ${dateTime(row.runs[0]!.startedAt)} között`}
                          </button>
                        </td>
                      </tr>,
                      ...(isOpen ? row.runs.map(renderRun) : []),
                    ];
                  })}
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
