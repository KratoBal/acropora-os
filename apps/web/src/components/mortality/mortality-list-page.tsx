"use client";

import {
  Alert,
  Button,
  Icon,
  Pagination,
  PilotButton,
  PilotDataTable,
  PilotInput,
  PilotPageHeader,
  PilotSelect,
  Skeleton,
  type PilotTableColumn,
} from "@acropora/ui";
import {
  hasPermission,
  MORTALITY_LIST_PAGE_SIZE,
  MORTALITY_SOURCE_LABELS,
  MORTALITY_SOURCE_TYPES,
  PERMISSIONS,
  type MortalityAquariumOption,
  type MortalityListItem,
  type MortalityListResponse,
  type MortalityRecorderOption,
  type MortalitySummary,
} from "@acropora/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { mortalityApi } from "@/lib/api/mortality";
import {
  urlChoice,
  urlPage,
  useUrlQuery,
} from "@/lib/navigation/use-url-query";
import {
  aquariumLabel,
  MORTALITY_PERIODS,
  monthCardTitle,
  periodRange,
  shortDateTime,
  shortDay,
  livestockSubtitle,
  livestockTitle,
  sourceSubtitle,
  sourceTitle,
  weekComparison,
  type MortalityPeriod,
} from "./mortality-format";
import {
  MortalitySearchPicker,
  type PickerOption,
} from "./mortality-search-picker";

export const MORTALITY_LIST_PATH = "/elhullasi-naplo";

const PERIOD_VALUES = MORTALITY_PERIODS.map((period) => period.value);

/**
 * AZ ELHULLÁSI NAPLÓ LISTÁJA (kártya 115c9740; Figma: OS / Elhullási napló /
 * Lista). Felül a három összesítő kártya, alatta a szűrők és a táblázat. A
 * szűrők és a lap az URL-ben állnak, hogy egy bejegyzésből visszalépve a lista
 * ugyanott legyen.
 */
