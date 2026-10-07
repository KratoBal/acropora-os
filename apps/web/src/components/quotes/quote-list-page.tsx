"use client";

import {
  Alert,
  Button,
  Icon,
  Pagination,
  PilotBadge,
  PilotButton,
  PilotDataTable,
  PilotInput,
  PilotPageHeader,
  Skeleton,
  type PilotTableColumn,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type QuoteListItemDto,
  type QuoteListResponse,
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
  QUOTE_STATUS,
} from "./quote-format";

export const QUOTES_PATH = "/ajanlatok";
const PAGE_SIZE = 25;

/**
 * AZ ÁRAJÁNLATOK LISTÁJA (#1582 P1; Figma 35 · OS / Offers / List, 567:2).
 * A keresés és a lap az URL-ben áll. Ami a tervben adat nélkül állna (a három
 * összesítő kártya, az állapot- és készítő-szűrő, az export, a workflow-
 * magyarázat), az kimaradt: a PR leírása sorolja fel.
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
    return value;
  }, [appliedSearch, page]);

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
      width: "32%",
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
      cell: (row) => (
        <PilotBadge variant={QUOTE_STATUS[row.status].variant}>
          {QUOTE_STATUS[row.status].label}
        </PilotBadge>
      ),
    },
    {
      id: "valid",
      header: "Érvényes",
      width: "12%",
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

      <div className="max-w-xl">
        <PilotInput
          aria-label="Keresés"
          leadingIcon={<Icon name="search" />}
          placeholder="Keresés ajánlatszám vagy megnevezés alapján…"
          value={search}
          onChange={setSearch}
        />
      </div>

      {error ? (
        <Alert
          variant="danger"
          title="Hiba történt"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Újra
            </Button>
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
