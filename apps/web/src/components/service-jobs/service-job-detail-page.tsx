"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  serviceJobTimeline,
  type ServiceJobDetail,
  type ServiceJobStatusValue,
  type ServiceJobTimelineEntry,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { serviceJobsApi } from "@/lib/api/service-jobs";
import { formatDateTime } from "@/components/worksheets/worksheet-labels";
import {
  serviceJobStatusLabel,
  serviceJobStatusVariant,
} from "./service-job-labels";

/**
 * EGY NAPLÓSOR SZÖVEGE.
 *
 * Külön függvény, mert a naplónak HÁROM forrása van, és a három sor egy
 * mondatban olvasható. A szöveg nem a komponensben áll, hogy a mondat
 * felépítése tesztelhető legyen anélkül, hogy fel kellene rajzolni az oldalt.
 */
function timelineLine(entry: ServiceJobTimelineEntry): string {
  if (entry.kind === "status") {
    const to = serviceJobStatusLabel[entry.event.toStatus];
    if (entry.event.fromStatus === null) return `A hibajegy létrejött (${to}).`;
    const from = serviceJobStatusLabel[entry.event.fromStatus];
    return `${from} → ${to}`;
  }
  if (entry.kind === "worksheet")
    return `Munkalap a jegy alatt: ${entry.worksheet.number ?? "piszkozat"}`;
  return `Eszköz a jegyen: ${entry.asset.assetNumber} (${entry.asset.assetName})`;
}

/**
 * A HIBAJEGY RÉSZLETLAPJA: A JEGY, ÉS AMI TÖRTÉNT VELE.
 *
 * EZ SZERKEZET, NEM TERV. A legegyszerűbb alak, ami a menetet végigviszi:
 * lista, részlet, lépés. Hogy a képernyő végül hogyan nézzen ki, az nem itt
 * dől el - de amíg nincs semmi, addig nincs miről beszélni.
 *
 * A NAPLÓ HÁROM FORRÁSBÓL ÁLL ÖSSZE (állapotváltás, munkalap, eszköz), és az
 * összefésülést a közös `serviceJobTimeline` végzi, nem ez a komponens: a
 * mobil ugyanezt a sorrendet kell hogy mutassa, és egy szabály, ami két helyen
 * áll, egyszer elcsúszik.
 */
export function ServiceJobDetailPage({ jobId }: { jobId: string }) {
  const { session } = useAuth();
  const [job, setJob] = useState<ServiceJobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [stepping, setStepping] = useState(false);
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_MANAGE),
  );
  const token = session?.token ?? "";

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setJob(await serviceJobsApi.detail(token, jobId, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A hibajegy nem tölthető be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canView, jobId, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const timeline = useMemo(
    () =>
      job
        ? serviceJobTimeline({
            events: job.events,
            worksheets: job.worksheets,
            assets: job.assets,
          })
        : [],
    [job],
  );

  /**
   * A LÉPÉS UTÁN ÚJRATÖLTÜNK, nem a válaszból építünk.
   *
   * A `move` csak nyugtát ad. Ha a képernyőt abból raknánk össze, a napló új
   * sora hiányozna róla - és épp az a sor a bizonyíték, hogy a lépés megtörtént.
   */
  const step = async (to: ServiceJobStatusValue) => {
    setStepping(true);
    setStepError(null);
    try {
      await serviceJobsApi.move(token, jobId, { to });
      await load();
    } catch (cause) {
      setStepError(
        cause instanceof Error ? cause.message : "A lépés nem sikerült.",
      );
    } finally {
      setStepping(false);
    }
  };

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a hibajegyekhez"
        description="service.view jogosultság szükséges."
      />
    );

  if (loading && !job)
    return (
      <div className="space-y-3" aria-label="Hibajegy betöltése">
        <Skeleton className="h-16" />
        <Skeleton className="h-64" />
      </div>
    );

  if (error)
    return (
      <Alert
        variant="danger"
        title="Betöltési hiba"
        description={error}
        action={
          <Button variant="secondary" onClick={() => void load()}>
            Újrapróbálás
          </Button>
        }
      />
    );

  if (!job) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Hibajegy"
        title={`${job.jobNumber} - ${job.title}`}
        description={job.customerName ?? "Partner nincs megadva"}
        actions={
          <Link href="/szerviz/hibajegyek">
            <Button variant="secondary">Vissza a listára</Button>
          </Link>
        }
      />

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={serviceJobStatusVariant(job.partnerStatus)}>
            {serviceJobStatusLabel[job.status]}
          </Badge>
          <span className="text-xs text-slate-500">
            A partner ezt látja: {job.partnerStatusLabel}
          </span>
          <span className="text-xs text-slate-500">
            Létrehozva: {formatDateTime(job.createdAt)}
          </span>
        </div>
        {job.description ? (
          <p className="whitespace-pre-wrap text-sm">{job.description}</p>
        ) : null}
      </Card>

      {canManage ? (
        <Card className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">Következő lépés</h2>
          {stepError ? (
            <Alert
              variant="danger"
              title="A lépés nem ment"
              description={stepError}
            />
          ) : null}
          {job.allowedSteps.length ? (
            <div className="flex flex-wrap gap-2">
              {job.allowedSteps.map((to) => (
                <Button
                  key={to}
                  variant="secondary"
                  disabled={stepping}
                  onClick={() => void step(to)}
                >
                  {serviceJobStatusLabel[to]}
                </Button>
              ))}
            </div>
          ) : (
            /* A LEZÁRT JEGYEN NEM ÜRES A DOBOZ, hanem meg van mondva, miért.
               Egy eltűnt gombsor úgy néz ki, mint egy betöltési hiba. */
            <p className="text-sm text-slate-500">
              Ez a hibajegy lezárult, nincs több lépése.
            </p>
          )}
        </Card>
      ) : null}

      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold">Ami történt</h2>
        {timeline.length ? (
          <ol className="space-y-2" aria-label="A hibajegy naplója">
            {timeline.map((entry) => (
              <li
                key={`${entry.kind}-${entry.sortKey}`}
                className="border-b pb-2 text-sm last:border-0"
              >
                <div>{timelineLine(entry)}</div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {formatDateTime(entry.at)}
                  {entry.kind === "status" && entry.event.actorName
                    ? ` · ${entry.event.actorName}`
                    : ""}
                </div>
                {entry.kind === "status" && entry.event.note ? (
                  <div className="mt-1 whitespace-pre-wrap text-sm">
                    {entry.event.note}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState
            title="Nincs bejegyzés"
            description="Ezen a jegyen még nem történt semmi."
          />
        )}
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold">Munkalapok a jegy mögött</h2>
        {job.worksheets.length ? (
          <ul className="space-y-1 text-sm">
            {job.worksheets.map((worksheet) => (
              <li key={worksheet.id}>
                <Link
                  href={`/szerviz/munkalapok/${worksheet.id}`}
                  className="font-medium hover:text-teal-700"
                >
                  {worksheet.number ?? "Piszkozat"}
                </Link>
                <span className="ml-2 text-xs text-slate-500">
                  {worksheet.handedOverAt
                    ? `Átadva: ${formatDateTime(worksheet.handedOverAt)}`
                    : "Még nálunk van"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">
            Ehhez a jegyhez még nem tartozik munkalap.
          </p>
        )}
      </Card>
    </div>
  );
}
