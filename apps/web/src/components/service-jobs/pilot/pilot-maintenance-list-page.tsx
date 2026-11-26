"use client";
import {
  Alert,
  Icon,
  PageHeader,
  Skeleton,
  PilotDataTable,
  Pagination,
  type PilotTableColumn,
  PAGE_GUTTER_X,
  ServiceListTabs,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type ServiceJobListResponse,
} from "@acropora/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { serviceJobsApi } from "@/lib/api/service-jobs";
import {
  urlChoice,
  urlPage,
  useUrlQuery,
} from "@/lib/navigation/use-url-query";
import { formatDateTime } from "@/components/worksheets/worksheet-labels";
import {
  commonLabel,
  commonPilotVariant,
  commonReasonText,
  commonStateOf,
} from "../common-status-view";
import {
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";
import { ServiceOfflineNotice } from "@/components/service/service-offline-notice";
import {
  MAINTENANCE_TABS,
  maintenanceSheetHref,
  maintenanceTotal,
  type MaintenanceTab,
} from "../service-job-list-view";
import { menuEyebrow } from "@/components/navigation";

/**
 * A KARBANTARTÁS-LISTA A HIBAJEGY-LISTA MINTÁJÁRA (picasso képernyő-leltár 3.9, acrobot 62090). Eddig a régi közös komponens futott itt:
 * fülek szám nélkül, keretben, lapozás nélkül ("A lista végéig értél"), a legújabb kétszáz lappal. Mostantól ugyanaz a lista-alak, mint a
 * Hibajegyeknél: a fülek a szerver számlálójával (`maintenanceCounts`: a jelvény szabálya, f4590db6), egy oldal 25 sor (`page`, `pageSize`),
 * az oldalszám a szűrt halmaz találataiból. A fül, a keresés, a rejtettek kapcsolója és az oldal az URL-ben áll: a lapról visszalépve a
 * lista ugyanott van. A fül vagy a keresés váltása az első oldalra visz.
 *
 * A KARBANTARTÁSI LAP NEM HIBAJEGY: nincs csempe (nincs állapotgépe), nincs partner-állapot, és a sor mindig a karbantartási lapot nyitja
 * (`maintenanceSheetHref`, Luca 2026-11-18), soha a munkalapot vagy a hibajegyet.
 */
export const MAINTENANCE_PAGE_SIZE = 25;
export const MAINTENANCE_TABLE_MIN_WIDTH = 900;

type JobRow = ServiceJobListResponse["items"][number];

/** A fül száma a szerver számlálójából; ha a válasz nem hozza (régi szerver), nincs szám, nem kitalált. */
export function maintenanceTabCounts(
  counts: ServiceJobListResponse["maintenanceCounts"],
): Record<MaintenanceTab, number> | null {
  if (!counts) return null;
  return {
    progress: maintenanceTotal(counts, "progress", 0),
    done: maintenanceTotal(counts, "done", 0),
    all: maintenanceTotal(counts, "all", 0),
  };
}

const TAB_NOUN: Record<MaintenanceTab, string> = {
  progress: "folyamatban lévő karbantartási lap",
  done: "lezárt karbantartási lap",
  all: "karbantartási lap",
};

export const PILOT_MAINTENANCE_COLUMNS: PilotTableColumn<JobRow>[] = [
  {
    id: "job",
    header: "Karbantartási lap",
    cell: (job) => (
      <>
        <p
          title={job.title}
          className="line-clamp-2 break-words font-semibold text-pilot-grey-900"
        >
          {job.title}
        </p>
        <p className="mt-1 font-mono text-xs text-pilot-grey-500">
          {job.jobNumber}
        </p>
        {job.hidden ? (
          <span className="mt-1 inline-block">
            <PilotBadge variant="amber">Rejtett</PilotBadge>
          </span>
        ) : null}
      </>
    ),
  },
  {
    id: "customer",
    header: "Partner / helyszín",
    cell: (job) => (
      <>
        <p className="break-words text-pilot-grey-900">
          {job.customerName ?? "Nincs megadva"}
        </p>
        <p className="mt-1 break-words text-xs text-pilot-grey-500">
          {job.departmentPath?.length ? job.departmentPath.join(" / ") : "—"}
        </p>
      </>
    ),
  },
  {
    id: "status",
    header: "Állapot",
    width: "200px",
    // a jelvény szabálya (Balázs, 2026-11-18): minden munkalap aláírva = Lezárt, különben Folyamatban; régi válasznál a `maintenanceDone`
    cell: (job) => {
      const state = commonStateOf(job) ?? {
        status: job.maintenanceDone
          ? ("CLOSED" as const)
          : ("IN_PROGRESS" as const),
        reason: null,
      };
      const reason = commonReasonText(state, "MAINTENANCE");
      return (
        <>
          <PilotBadge variant={commonPilotVariant(state)}>
            {commonLabel(state)}
          </PilotBadge>
          {reason ? (
            <p className="mt-1 text-xs text-pilot-grey-600">{reason}</p>
          ) : null}
        </>
      );
    },
  },
  {
    id: "worksheets",
    header: "Munkalap",
    width: "120px",
    nowrap: true,
    cell: (job) =>
      job.worksheetCount > 0 ? (
        <span className="rounded-full bg-pilot-grey-100 px-3 py-1 text-xs text-pilot-grey-700">
          {job.worksheetCount} munkalap
        </span>
      ) : (
        <span className="text-pilot-grey-300" aria-label="Nincs munkalap">
          —
        </span>
      ),
  },
  {
    id: "createdAt",
    header: "Létrehozva",
    width: "140px",
    nowrap: true,
    cell: (job) => (
      <span className="text-xs text-pilot-grey-600">
        {formatDateTime(job.createdAt)}
      </span>
    ),
  },
];

function pageRange(data: ServiceJobListResponse, page: number): string {
  if (!data.pagination) return String(data.items.length);
  const first = (page - 1) * data.pagination.pageSize + 1;
  return `${first}–${first + data.items.length - 1} / ${data.pagination.totalItems}`;
}

export function PilotMaintenanceListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const { params, update } = useUrlQuery();
  const tab = urlChoice<MaintenanceTab>(
    params,
    "tab",
    MAINTENANCE_TABS.map((entry) => entry.id),
    "progress",
  );
  const appliedSearch = params.get("q") ?? "";
  const includeHidden = params.get("hidden") === "1";
  const page = urlPage(params);
  const [search, setSearch] = useState(appliedSearch);
  const [data, setData] = useState<ServiceJobListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_MANAGE),
  );
  // a rejtés saját jog (OWNER, ADMIN), nem a `canManage`: a jelölő csak annak látszik, aki vissza is tudja állítani a rejtett lapokat
  const canHide = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_HIDE),
  );
  const token = session?.token ?? "";
  const maintenanceState = tab === "all" ? undefined : tab;

  // the typed text reaches the URL (and the server) after a pause; a new search goes to the first page
  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === appliedSearch) return;
    const timer = setTimeout(
      () => update({ q: trimmed || null, page: null }),
      250,
    );
    return () => clearTimeout(timer);
  }, [appliedSearch, search, update]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setData(
          await serviceJobsApi.list(
            token,
            "all",
            signal,
            appliedSearch,
            includeHidden,
            "MAINTENANCE",
            maintenanceState,
            undefined,
            { page, pageSize: MAINTENANCE_PAGE_SIZE },
          ),
        );
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A karbantartási lapok nem tölthetők be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [appliedSearch, canView, includeHidden, maintenanceState, page, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const goToPage = (target: number) =>
    update({ page: target > 1 ? String(target) : null });
  // a lap egy szűrés vagy egy rejtés után üressé válhat: az utolsó létező oldalra lépünk, nem egy üres oldal marad
  const lastPage = data?.pagination?.totalPages;
  const pageGone =
    data !== null &&
    data.items.length === 0 &&
    (data.pagination?.totalItems ?? 0) > 0 &&
    lastPage !== undefined &&
    page > lastPage;
  useEffect(() => {
    if (pageGone && lastPage !== undefined) goToPage(lastPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageGone, lastPage]);

  const counts = maintenanceTabCounts(data?.maintenanceCounts);

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a karbantartási lapokhoz"
        description="service.view jogosultság szükséges."
      />
    );

  return (
    <PilotThemeRoot
      bleed
      className={`flex min-h-screen flex-col gap-6 bg-pilot-grey-50 ${PAGE_GUTTER_X} py-8`}
    >
      {/* kapcsolat nélkül a sáv a lap állapotáról szól: betöltött lista mellett a frissítésről, üres képernyőn a hiányról */}
      <ServiceOfflineNotice
        state={data ? { kind: "loaded" } : { kind: "empty" }}
        pilot
      />
      <PageHeader
        // the line above the title is the page's menu entry (Picasso R7)
        eyebrow={menuEyebrow("/szerviz/karbantartas") ?? undefined}
        title="Karbantartás"
        description="A karbantartási lapok a szervizmunka életútját és a hozzájuk kapcsolt munkalapokat egy helyen tartják."
        actions={
          canManage ? (
            <Link href="/szerviz/karbantartas/uj">
              <PilotButton variant="primary" size="regular">
                <Icon name="plus" size={14} />
                Új karbantartási lap
              </PilotButton>
            </Link>
          ) : undefined
        }
      />

      {/* the lists' one tab shape (Picasso R9) and the shared tab keyboard (arrows, Home, End; barracuda on #2991) */}
      <ServiceListTabs
        variant="pill"
        label="Karbantartások szűrése"
        className="flex flex-wrap gap-0.5 sm:gap-1"
        idPrefix="karbantartas-ful"
        panelId="karbantartas-lista"
        active={tab}
        onSelect={(key) =>
          update({
            tab: key === "progress" ? null : (key as MaintenanceTab),
            page: null,
          })
        }
        tabs={MAINTENANCE_TABS.map((entry) => ({
          key: entry.id,
          label: entry.label,
          count: counts ? counts[entry.id] : undefined,
        }))}
      />

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          aria-label="Karbantartás keresése"
          placeholder="Munkaszám, partner vagy cím"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="min-w-0 flex-[1_1_10rem] rounded-md bg-white px-3 py-2.5 sm:w-full sm:max-w-[390px] sm:flex-none text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-400 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
        />
        {canHide ? (
          <PilotButton
            variant={includeHidden ? "primary" : "secondary"}
            onClick={() =>
              update({ hidden: includeHidden ? null : "1", page: null })
            }
          >
            {includeHidden ? "Rejtettek nélkül" : "Rejtettek is"}
          </PilotButton>
        ) : null}
      </div>

      {error ? (
        <Alert
          variant="danger"
          title="Betöltési hiba"
          description={error}
          action={
            <PilotButton variant="secondary" onClick={() => void load()}>
              Újrapróbálás
            </PilotButton>
          }
        />
      ) : null}

      {/* the panel the tabs show (aria-controls): the list's loading, empty and table states, one at a time */}
      <div
        id="karbantartas-lista"
        role="tabpanel"
        aria-labelledby={`karbantartas-ful-${tab}`}
        className="empty:hidden"
      >
        {loading && !data ? (
          <div
            className="flex flex-col gap-3"
            aria-label="Karbantartási lapok betöltése..."
          >
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-20" />
            ))}
          </div>
        ) : null}

        {data && data.items.length === 0 && !pageGone ? (
          <PilotCard className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <p className="text-sm font-semibold text-pilot-grey-700">
              {appliedSearch ? "Nincs találat" : "Nincs karbantartási lap"}
            </p>
            <p className="max-w-xs text-xs text-pilot-grey-400">
              {appliedSearch
                ? "Erre a keresésre nincs karbantartási lap ezen a fülön."
                : tab === "progress"
                  ? "Folyamatban lévő karbantartási lap jelenleg nincs. A lezártakat a fenti füleken nézheted meg."
                  : "Ezen a fülön most nincs karbantartási lap."}
            </p>
          </PilotCard>
        ) : null}

        {data && data.items.length > 0 ? (
          <PilotCard className="overflow-hidden">
            <PilotDataTable
              columns={PILOT_MAINTENANCE_COLUMNS}
              rows={data.items}
              rowKey={(job) => job.id}
              rowTestId="maintenance-job-row"
              minWidth={MAINTENANCE_TABLE_MIN_WIDTH}
              onRowActivate={(job) => router.push(maintenanceSheetHref(job))}
              rowLabel={(job) => `${job.jobNumber} ${job.title} megnyitása`}
              rowClassName={(job) => (job.hidden ? "opacity-50" : "")}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-pilot-grey-100 px-4 py-3 text-xs text-pilot-grey-500">
              {/* a találatszám a SZŰRT halmazé (a szerver adja), a sor-tartomány az oldalé */}
              <span>
                {pageRange(data, page)} {TAB_NOUN[tab]}
              </span>
            </div>
            {data.pagination && data.pagination.totalPages > 1 ? (
              <Pagination
                variant="directionF"
                position="bottom"
                page={data.pagination.page}
                totalPages={data.pagination.totalPages}
                onPageChange={goToPage}
              />
            ) : null}
          </PilotCard>
        ) : null}
      </div>
    </PilotThemeRoot>
  );
}
