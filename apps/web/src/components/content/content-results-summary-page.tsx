"use client";

import {
  Alert,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type ContentResultsSummary,
} from "@acropora/types";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { contentResultsApi } from "@/lib/api/content-results";
import { CHANNEL_LABELS } from "./content-history";

const MONTH = /^\d{4}-\d{2}$/;

const thisMonth = (now: Date = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Budapest" })
    .format(now)
    .slice(0, 7);

const shown = (value: number | null) =>
  value === null ? "–" : value.toLocaleString("hu-HU");

/**
 * AZ EREDMÉNYEK ÖSSZESÍTŐJE (T5.5 S8, spec 4.: „tartalom-típusonként az átlag és a legjobb/legrosszabb tétel; mi hozott
 * előjegyzést; melyik napszak és csatorna működött"). A kézzel felvitt heti számokból; ami nincs felvíve, az „–", és nem
 * számít bele az átlagba.
 */
export function ContentResultsSummaryPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session?.user && hasPermission(session.user, PERMISSIONS.CONTENT_VIEW),
  );
  const [from, setFrom] = useState(thisMonth());
  const [to, setTo] = useState(thisMonth());
  const [summary, setSummary] = useState<ContentResultsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!canView || !MONTH.test(from) || !MONTH.test(to)) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    contentResultsApi
      .summary(token, from, to, controller.signal)
      .then(setSummary)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setSummary(null);
        setError(cause instanceof Error ? cause.message : "Ismeretlen hiba.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canView, token, from, to]);

  if (!session?.user) return null;
  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs jogosultságod az eredményekhez"
        description="Az eredményeket a tartalmat olvasó kollégák látják."
      />
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tartalom eredményei"
        description="Kézzel felvitt heti számokból: elérés, kattintás, előjegyzés. A csatornák statisztikája nincs bekötve."
        actions={
          <Link
            href="/tartalom"
            className="text-sm font-medium text-pilot-aqua-700 underline-offset-4 hover:underline"
          >
            ← Tartalom
          </Link>
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm text-dusk-700">
          <span>Ettől (hónap)</span>
          <Input
            aria-label="Ettől"
            value={from}
            placeholder="ÉÉÉÉ-HH"
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm text-dusk-700">
          <span>Eddig (hónap)</span>
          <Input
            aria-label="Eddig"
            value={to}
            placeholder="ÉÉÉÉ-HH"
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>
      {error ? (
        <Alert
          variant="danger"
          title="Az eredmények nem elérhetők"
          description={`${error} Ez hiba, nem azt jelenti, hogy nem volt eredmény.`}
        />
      ) : loading && !summary ? (
        <Skeleton className="h-48 w-full" data-testid="results-loading" />
      ) : summary ? (
        summary.byChannel.length === 0 ? (
          <EmptyState
            title="Ebben az időszakban nem ment ki tartalom"
            description="Az eredmény a kiment tételekhez tartozik."
          />
        ) : (
          <>
            <Card className="space-y-2 p-4">
              <h2 className="text-base font-semibold text-dusk-900">
                Csatornánként
              </h2>
              <ul className="space-y-2 text-sm">
                {summary.byChannel.map((row) => (
                  <li key={row.channel}>
                    <span className="font-medium">
                      {CHANNEL_LABELS[row.channel]}
                    </span>
                    : {row.items} kiment, ebből {row.measured} mért · átlagos
                    elérés {shown(row.avgReach)} · átlagos kattintás{" "}
                    {shown(row.avgClicks)}
                    {row.best ? (
                      <>
                        {" "}
                        · legjobb:{" "}
                        <Link
                          href={`/tartalom/${encodeURIComponent(row.best.contentId)}`}
                          className="text-pilot-aqua-700 hover:underline"
                        >
                          {row.best.title}
                        </Link>{" "}
                        ({shown(row.best.reach)})
                      </>
                    ) : null}
                    {row.worst ? (
                      <>
                        {" "}
                        · leggyengébb:{" "}
                        <Link
                          href={`/tartalom/${encodeURIComponent(row.worst.contentId)}`}
                          className="text-pilot-aqua-700 hover:underline"
                        >
                          {row.worst.title}
                        </Link>{" "}
                        ({shown(row.worst.reach)})
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="space-y-2 p-4">
              <h2 className="text-base font-semibold text-dusk-900">
                Ami előjegyzést hozott
              </h2>
              {summary.preorders.length === 0 ? (
                <p className="text-sm text-dusk-500">
                  Nincs felvitt előjegyzés ebben az időszakban.
                </p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {summary.preorders.map((row) => (
                    <li key={row.contentId}>
                      <Link
                        href={`/tartalom/${encodeURIComponent(row.contentId)}`}
                        className="text-pilot-aqua-700 hover:underline"
                      >
                        {row.title}
                      </Link>
                      : {row.preorders} előjegyzés
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card className="space-y-2 p-4">
              <h2 className="text-base font-semibold text-dusk-900">
                Napszak szerint (a kiküldés budapesti órája)
              </h2>
              <ul className="space-y-1 text-sm">
                {summary.byDaypart.map((row) => (
                  <li key={row.daypart}>
                    {row.daypart}: {row.measured} mért tétel · átlagos elérés{" "}
                    {shown(row.avgReach)}
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )
      ) : null}
    </div>
  );
}
