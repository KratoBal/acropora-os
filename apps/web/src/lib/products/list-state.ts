export const PRODUCT_PAGE_SIZES = [25, 50, 100] as const;
export type ProductActiveFilter = "all" | "active" | "archived";

export interface ProductListUrlState {
  q: string;
  active: ProductActiveFilter;
  categoryId: string;
  brandId: string;
  page: number;
  pageSize: (typeof PRODUCT_PAGE_SIZES)[number];
}

export const DEFAULT_PRODUCT_LIST_STATE: ProductListUrlState = {
  q: "",
  active: "all",
  categoryId: "",
  brandId: "",
  page: 1,
  pageSize: 25,
};

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseProductListState(
  params: URLSearchParams,
): ProductListUrlState {
  const active = params.get("active");
  const size = positiveInteger(params.get("pageSize"), 25);
  return {
    q: params.get("q")?.trim() ?? "",
    active:
      active === "true" ? "active" : active === "false" ? "archived" : "all",
    categoryId: params.get("categoryId") ?? "",
    brandId: params.get("brandId") ?? "",
    page: positiveInteger(params.get("page"), 1),
    pageSize: PRODUCT_PAGE_SIZES.includes(
      size as (typeof PRODUCT_PAGE_SIZES)[number],
    )
      ? (size as (typeof PRODUCT_PAGE_SIZES)[number])
      : 25,
  };
}

export function serializeProductListState(state: ProductListUrlState): string {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.active === "active") params.set("active", "true");
  if (state.active === "archived") params.set("active", "false");
  if (state.categoryId) params.set("categoryId", state.categoryId);
  if (state.brandId) params.set("brandId", state.brandId);
  if (state.page > 1) params.set("page", String(state.page));
  if (state.pageSize !== 25) params.set("pageSize", String(state.pageSize));
  return params.toString();
}

export function changeProductFilters(
  state: ProductListUrlState,
  changes: Partial<Omit<ProductListUrlState, "page">>,
): ProductListUrlState {
  return { ...state, ...changes, page: 1 };
}

export function changeProductPage(
  state: ProductListUrlState,
  page: number,
  totalPages: number,
): ProductListUrlState {
  return {
    ...state,
    page: Math.min(Math.max(1, page), Math.max(1, totalPages)),
  };
}

export type ProductListViewState =
  "loading" | "error" | "empty" | "no-results" | "populated";

export function deriveProductListViewState(input: {
  loading: boolean;
  error: boolean;
  itemCount: number;
  hasFilters: boolean;
}): ProductListViewState {
  if (input.loading) return "loading";
  if (input.error) return "error";
  if (input.itemCount > 0) return "populated";
  return input.hasFilters ? "no-results" : "empty";
}

export interface Debouncer<T> {
  schedule(value: T): void;
  cancel(): void;
}

export function createDebouncer<T>(
  callback: (value: T) => void,
  delay = 350,
  scheduleTimer: typeof setTimeout = setTimeout,
  clearTimer: typeof clearTimeout = clearTimeout,
): Debouncer<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    schedule(value) {
      if (timer) clearTimer(timer);
      timer = scheduleTimer(() => callback(value), delay);
    },
    cancel() {
      if (timer) clearTimer(timer);
      timer = undefined;
    },
  };
}