export function MortalityListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.MORTALITY_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.MORTALITY_MANAGE),
  );

  const { params, update } = useUrlQuery();
  const sourceType = urlChoice(
    params,
    "sourceType",
    ["", ...MORTALITY_SOURCE_TYPES],
    "",
  );
  const period = urlChoice<MortalityPeriod>(
    params,
    "period",
    PERIOD_VALUES,
    "",
  );
  const aquariumId = params.get("aquariumId") ?? "";
  // a konkrét beszállító csak a „Beszállító” forrás mellett él: más forrással
  // a szerver ÉS-sel fűzné össze, és a lista csendben üres lenne
  const supplierId =
    sourceType === "SUPPLIER" ? (params.get("supplierId") ?? "") : "";
  // a név csak megjelenítés: a beszállítónak nincs azonosító szerinti
  // lekérdezése, és a visszalépett lista így is a választott nevet mutatja
  const supplierName = params.get("supplierName") ?? "";
  const recordedById = params.get("recordedById") ?? "";
  const page = urlPage(params);
  const appliedSearch = params.get("q") ?? "";
  const [search, setSearch] = useState(appliedSearch);
  const hasFilters = Boolean(
    appliedSearch ||
    sourceType ||
    supplierId ||
    period ||
    aquariumId ||
    recordedById,
  );

  const [data, setData] = useState<MortalityListResponse | null>(null);
  const [summary, setSummary] = useState<MortalitySummary | null>(null);
  const [summaryError, setSummaryError] = useState(false);
  const [aquariums, setAquariums] = useState<MortalityAquariumOption[]>([]);
  const [recorders, setRecorders] = useState<MortalityRecorderOption[]>([]);
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
    value.set("pageSize", String(MORTALITY_LIST_PAGE_SIZE.default));
    if (appliedSearch) value.set("q", appliedSearch);
    if (sourceType) value.set("sourceType", sourceType);
    if (supplierId) value.set("supplierId", supplierId);
    if (aquariumId) value.set("aquariumId", aquariumId);
    if (recordedById) value.set("recordedById", recordedById);
    const range = periodRange(period, new Date());
    if (range) {
      value.set("from", range.from);
      value.set("to", range.to);
    }
    return value;
  }, [
    appliedSearch,
    aquariumId,
    page,
    period,
    recordedById,
    sourceType,
    supplierId,
  ]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setData(await mortalityApi.list(token, query, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "Az elhullási napló nem tölthető be.",
          );
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

  // a kártyák és a választók a szűrőktől függetlenek: egyszer töltődnek
  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    mortalityApi
      .summary(token, controller.signal)
      .then(setSummary)
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setSummaryError(true);
      });
    mortalityApi
      .aquariumOptions(token, controller.signal)
      .then(setAquariums)
      .catch(() => undefined);
    mortalityApi
      .recorderOptions(token, controller.signal)
      .then(setRecorders)
      .catch(() => undefined);
    return () => controller.abort();
  }, [canView, token]);

  const setFilter = (key: string, value: string) =>
    update({ [key]: value || null, page: null });
  const setSourceType = (value: string) =>
    update({
      sourceType: value || null,
      ...(value === "SUPPLIER" ? {} : { supplierId: null, supplierName: null }),
      page: null,
    });
  const setSupplier = (option: PickerOption | null) =>
    update({
      supplierId: option?.id ?? null,
      supplierName: option?.title ?? null,
      page: null,
    });
  const searchSuppliers = useCallback(
    async (term: string, signal: AbortSignal) =>
      (await mortalityApi.supplierOptions(token, term, signal)).map(
        (option) => ({ id: option.id, title: option.name }),
      ),
    [token],
  );
  const clearFilters = () => {
    setSearch("");
    update({
      q: null,
      sourceType: null,
      supplierId: null,
      supplierName: null,
      period: null,
      aquariumId: null,
      recordedById: null,
      page: null,
    });
  };
  const goToPage = (next: number) =>
    update({ page: next === 1 ? null : String(next) });

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed az elhullási naplóhoz"
        description="mortality.view jogosultság szükséges."
      />
    );

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <PilotPageHeader
        title="Elhullási napló"
        description="A boltban elhullott élőlények nyilvántartása és visszakeresése."
        actions={
          canManage ? (
            <Link href={`${MORTALITY_LIST_PATH}/uj`}>
              <PilotButton size="regular">
                <Icon name="plus" size={14} />
                Új bejegyzés
              </PilotButton>
            </Link>
          ) : undefined
        }
      />

      {summaryError ? (
        <p className="text-sm text-pilot-grey-500">
          Az összesítő most nem tölthető be; a lista ettől független.
        </p>
      ) : (
        <MortalitySummaryCards summary={summary} />
      )}

      <section className="rounded-2xl border border-pilot-grey-200 bg-white p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[240px] flex-[2_1_320px]">
            <PilotInput
              aria-label="Keresés élőlény neve alapján"
              value={search}
              onChange={setSearch}
              leadingIcon={<Icon name="search" size={17} />}
              placeholder="Keresés élőlény neve alapján…"
              className="h-10"
            />
          </div>
          <PilotSelect
            chevron
            aria-label="Forrás"
            value={sourceType}
            onChange={setSourceType}
            className="min-w-[160px] flex-[1_1_170px] [&_select]:h-10"
          >
            <option value="">Minden forrás</option>
            {MORTALITY_SOURCE_TYPES.map((type) => (
              <option key={type} value={type}>
                {MORTALITY_SOURCE_LABELS[type]}
              </option>
            ))}
          </PilotSelect>
          {sourceType === "SUPPLIER" ? (
            <div className="min-w-[200px] flex-[1_1_220px]">
              <MortalitySearchPicker
                label="Beszállító"
                placeholder="Beszállító keresése…"
                value={
                  supplierId
                    ? {
                        id: supplierId,
                        title: supplierName || "Kiválasztott beszállító",
                      }
                    : null
                }
                onChange={setSupplier}
                search={searchSuppliers}
                emptyText="Nincs ilyen nevű beszállító."
              />
            </div>
          ) : null}
          <PilotSelect
            chevron
            aria-label="Akvárium"
            value={aquariumId}
            onChange={(value) => setFilter("aquariumId", value)}
            className="min-w-[180px] flex-[1_1_200px] [&_select]:h-10"
          >
            <option value="">Minden akvárium</option>
            {aquariums.map((aquarium) => (
              <option key={aquarium.id} value={aquarium.id}>
                {aquariumLabel(aquarium)}
              </option>
            ))}
          </PilotSelect>
          <PilotSelect
            chevron
            aria-label="Időszak"
            value={period}
            onChange={(value) => setFilter("period", value)}
            className="min-w-[160px] flex-[1_1_170px] [&_select]:h-10"
          >
            {MORTALITY_PERIODS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </PilotSelect>
          <PilotSelect
            chevron
            aria-label="Rögzítette"
            value={recordedById}
            onChange={(value) => setFilter("recordedById", value)}
            className="min-w-[160px] flex-[1_1_170px] [&_select]:h-10"
          >
            <option value="">Minden rögzítő</option>
            {recorders.map((recorder) => (
              <option key={recorder.id} value={recorder.id}>
                {recorder.name}
              </option>
            ))}
          </PilotSelect>
          {hasFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto cursor-pointer whitespace-nowrap text-xs text-pilot-accent-warm-text hover:underline"
            >
              Szűrők törlése
            </button>
          ) : null}
        </div>
      </section>

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
      {loading && !data ? (
        <div aria-label="Elhullási napló betöltése" className="space-y-3">
          <Skeleton className="h-64" />
        </div>
      ) : null}

      {data && !error ? (
        data.items.length ? (
          <section className="overflow-hidden rounded-2xl border border-pilot-grey-200 bg-white">
            <PilotDataTable
              columns={COLUMNS}
              rows={data.items}
              rowKey={(row) => row.id}
              rowLabel={(row) =>
                `${livestockTitle(row)}, ${shortDay(row.occurredOn)}`
              }
              onRowActivate={(row) =>
                router.push(
                  `${MORTALITY_LIST_PATH}/${encodeURIComponent(row.id)}`,
                )
              }
              minWidth={860}
            />
            <div className="flex flex-col gap-3 border-t border-pilot-grey-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-pilot-grey-500">
                {data.pagination.totalItems.toLocaleString("hu-HU")} bejegyzés
              </p>
              <Pagination
                position="bottom"
                page={data.pagination.page}
                totalPages={data.pagination.totalPages}
                onPageChange={goToPage}
              />
            </div>
          </section>
        ) : (
          <section className="flex flex-col items-center gap-3 rounded-2xl border border-pilot-grey-200 bg-white px-5 py-16 text-center">
            <Icon name="fish" size={24} className="text-pilot-grey-400" />
            <p className="text-base font-semibold text-pilot-grey-700">
              {hasFilters ? "Nincs találat" : "Még nincs elhullási bejegyzés"}
            </p>
            {hasFilters ? (
              <PilotButton variant="secondary" onClick={clearFilters}>
                Szűrők törlése
              </PilotButton>
            ) : null}
          </section>
        )
      ) : null}
    </PilotThemeRoot>
  );
}

