"use client";

import {
  Alert,
  Icon,
  Pagination,
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotDataTable,
  PilotInput,
  PilotPageHeader,
  PilotSelect,
  Skeleton,
  type PilotTableColumn,
} from "@acropora/ui";
import {
  hasPermission,
  PARTNER_ORDER_STATUSES,
  PERMISSIONS,
  type PartnerOrderCandidateDto,
  type PartnerOrderListItemDto,
  type PartnerOrderListResponse,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { partnerOrdersApi } from "@/lib/api/partner-orders";
import { urlPage, useUrlQuery } from "@/lib/navigation/use-url-query";
import {
  errorText,
  formatQuoteMoney,
  isAbort,
} from "@/components/quotes/quote-format";

import {
  PARTNER_ORDER_LIST_STEPS,
  PARTNER_ORDER_STATUS,
  PARTNER_ORDERS_PATH,
} from "./partner-order-format";

const PAGE_SIZE = 25;

/**
 * A MEGRENDELÉSEK LISTÁJA (Értékesítés > Megrendelések). Az árajánlat-lista mintájára: a keresés, az
 * állapot és a lap az URL-ben áll. Az „Elfogadott ajánlatok” sáv azokat az ajánlatokat mutatja, amelyekből
 * még nincs megrendelés: innen lehet továbbvinni őket az elfogadás után.
 */
export function PartnerOrderListPage() {
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
  const statusFilter = params.get("status") ?? "";
  const [search, setSearch] = useState(appliedSearch);
  const [data, setData] = useState<PartnerOrderListResponse | null>(null);
  const [candidates, setCandidates] = useState<PartnerOrderCandidateDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

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
    return value;
  }, [appliedSearch, page, statusFilter]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        const [list, open] = await Promise.all([
          partnerOrdersApi.list(token, query, signal),
          partnerOrdersApi.candidates(token, signal),
        ]);
        setData(list);
        setCandidates(open);
      } catch (cause) {
        if (!isAbort(cause))
          setError(errorText(cause, "A megrendelések nem tölthetők be."));
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

  const createFrom = async (quoteId: string) => {
    setCreating(quoteId);
    setCreateError(null);
    try {
      const created = await partnerOrdersApi.create(token, quoteId);
      router.push(`${PARTNER_ORDERS_PATH}/${created.id}`);
    } catch (cause) {
      setCreateError(errorText(cause, "A megrendelés nem hozható létre."));
      setCreating(null);
    }
  };

  const columns: PilotTableColumn<PartnerOrderListItemDto>[] = [
    {
      id: "order",
      header: "Megrendelés",
      width: "28%",
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-semibold text-pilot-grey-900">{row.orderNumber}</p>
          <p className="truncate text-xs text-pilot-grey-600">{row.title}</p>
        </div>
      ),
    },
    {
      id: "partner",
      header: "Partner",
      width: "20%",
      cell: (row) => row.customerName ?? "—",
    },
    {
      id: "total",
      header: "Nettó összeg",
      width: "14%",
      align: "right",
      cell: (row) => (
        <span className="font-semibold">
          {formatQuoteMoney(row.netTotal, row.currency)}
        </span>
      ),
    },
    {
      id: "status",
      header: "Állapot",
      width: "12%",
      cell: (row) => (
        <span className="flex flex-wrap gap-1">
          <PilotBadge variant={PARTNER_ORDER_STATUS[row.status].variant}>
            {PARTNER_ORDER_STATUS[row.status].label}
          </PilotBadge>
          {row.quoteAccepted ? null : (
            <PilotBadge variant="danger">Elfogadás megváltozott</PilotBadge>
          )}
        </span>
      ),
    },
    {
      id: "chain",
      header: "Hol tart",
      width: "26%",
      cell: (row) => (
        <span className="flex flex-wrap gap-1">
          {PARTNER_ORDER_LIST_STEPS.map(({ step, label }) => (
            <PilotBadge
              key={step}
              variant={row.chain[step] > 0 ? "success" : "grey"}
            >
              {row.chain[step] > 0 ? `${label} ✓` : label}
            </PilotBadge>
          ))}
        </span>
      ),
    },
  ];

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a megrendelésekhez"
        description="quotes.view jogosultság szükséges."
      />
    );

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <PilotPageHeader
        eyebrow="Értékesítés / Megrendelések"
        title="Megrendelések"
        description="Az elfogadott ajánlatoktól a számláig: aláírt megrendelőlap, teljesítésigazolás és számla egy helyen."
      />

      {candidates.length > 0 ? (
        <PilotCard>
          <PilotCardHeader
            title={`Elfogadott ajánlatok, még nincs megrendelés (${candidates.length})`}
          />
          <div className="divide-y divide-pilot-grey-100 px-5">
            {candidates.map((candidate) => (
              <div
                key={candidate.quoteId}
                className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <span className="font-semibold">{candidate.quoteNumber}</span>{" "}
                  <span className="text-pilot-grey-600">
                    {candidate.title}
                    {candidate.customerName
                      ? ` · ${candidate.customerName}`
                      : ""}
                  </span>
                </div>
                {canManage ? (
                  <PilotButton
                    size="regular"
                    variant="secondary"
                    disabled={creating !== null}
                    onClick={() => void createFrom(candidate.quoteId)}
                  >
                    {creating === candidate.quoteId
                      ? "Létrehozás…"
                      : "Megrendelés létrehozása"}
                  </PilotButton>
                ) : null}
              </div>
            ))}
          </div>
          {createError ? (
            <div className="px-5 pb-4">
              <Alert variant="danger" title={createError} />
            </div>
          ) : null}
        </PilotCard>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-xl">
          <PilotInput
            aria-label="Keresés"
            leadingIcon={<Icon name="search" />}
            placeholder="Keresés megrendelésszám, ajánlat vagy partner alapján…"
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
          {PARTNER_ORDER_STATUSES.map((status) => (
            <option key={status} value={status}>
              {PARTNER_ORDER_STATUS[status].label}
            </option>
          ))}
        </PilotSelect>
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
          {appliedSearch || statusFilter
            ? "Nincs a szűrésnek megfelelő megrendelés."
            : "Még nincs megrendelés. Az elfogadott ajánlatokból itt hozhatod létre."}
        </p>
      ) : data ? (
        <>
          <PilotDataTable
            columns={columns}
            rows={data.items}
            rowKey={(row) => row.id}
            rowLabel={(row) => `${row.orderNumber} · ${row.title}`}
            onRowActivate={(row) =>
              router.push(`${PARTNER_ORDERS_PATH}/${row.id}`)
            }
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-pilot-grey-600">
              {data.total} megrendelés
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
