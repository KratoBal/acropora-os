"use client";

import {
  Alert,
  Icon,
  Pagination,
  PilotBadge,
  PilotButton,
  PilotDataTable,
  PilotDateField,
  PilotInput,
  PilotPageHeader,
  PilotSelect,
  Skeleton,
  type PilotTableColumn,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type QuoteCloseReasonValue,
  type QuoteListItemDto,
  type QuoteListResponse,
  type QuoteStatusValue,
  budapestDayKey,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { quotesApi } from "@/lib/api/quotes";
import { urlPage, useUrlQuery } from "@/lib/navigation/use-url-query";

import {
  errorText,
  formatQuoteDay,
  formatQuoteMoney,
  isAbort,
  QUOTE_CLOSE_REASON,
  QUOTE_STATUS,
} from "./quote-format";
import { useUrlSort } from "@/lib/navigation/use-url-sort";

export const QUOTES_PATH = "/ajanlatok";
/** The sortable columns: the table's column id -> the server's sort field (`QUOTE_SORT_FIELDS`). */
const QUOTE_SORT_COLUMNS = {
  quote: "quoteNumber",
  status: "status",
  created: "createdAt",
} as const;
const PAGE_SIZE = 25;

/**
 * AZ ÁRAJÁNLATOK LISTÁJA (#1582 P1; Figma 35 · OS / Offers / List, 567:2).
 * A keresés, a szűrők és a lap az URL-ben áll. P8: állapot, elutasítási ok
 * és „Csak a lejártak” szűrő; a lejárt ajánlat jelölést kap (számított, nem
 * tárolt állapot). Ami a tervben adat nélkül állna (a három összesítő kártya,
 * a készítő-szűrő, az export, a workflow-magyarázat), az kimaradt.
 */
export function QuoteListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.QUOTES_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.QUOTES_MANAGE),
  );

  const { params, update } = useUrlQuery();
  const page = urlPage(params);
  const appliedSearch = params.get("q") ?? "";
  // P8: the lifecycle filters live in the URL as well
  const statusFilter = params.get("status") ?? "";
  const expiredOnly = params.get("expired") === "1";
  const reasonFilter = params.get("closeReason") ?? "";
  // Luca (card 7e5d3658): the creation day, from and to; the sort lives in the URL too (Balázs, card 2f6369a4)
  const createdFrom = params.get("createdFrom") ?? "";
  const createdTo = params.get("createdTo") ?? "";
  // the sort lives in the URL through the shared hook (card 2f6369a4): ascending, descending, back to the default
  const { sort, onSort, apiSort } = useUrlSort(QUOTE_SORT_COLUMNS);
  const [search, setSearch] = useState(appliedSearch);
  const [data, setData] = useState<QuoteListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(
      () =>
        update({
          q: search.trim() || null,
          ...(search.trim() !== appliedSearch ? { page: null } : {}),
        }),
      300,
    );
    return () => clearTimeout(timer);
  }, [appliedSearch, search, update]);

  const query = useMemo(() => {
    const value = new URLSearchParams();
    value.set("page", String(page));
    value.set("pageSize", String(PAGE_SIZE));
    if (appliedSearch) value.set("q", appliedSearch);
    if (statusFilter) value.set("status", statusFilter);
    if (expiredOnly) value.set("expired", "1");
    if (reasonFilter) value.set("closeReason", reasonFilter);
    if (createdFrom) value.set("createdFrom", createdFrom);
    if (createdTo) value.set("createdTo", createdTo);
    if (apiSort) {
      value.set("sort", apiSort.sort);
      value.set("direction", apiSort.direction);
    }
    return value;
  }, [
    appliedSearch,
    page,
    statusFilter,
    expiredOnly,
    reasonFilter,
    createdFrom,
    createdTo,
    apiSort,
  ]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setData(await quotesApi.list(token, query, signal));
      } catch (cause) {
        if (!isAbort(cause))
          setError(errorText(cause, "Az ajánlatok nem tölthetők be."));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canView, query, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const columns: PilotTableColumn<QuoteListItemDto>[] = [
    {
      id: "quote",
      header: "Ajánlat",
      width: "28%",
      sortable: true,
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-semibold text-pilot-grey-900">{row.quoteNumber}</p>
          <p className="truncate text-xs text-pilot-grey-600">{row.title}</p>
        </div>
      ),
    },
    {
      id: "partner",
      header: "Partner",
      width: "18%",
      cell: (row) => row.customerName ?? "—",
    },
    {
      id: "total",
      header: "Összeg",
      width: "14%",
      cell: (row) => (
        <span className="font-semibold">
          {row.latestVersion
            ? formatQuoteMoney(
                row.latestVersion.netTotal,
                row.latestVersion.currency,
              )
            : "—"}
        </span>
      ),
    },
    {
      id: "status",
      header: "Állapot",
      width: "12%",
      sortable: true,
      cell: (row) => (
        <span className="flex flex-wrap gap-1">
          <PilotBadge variant={QUOTE_STATUS[row.status].variant}>
            {QUOTE_STATUS[row.status].label}
          </PilotBadge>
          {row.isExpired ? (
            <PilotBadge variant="danger">Lejárt</PilotBadge>
          ) : null}
        </span>
      ),
    },
    {
      id: "created",
      header: "Készítve",
      width: "10%",
      nowrap: true,
      sortable: true,
      // the Budapest calendar day of the creation instant (not the UTC date: an evening quote stays on its day)
      cell: (row) => formatQuoteDay(budapestDayKey(row.createdAt)),
    },
    {
      id: "valid",
      header: "Érvényes",
      width: "10%",
      nowrap: true,
      cell: (row) => formatQuoteDay(row.latestVersion?.validUntil ?? null),
    },
    {
      id: "creator",
      header: "Készítő",
      width: "12%",
      cell: (row) => row.createdByName ?? "—",
    },
  ];

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed az árajánlatokhoz"
        description="quotes.view jogosultság szükséges."
      />
    );

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <PilotPageHeader
        eyebrow="Pénzügy / Árajánlatok"
        title="Árajánlatok"
        description="Projekt- és értékesítési ajánlatok, verziókkal és ügyfélstátusszal."
        actions={
          canManage ? (
            <PilotButton
              size="regular"
              onClick={() => router.push(`${QUOTES_PATH}/uj`)}
            >
              Új árajánlat
            </PilotButton>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-xl">
          <PilotInput
            aria-label="Keresés"
            leadingIcon={<Icon name="search" />}
            placeholder="Keresés ajánlatszám vagy megnevezés alapján…"
            value={search}
            onChange={setSearch}
          />
        </div>
        <PilotSelect
          chevron
          aria-label="Állapot"
          value={statusFilter}
          onChange={(value) => update({ status: value || null, page: null })}
        >
          <option value="">Minden állapot</option>
          {(Object.keys(QUOTE_STATUS) as QuoteStatusValue[]).map((status) => (
            <option key={status} value={status}>
              {QUOTE_STATUS[status].label}
            </option>
          ))}
        </PilotSelect>
        <PilotSelect
          chevron
          aria-label="Elutasítás oka"
          value={reasonFilter}
          onChange={(value) =>
            update({ closeReason: value || null, page: null })
          }
        >
          <option value="">Minden ok</option>
          {(Object.keys(QUOTE_CLOSE_REASON) as QuoteCloseReasonValue[]).map(
            (reason) => (
              <option key={reason} value={reason}>
                {QUOTE_CLOSE_REASON[reason]}
              </option>
            ),
          )}
        </PilotSelect>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={expiredOnly}
            onChange={(event) =>
              update({ expired: event.target.checked ? "1" : null, page: null })
            }
          />
          Csak a lejártak
        </label>
        <div
          className="flex flex-wrap items-center gap-2 text-sm text-pilot-grey-700"
          role="group"
          aria-label="Készítés napja"
        >
          <span>Készítve</span>
          <PilotDateField
            aria-label="Készítve ettől a naptól"
            value={createdFrom}
            max={createdTo || undefined}
            onChange={(day) => {
              // gépelés közben a félig beírt nap üres értéket ad: az nem szűrőváltozás
              if (day !== createdFrom)
                update({ createdFrom: day || null, page: null });
            }}
            className="w-40"
          />
          <span aria-hidden="true">–</span>
          <PilotDateField
            aria-label="Készítve eddig a napig"
            value={createdTo}
            min={createdFrom || undefined}
            onChange={(day) => {
              if (day !== createdTo)
                update({ createdTo: day || null, page: null });
            }}
            className="w-40"
          />
        </div>
      </div>

      {error ? (
        <Alert
          variant="danger"
          title="Hiba történt"
          description={error}
          action={
            <PilotButton variant="secondary" onClick={() => void load()}>
              Újra
            </PilotButton>
          }
        />
      ) : loading && !data ? (
        <Skeleton className="h-64 w-full" />
      ) : data && data.items.length === 0 ? (
        <p className="rounded-lg border border-pilot-grey-200 bg-white p-6 text-sm text-pilot-grey-600">
          {appliedSearch
            ? "Nincs a keresésnek megfelelő ajánlat."
            : "Még nincs árajánlat."}
        </p>
      ) : data ? (
        <>
          <PilotDataTable
            columns={columns}
            rows={data.items}
            rowKey={(row) => row.id}
            rowLabel={(row) => `${row.quoteNumber} · ${row.title}`}
            onRowActivate={(row) => router.push(`${QUOTES_PATH}/${row.id}`)}
            sort={sort}
            onSort={onSort}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-pilot-grey-600">
              {data.total} ajánlat · A publikált verziók zárolva maradnak, a
              módosítás új verziót hoz létre.
            </p>
            {totalPages > 1 ? (
              <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={(next) =>
                  update({ page: next === 1 ? null : String(next) })
                }
              />
            ) : null}
          </div>
        </>
      ) : null}
    </PilotThemeRoot>
  );
}