const COLUMNS: readonly PilotTableColumn<MortalityListItem>[] = [
  {
    id: "product",
    header: "Élőlény",
    cell: (row) => (
      <div>
        <div className="font-medium italic text-pilot-grey-900">
          {livestockTitle(row)}
        </div>
        {livestockSubtitle(row) ? (
          <div className="text-xs text-pilot-grey-500">
            {livestockSubtitle(row)}
          </div>
        ) : null}
      </div>
    ),
  },
  {
    id: "quantity",
    header: "Példány",
    align: "right",
    cell: (row) => <span className="tabular-nums">{row.quantity} db</span>,
  },
  {
    id: "aquarium",
    header: "Akvárium / rack",
    // akvárium nélkül (csak halas racknél) a rack áll a helyén
    cell: (row) => (
      <div>
        <div>
          {row.aquarium
            ? aquariumLabel(row.aquarium)
            : (row.location?.name ?? "")}
        </div>
        {row.aquarium && row.location ? (
          <div className="text-xs text-pilot-grey-500">{row.location.name}</div>
        ) : !row.aquarium ? (
          <div className="text-xs text-pilot-grey-500">Halas rack</div>
        ) : null}
      </div>
    ),
  },
  {
    id: "source",
    header: "Forrás",
    cell: (row) => (
      <div>
        <div>{sourceTitle(row.source)}</div>
        {sourceSubtitle(row.source) ? (
          <div className="text-xs text-pilot-grey-500">
            {sourceSubtitle(row.source)}
          </div>
        ) : null}
      </div>
    ),
  },
  {
    id: "recordedBy",
    header: "Rögzítette",
    cell: (row) => row.recordedBy.name,
  },
  {
    // az elhullás napja (Luca, 2026-10-07); a lista is e szerint rendez és
    // szűr, a rögzítés ideje csak a második sor
    id: "occurredOn",
    header: "Elhullás napja",
    cell: (row) => (
      <div className="whitespace-nowrap tabular-nums">
        <div>{shortDay(row.occurredOn)}</div>
        <div className="text-xs text-pilot-grey-500">
          rögzítve {shortDateTime(row.recordedAt)}
        </div>
      </div>
    ),
  },
  {
    id: "open",
    header: <span className="sr-only">Megnyitás</span>,
    width: "40px",
    cell: () => (
      <span aria-hidden="true" className="text-pilot-grey-400">
        ›
      </span>
    ),
  },
];

/** A három összesítő kártya; amíg nem jött meg, üres helyőrző áll. */
function MortalitySummaryCards({
  summary,
}: {
  summary: MortalitySummary | null;
}) {
  const now = new Date();
  const cards = summary
    ? [
        {
          title: monthCardTitle(now),
          value: `${summary.thisMonth} példány`,
          hint: `${summary.thisMonthAquariumCount} akváriumban`,
        },
        {
          title: "Utolsó 7 nap",
          value: `${summary.last7Days} példány`,
          hint: weekComparison(summary),
        },
        {
          title: "Legérintettebb",
          value: summary.mostAffectedAquarium
            ? aquariumLabel(summary.mostAffectedAquarium)
            : "Nincs",
          hint: summary.mostAffectedAquarium
            ? `${summary.mostAffectedAquarium.quantity} példány ebben a hónapban`
            : "Ebben a hónapban nem volt elhullás",
        },
      ]
    : null;
  return (
    <div className="grid gap-4 sm:grid-cols-3" aria-label="Összesítő">
      {cards
        ? cards.map((card) => (
            <section
              key={card.title}
              className="rounded-2xl border border-pilot-grey-200 bg-white px-5 py-4"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-pilot-grey-500">
                {card.title}
              </p>
              <p className="mt-1 text-xl font-semibold text-pilot-grey-900">
                {card.value}
              </p>
              <p className="mt-1 text-xs text-pilot-grey-500">{card.hint}</p>
            </section>
          ))
        : [0, 1, 2].map((index) => <Skeleton key={index} className="h-24" />)}
    </div>
  );
}
