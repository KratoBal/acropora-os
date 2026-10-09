"use client";

import {
  Alert,
  Button,
  EmptyState,
  Icon,
  Pagination,
  PilotDataTable,
  PilotPageHeader,
  PilotThumbnail,
  Skeleton,
  thumbnailFallback,
  type PilotTableColumn,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type CatalogOption,
  type ProductListItem,
  type ProductListResponse,
} from "@acropora/types";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  PilotBadge,
  PilotButton,
  PilotInput,
  PilotSelect,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";
import { productApi } from "@/lib/api/products";
import {
  ShippingBulkBar,
  ShippingCell,
  ShippingFilterControls,
  shippingBulkInput,
} from "./product-shipping-list";
import {
  changeProductFilters,
  changeProductPage,
  createDebouncer,
  DEFAULT_PRODUCT_LIST_STATE,
  deriveProductListViewState,
  parseProductListState,
  PRODUCT_PAGE_SIZES,
  serializeProductListState,
  type ProductActiveFilter,
  type ProductListUrlState,
} from "@/lib/products/list-state";

function formatHuf(value: string | null): string {
  if (value === null) return "—";
  return `${Number(value).toLocaleString("hu-HU", { maximumFractionDigits: 2 })} Ft`;
}

/** "1–25 / 2 438": a látható sorok és az összes (Figma "Footer Count"). */
function pageRange(pagination: ProductListResponse["pagination"]): string {
  const total = pagination.totalItems;
  if (total === 0) return "0 / 0";
  const from = (pagination.page - 1) * pagination.pageSize + 1;
  const to = Math.min(pagination.page * pagination.pageSize, total);
  return `${from.toLocaleString("hu-HU")}–${to.toLocaleString("hu-HU")} / ${total.toLocaleString("hu-HU")}`;
}

function formatStock(value: string | null): string {
  if (value === null) return "—";
  return Number(value).toLocaleString("hu-HU", { maximumFractionDigits: 2 });
}

/**
 * AZ EREDET A NÉV ALATT, SZÖVEGKÉNT (Direction F, Figma 273:33: 12-es,
 * kék "UNAS-termék"), nem jelvényként: a jelvény az állapot oszlopé, és két
 * jelvény egy sorban egyenrangúnak mutatná a kettőt.
 */
function provenance(origin: "UNAS" | "LOCAL" | null): {
  label: string;
  className: string;
} {
  if (origin === "UNAS")
    return { label: "UNAS-termék", className: "text-pilot-blue-700" };
  if (origin === "LOCAL")
    return {
      label: "Helyi Acropora OS-termék",
      className: "text-pilot-grey-600",
    };
  return { label: "Eredet ellenőrzendő", className: "text-pilot-amber-700" };
}

/** A kártya felső élén a vékony meleg sáv (Figma "Warm Top Accent"). */
function WarmTopAccent() {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-x-4 top-0 h-0.5 bg-pilot-accent-warm"
    />
  );
}

