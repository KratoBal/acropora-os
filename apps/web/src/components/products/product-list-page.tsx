"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  Input,
  PageHeader,
  Pagination,
  Select,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type CatalogOption,
  type ProductListResponse,
} from "@acropora/types";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { productApi } from "@/lib/api/products";
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

function formatStock(value: string | null): string {
  if (value === null) return "—";
  return Number(value).toLocaleString("hu-HU", { maximumFractionDigits: 2 });
}

function ProductTableSkeleton() {
  return (
    <Card className="overflow-hidden" aria-label="Terméklista betöltése">
      <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="flex items-center gap-4 px-5 py-4">
            <Skeleton className="size-10 shrink-0" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="ml-auto h-4 w-24" />
            <Skeleton className="h-5 w-16" />
          </div>
        ))}
      </div>
    </Card>
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

  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_VIEW),
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
    if (!canView || !token) return;
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
      })
      .then((response) => {
        if (!active) return;
        setData(response);
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
    if (!canView || !token) return;
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
    state.q || state.active !== "all" || state.categoryId || state.brandId,
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Termékek"
        description="A teljes termékkatalógus és webshop-megjelenések operatív áttekintése."
        actions={
          <Button
            disabled
            title="A termékszerkesztő egy következő sprintben készül el."
          >
            Új termék · hamarosan
          </Button>
        }
      />

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_180px_240px_220px]">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            leadingIcon={<Icon name="search" size={17} />}
            placeholder="Keresés név vagy SKU alapján…"
            aria-label="Termék keresése"
          />
          <Select
            aria-label="Aktivitási állapot"
            value={state.active}
            onChange={(event) =>
              updateFilter({
                active: event.target.value as ProductActiveFilter,
              })
            }
          >
            <option value="all">Minden állapot</option>
            <option value="active">Aktív</option>
            <option value="archived">Archivált</option>
          </Select>
          <Select
            aria-label="Kategória"
            value={state.categoryId}
            onChange={(event) =>
              updateFilter({ categoryId: event.target.value })
            }
          >
            <option value="">Minden kategória</option>
            {categories.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Márka"
            value={state.brandId}
            onChange={(event) => updateFilter({ brandId: event.target.value })}
          >
            <option value="">Minden márka</option>
            {brands.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {refreshing ? (
        <p className="text-xs font-medium text-teal-700" role="status">
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
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600">
              <span className="font-semibold text-slate-900">
                {data.pagination.totalItems.toLocaleString("hu-HU")}
              </span>{" "}
              termék
            </p>
            <div className="flex items-center gap-2">
              <label
                htmlFor="product-page-size"
                className="text-xs text-slate-500"
              >
                Sorok száma
              </label>
              <Select
                id="product-page-size"
                className="h-8 w-20"
                value={state.pageSize}
                onChange={(event) =>
                  updateFilter({
                    pageSize: Number(
                      event.target.value,
                    ) as ProductListUrlState["pageSize"],
                  })
                }
              >
                {PRODUCT_PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Termék</th>
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3 text-right">Bruttó ár</th>
                  <th className="px-4 py-3 text-right">Akciós ár</th>
                  <th className="px-4 py-3 text-right">Készlet</th>
                  <th className="px-4 py-3">Állapot</th>
                  <th className="px-5 py-3 text-right">Művelet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {data.items.map((product) => (
                  <tr
                    key={product.id}
                    tabIndex={0}
                    className="cursor-pointer transition hover:bg-slate-50 focus:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-teal-500"
                    onClick={() => router.push(detailHref(product.id))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        router.push(detailHref(product.id));
                      }
                    }}
                  >
                    <td className="max-w-sm px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        {product.thumbnail ? (
                          <img
                            src={product.thumbnail.url}
                            alt={product.thumbnail.altText ?? ""}
                            className="size-10 rounded-lg border border-slate-200 object-cover"
                          />
                        ) : (
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                            <Icon name="package" size={17} />
                          </span>
                        )}
                        <span className="truncate text-sm font-semibold text-slate-900">
                          {product.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-xs text-slate-600">
                      {product.primarySku ?? "—"}
                    </td>
                    <td className="px-4 py-3.5 text-right text-sm text-slate-600">
                      {formatHuf(product.grossPrice)}
                    </td>
                    <td className="px-4 py-3.5 text-right text-sm font-semibold text-rose-600">
                      {product.saleGrossPrice
                        ? formatHuf(product.saleGrossPrice)
                        : "—"}
                    </td>
                    <td className="px-4 py-3.5 text-right text-sm text-slate-600">
                      {formatStock(product.stockOnHand)}
                    </td>
                    <td className="px-4 py-3.5">
                      <Badge variant={product.isActive ? "success" : "neutral"}>
                        {product.isActive ? "Aktív" : "Archivált"}
                      </Badge>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          router.push(detailHref(product.id));
                        }}
                      >
                        Részletek
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-center border-t border-slate-200 px-5 py-4 sm:justify-end">
            <Pagination
              page={data.pagination.page}
              totalPages={data.pagination.totalPages}
              onPageChange={(page) =>
                replaceState(
                  changeProductPage(state, page, data.pagination.totalPages),
                )
              }
            />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
