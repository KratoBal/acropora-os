"use client";

import {
  Alert,
  Button,
  Card,
  EmptyState,
  Icon,
  type IconName,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type ServiceJobListResponse,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { serviceJobsApi } from "@/lib/api/service-jobs";
// A dátumformázó a munkalapoknál él. Nem másolom ide: két formázó egy
// felületen előbb-utóbb két különböző alakot ad ugyanarra az időpontra.
import { formatDateTime } from "@/components/worksheets/worksheet-labels";
import { ServiceJobPageHeader } from "./service-job-page-chrome";
import { ServiceJobStatusBadge } from "./service-job-status-badge";
import {
  itemsForTab,
  listFooterLine,
  listSummary,
  SERVICE_JOB_TABS,
  type ServiceJobTab,
  tabDefinition,
} from "./service-job-list-view";

/**
 * A LISTA FÖLÖTTI HÁROM DOBOZ.
 *
 * A SZÁM A TELJES HALMAZBÓL JÖN, nem a betöltött lapból - ezért ad a szerver
 * állapotonkénti darabszámot. Egy lapból számolt összesítő ugyanígy nézne ki,
 * és csendben mást jelentene, amint a lista már nem fér ki egyszerre.
 */
function SummaryTile({
  icon,
  label,
  tone,
  value,
}: {
  icon: IconName;
  label: string;
  tone: string;
  value: number;
}) {
  return (
    <article className="flex items-center gap-4 rounded-xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <span
        className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${tone}`}
      >
        <Icon name={icon} size={20} />
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-bold tracking-tight text-slate-950 tabular-nums">
          {value}
        </p>
        <p className="truncate text-sm text-slate-500">{label}</p>
      </div>
    </article>
  );
}

/**
 * A HIBAJEGYEK LISTÁJA.
 *
 * KERESŐMEZŐ NINCS, ÉS EZ NEM HIÁNY, HANEM MÉRÉS: a szerver ma csak a `scope`
 * szűrőt ismeri. Egy kliensoldali kereső azt ígérné, hogy az egész halmazban
 * keres, holott csak a betöltött lapon - egy szűrő, ami csendben mást jelent,
 * rosszabb, mint a hiánya. A terv fejlécében álló kereső és partner-választó
 * ezért maradt ki ebből a körből; a következő kör szervveroldali szűrővel
 * kezdődik, nem a mező kirajzolásával.
 *
 * A NÉGY FÜL VISZONT BENT VAN, MERT KETTŐ KÖZÜLÜK A SZERVERTŐL KÉR: a `Nyitott`
 * és a `Várakozik` a nyitott halmazt, az `Összes` és a `Lezárt` a teljeset. A
 * két szűrt fül ezen belül válogat, és a lista alján álló mondat KIMONDJA,
 * amikor a szám csak a betöltött lapra vonatkozik.
 */
export function ServiceJobListPage() {
  const { session } = useAuth();
  const [tab, setTab] = useState<ServiceJobTab>("open");
  const [data, setData] = useState<ServiceJobListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_MANAGE),
  );
  const token = session?.token ?? "";
  const { scope, statuses } = tabDefinition(tab);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setData(await serviceJobsApi.list(token, scope, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A hibajegyek nem tölthetők be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canView, scope, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const items = useMemo(
    () => (data ? itemsForTab(data.items, tab) : []),
    [data, tab],
  );
  const summary = data ? listSummary(data.counts) : null;

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a hibajegyekhez"
        description="service.view jogosultság szükséges."
      />
    );

  return (
    <div className="space-y-6">
      <ServiceJobPageHeader
        eyebrow="Szerviz / Munkatér"
        title="Hibajegyek"
        description="Minden bejelentésnek legyen következő lépése. A hibajegy a lánc első eleme: mögötte állnak a munkalapok."
        actions={
          canManage ? (
            <Link href="/szerviz/hibajegyek/uj">
              <Button>Új hibajegy</Button>
            </Link>
          ) : undefined
        }
      />
      {error ? (
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
      ) : null}
      {summary ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <SummaryTile
            icon="service"
            label="Nyitott hibajegy"
            tone="bg-teal-50 text-teal-700"
            value={summary.open}
          />
          <SummaryTile
            icon="activity"
            label="Válaszra vagy alkatrészre vár"
            tone="bg-amber-50 text-amber-700"
            value={summary.waiting}
          />
          <SummaryTile
            icon="clipboard"
            label="Lezárt ügy"
            tone="bg-emerald-50 text-emerald-700"
            value={summary.closed}
          />
        </div>
      ) : null}
      <Card>
        <div
          className="flex flex-wrap gap-1 border-b border-slate-100 px-2 pt-2"
          role="tablist"
          aria-label="Hibajegyek szűrése"
        >
          {SERVICE_JOB_TABS.map((entry) => {
            const active = entry.id === tab;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(entry.id)}
                className={[
                  "-mb-px border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors",
                  active
                    ? "border-teal-600 text-teal-700"
                    : "border-transparent text-slate-500 hover:text-slate-900",
                ].join(" ")}
              >
                {entry.label}
              </button>
            );
          })}
        </div>
        {loading && !data ? (
          <div className="space-y-3 p-4" aria-label="Hibajegyek betöltése">
            <Skeleton className="h-16" />
            <Skeleton className="h-64" />
          </div>
        ) : null}
        {data && items.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="border-b border-slate-100 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
                  <tr>
                    <th className="px-5 py-3 font-bold">Hibajegy</th>
                    <th className="font-bold">Partner</th>
                    <th className="font-bold">Állapot</th>
                    <th className="font-bold">Munkalap</th>
                    <th className="px-5 font-bold">Létrehozva</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((job) => (
                    <tr
                      key={job.id}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70"
                    >
                      <td className="px-5 py-4">
                        <Link
                          href={`/szerviz/hibajegyek/${job.id}`}
                          className="font-semibold text-slate-950 hover:text-teal-700"
                        >
                          {job.title}
                        </Link>
                        <div className="mt-0.5 text-xs tracking-wide text-slate-400">
                          {job.jobNumber}
                        </div>
                      </td>
                      <td className="text-slate-600">
                        {job.customerName ?? "Nincs megadva"}
                      </td>
                      <td>
                        <ServiceJobStatusBadge status={job.status} />
                        {/* A PARTNER MÁST LÁT, és ez itt is látszik: a belső
                            állapot a jelvényen, a partneré alatta. Enélkül a
                            kezelő nem tudja, mit olvas a másik fél. */}
                        <div className="mt-1 text-xs text-slate-400">
                          A partner ezt látja: {job.partnerStatusLabel}
                        </div>
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                          <Icon name="clipboard" size={14} />
                          {job.worksheetCount} munkalap
                        </span>
                      </td>
                      <td className="px-5 text-xs text-slate-500">
                        {formatDateTime(job.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-5 py-3 text-xs text-slate-400">
              {listFooterLine({
                shown: items.length,
                truncated: data.truncated,
                filtered: statuses !== null,
              })}
            </p>
          </>
        ) : null}
        {data && !items.length ? (
          <EmptyState
            className="border-0"
            title="Nincs hibajegy"
            description={
              tab === "open"
                ? "Nyitott hibajegy jelenleg nincs. A lezártakat a fenti füleken nézheted meg."
                : "Ezen a fülön most nincs hibajegy."
            }
          />
        ) : null}
      </Card>
    </div>
  );
}