function ProductTableSkeleton() {
  return (
    <section
      className="overflow-hidden rounded-2xl border border-pilot-grey-200 bg-white"
      aria-label="Terméklista betöltése"
    >
      <div className="bg-pilot-grey-100 px-5 py-3">
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="divide-y divide-pilot-grey-200">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="flex items-center gap-4 px-5 py-4">
            <Skeleton className="size-10 shrink-0" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="ml-auto h-4 w-24" />
            <Skeleton className="h-5 w-16" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function ProductListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryKey = searchParams.toString();
  const state = useMemo(
    () => parseProductListState(new URLSearchParams(queryKey)),
    [queryKey],
  );
  const [search, setSearch] = useState(state.q);
  const [data, setData] = useState<ProductListResponse | null>(null);
  const [categories, setCategories] = useState<CatalogOption[]>([]);
  const [brands, setBrands] = useState<CatalogOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  // a szállítási tömeges szerkesztés kijelölése (a82ed229); a lista minden
  // újratöltése törli, hogy ne maradjon kijelölve olyan, ami már nem látszik
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_MANAGE),
  );
  const token = session?.token ?? "";

  const replaceState = useCallback(
    (nextState: ProductListUrlState) => {
      const query = serializeProductListState(nextState);
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router],
  );

  useEffect(() => setSearch(state.q), [state.q]);

  useEffect(() => {
    if (search === state.q) return;
    const debouncer = createDebouncer((value: string) => {
      replaceState(changeProductFilters(state, { q: value.trim() }));
    });
    debouncer.schedule(search);
    return () => debouncer.cancel();
  }, [replaceState, search, state]);

  useEffect(() => {
    // Gate only on a valid session + products.view permission, never on
    // having a client-readable token: in production the session lives in
    // an httpOnly cookie (ProductionAuthAdapter never populates
    // session.token), so `!token` would permanently block this effect and
    // leave the page stuck on its initial loading state. `token` itself
    // (possibly "") still has to reach apiRequest unchanged — it decides
    // there whether to send a Bearer header or rely on the cookie.
    if (!canView) return;
    let active = true;
    setError(null);
    if (data) setRefreshing(true);
    else setLoading(true);

    void productApi
      .list(token, {
        page: state.page,
        pageSize: state.pageSize,
        search: state.q || undefined,
        active: state.active === "all" ? undefined : state.active === "active",
        categoryId: state.categoryId || undefined,
        brandId: state.brandId || undefined,
        shipping: state.shipping || undefined,
        shippingUnasDiffers: state.shippingDiffers || undefined,
      })
      .then((response) => {
        if (!active) return;
        setData(response);
        setSelected(new Set());
        if (
          response.pagination.totalPages > 0 &&
          state.page > response.pagination.totalPages
        ) {
          replaceState({ ...state, page: response.pagination.totalPages });
        }
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "A terméklista betöltése nem sikerült.",
          );
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      });
    return () => {
      active = false;
    };
  }, [canView, requestVersion, replaceState, state, token]);

  useEffect(() => {
    // Same reasoning as the effect above: gate on canView (session +
    // permission), not on the presence of a client-readable token.
    if (!canView) return;
    let active = true;
    void Promise.all([
      productApi.categoryOptions(token),
      productApi.brandOptions(token),
    ])
      .then(([categoryOptions, brandOptions]) => {
        if (active) {
          setCategories(categoryOptions);
          setBrands(brandOptions);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "A szűrőopciók betöltése nem sikerült.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [canView, token]);

  if (!canView) {
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a termékkatalógushoz"
        description="A megnyitáshoz products.view jogosultság szükséges."
      />
    );
  }

  const hasFilters = Boolean(
    state.q ||
    state.active !== "all" ||
    state.categoryId ||
    state.brandId ||
    state.shipping ||
    state.shippingDiffers,
  );
  const viewState = deriveProductListViewState({
    loading: loading && !data,
    error: Boolean(error && !data),
    itemCount: data?.items.length ?? 0,
    hasFilters,
  });

  const updateFilter = (changes: Partial<Omit<ProductListUrlState, "page">>) =>
    replaceState(changeProductFilters(state, changes));
  const resetFilters = () => {
    setSearch("");
    replaceState(DEFAULT_PRODUCT_LIST_STATE);
  };
  const detailHref = (productId: string) =>
    queryKey
      ? `/products/${productId}?returnTo=${encodeURIComponent(queryKey)}`
      : `/products/${productId}`;

  const openDetail = (product: ProductListItem) =>
    router.push(detailHref(product.id));
  const pageChange = (page: number) =>
    data
      ? replaceState(changeProductPage(state, page, data.pagination.totalPages))
      : undefined;

  /*
    A KÖZÖS OSZLOPRÁCS (a brief 5. pontja): a fejléc és a sor ugyanebből a
    definícióból épül, a szélességet és a számoszlopok jobbra zárását
    egyszer mondjuk ki (`PilotDataTable`).
  */
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const pageIds = data?.items.map((item) => item.id) ?? [];
  const allSelected =
    pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selectionColumn: PilotTableColumn<ProductListItem> = {
    id: "select",
    header: (
      <input
        type="checkbox"
        aria-label="Az oldal összes termékének kijelölése"
        checked={allSelected}
        onChange={() => setSelected(allSelected ? new Set() : new Set(pageIds))}
      />
    ),
    width: "44px",
    cell: (product) => (
      <input
        type="checkbox"
        aria-label={`${product.name} kijelölése`}
        checked={selected.has(product.id)}
        onClick={(event) => event.stopPropagation()}
        onChange={() => toggle(product.id)}
      />
    ),
  };
  const applyBulk = (muvelet: Parameters<typeof shippingBulkInput>[1]) => {
    setBulkBusy(true);
    setBulkError(null);
    void productApi
      .bulkShippingProfiles(token, shippingBulkInput([...selected], muvelet))
      .then(() => setRequestVersion((value) => value + 1))
      .catch((cause: unknown) =>
        setBulkError(
          cause instanceof Error
            ? cause.message
            : "A tömeges szerkesztés nem sikerült.",
        ),
      )
      .finally(() => setBulkBusy(false));
  };

  const columns: PilotTableColumn<ProductListItem>[] = [
    ...(canManage ? [selectionColumn] : []),
    {
      id: "product",
      header: "Termék",
      cell: (product) => {
        const origin = provenance(product.origin);
        return (
          <div className="flex min-w-0 items-center gap-3">
            <PilotThumbnail
              src={product.thumbnail?.url}
              alt={product.thumbnail?.altText ?? ""}
              fallback={thumbnailFallback({
                categoryPath: product.primaryCategory?.path,
                brandName: product.brand?.name,
              })}
            />
            <div className="min-w-0">
              {/*
                KÉT SOR, NEM EGY (stage, 2026-09-30: 1280-nál a halak nevéből
                csak a nemzetség látszott, "Acanthurus ch..."). A 72-es sorba
                két sor név és az eredet belefér; a teljes név a `title`-ben.
              */}
              <span
                title={product.name}
                className="line-clamp-2 text-sm font-semibold leading-5 text-pilot-grey-900"
              >
                {product.name}
              </span>
              <span className={`mt-0.5 block text-xs ${origin.className}`}>
                {origin.label}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      id: "sku",
      header: "SKU",
      width: "128px",
      cell: (product) => (
        <span className="block truncate text-[13px] text-pilot-grey-600">
          {product.primarySku ?? "—"}
        </span>
      ),
    },
    {
      id: "gross",
      header: "Bruttó ár",
      width: "120px",
      align: "right",
      cell: (product) => (
        <span className="text-pilot-grey-600">
          {formatHuf(product.grossPrice)}
        </span>
      ),
    },
    {
      id: "sale",
      header: "Akciós ár",
      width: "120px",
      align: "right",
      cell: (product) =>
        product.saleGrossPrice ? (
          <span className="font-semibold text-pilot-red-700">
            {formatHuf(product.saleGrossPrice)}
          </span>
        ) : (
          <span className="text-pilot-grey-400">—</span>
        ),
    },
    {
      id: "stock",
      header: "Készlet",
      width: "84px",
      align: "right",
      cell: (product) => (
        <span className="text-pilot-grey-900">
          {formatStock(product.stockOnHand)}
        </span>
      ),
    },
    {
      id: "status",
      header: "Állapot",
      width: "104px",
      cell: (product) => (
        <PilotBadge variant={product.isActive ? "success" : "grey"}>
          {product.isActive ? "Aktív" : "Archivált"}
        </PilotBadge>
      ),
    },
    {
      id: "shipping",
      header: "Szállítás",
      width: "180px",
      cell: (product) => <ShippingCell shipping={product.shipping} />,
    },
    {
      id: "action",
      header: "Művelet",
      width: "116px",
      align: "right",
      cell: (product) => (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            openDetail(product);
          }}
          className="inline-flex items-center gap-1 text-sm font-semibold text-pilot-aqua-700 hover:text-pilot-aqua-800"
        >
          Részletek
          <span aria-hidden="true">→</span>
        </button>
      ),
    },
  ];

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <PilotPageHeader
        title="Termékek"
        description="A teljes termékkatalógus és webshop-megjelenések operatív áttekintése."
        actions={
          <PilotButton
            size="regular"
            variant="secondary"
            disabled
            title="A termékszerkesztő egy következő sprintben készül el."
          >
            Új termék · hamarosan
          </PilotButton>
        }
      />

      <section className="rounded-2xl border border-pilot-grey-200 bg-white p-5">
        {/*
          A SZŰRŐSOR TÖRIK, NEM CSÚSZIK (a brief 10. pontja; a stage-en mérve
          2026-09-30: 1280-nál a rögzített sávok és a "Szűrők törlése" együtt
          szélesebbek voltak a kártyánál, és a lap vízszintesen görgetett).
          Rugalmas elemek alsó határral: ami nem fér, a következő sorba kerül.
        */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[240px] flex-[2_1_320px]">
            <PilotInput
              value={search}
              onChange={setSearch}
              leadingIcon={<Icon name="search" size={17} />}
              placeholder="Keresés név vagy SKU alapján…"
              aria-label="Termék keresése"
              className="h-10"
            />
          </div>
          <PilotSelect
            chevron
            aria-label="Aktivitási állapot"
            value={state.active}
            onChange={(value) =>
              updateFilter({ active: value as ProductActiveFilter })
            }
            className="min-w-[160px] flex-[1_1_180px] [&_select]:h-10"
          >
            <option value="all">Minden állapot</option>
            <option value="active">Aktív</option>
            <option value="archived">Archivált</option>
          </PilotSelect>
          <PilotSelect
            chevron
            aria-label="Kategória"
            value={state.categoryId}
            onChange={(value) => updateFilter({ categoryId: value })}
            className="min-w-[160px] flex-[1_1_180px] [&_select]:h-10"
          >
            <option value="">Minden kategória</option>
            {categories.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </PilotSelect>
          <PilotSelect
            chevron
            aria-label="Márka"
            value={state.brandId}
            onChange={(value) => updateFilter({ brandId: value })}
            className="min-w-[160px] flex-[1_1_180px] [&_select]:h-10"
          >
            <option value="">Minden márka</option>
            {brands.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </PilotSelect>
          <ShippingFilterControls
            value={state.shipping}
            differs={state.shippingDiffers}
            onChange={(next) => updateFilter(next)}
          />
          {/*
            A SÁV "SZŰRŐK TÖRLÉSE" LINKJE (Figma "Clear", meleg szöveg) CSAK
            AKKOR, HA VAN MIT TÖRÖLNI, ÉS NEM A "NINCS TALÁLAT" ÁLLAPOTBAN: ott
            az üres állapot maga kínálja fel ugyanezt, és két azonos gomb
            egymás mellett csak zaj.
          */}
          {hasFilters && viewState !== "no-results" ? (
            <button
              type="button"
              onClick={resetFilters}
              className="ml-auto whitespace-nowrap text-xs text-pilot-accent-warm-text hover:underline"
            >
              Szűrők törlése
            </button>
          ) : null}
        </div>
      </section>

      {refreshing ? (
        <p className="text-xs font-medium text-pilot-aqua-700" role="status">
          Lista frissítése…
        </p>
      ) : null}

      {error && data ? (
        <Alert
          variant="danger"
          title="A lista frissítése nem sikerült"
          description={error}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setRequestVersion((value) => value + 1)}
            >
              Újrapróbálás
            </Button>
          }
        />
      ) : null}

      {viewState === "loading" ? <ProductTableSkeleton /> : null}
      {viewState === "error" ? (
        <Alert
          variant="danger"
          title="A terméklista nem tölthető be"
          description={error ?? undefined}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setRequestVersion((value) => value + 1)}
            >
              Újrapróbálás
            </Button>
          }
        />
      ) : null}
      {viewState === "empty" ? (
        <EmptyState
          icon={<Icon name="package" />}
          title="A katalógus még üres"
          description="Az első termékek importálása vagy létrehozása után itt jelennek meg."
        />
      ) : null}
      {viewState === "no-results" ? (
        <EmptyState
          icon={<Icon name="search" />}
          title="Nincs találat"
          description="A megadott keresésre és szűrőkre nem található termék."
          action={
            <Button variant="secondary" onClick={resetFilters}>
              Szűrők törlése
            </Button>
          }
        />
      ) : null}

      {viewState === "populated" && data ? (
        <section className="relative overflow-hidden rounded-2xl border border-pilot-grey-200 bg-white">
          <WarmTopAccent />
          <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-pilot-accent-warm-text">
              {data.pagination.totalItems.toLocaleString("hu-HU")} termék
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label
                htmlFor="product-page-size"
                className="text-xs text-pilot-grey-500"
              >
                Sorok száma
              </label>
              <PilotSelect
                chevron
                id="product-page-size"
                className="w-20 [&_select]:h-9"
                value={String(state.pageSize)}
                onChange={(value) =>
                  updateFilter({
                    pageSize: Number(value) as ProductListUrlState["pageSize"],
                  })
                }
              >
                {PRODUCT_PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </PilotSelect>
              <Pagination
                variant="directionF"
                position="top"
                page={data.pagination.page}
                totalPages={data.pagination.totalPages}
                onPageChange={pageChange}
              />
            </div>
          </div>

          {canManage && selected.size > 0 ? (
            <div className="space-y-2 px-5 pb-3">
              <ShippingBulkBar
                count={selected.size}
                busy={bulkBusy}
                onApply={applyBulk}
                onClear={() => setSelected(new Set())}
              />
              {bulkError ? (
                <Alert
                  variant="danger"
                  title="A tömeges szerkesztés nem sikerült"
                  description={bulkError}
                />
              ) : null}
            </div>
          ) : null}
          <PilotDataTable
            columns={columns}
            rows={data.items}
            rowKey={(product) => product.id}
            onRowActivate={openDetail}
          />

          <div className="flex flex-col gap-3 border-t border-pilot-grey-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-pilot-grey-500">
              {pageRange(data.pagination)}
            </p>
            <Pagination
              variant="directionF"
              position="bottom"
              page={data.pagination.page}
              totalPages={data.pagination.totalPages}
              onPageChange={pageChange}
            />
          </div>
        </section>
      ) : null}
    </PilotThemeRoot>
  );
}
