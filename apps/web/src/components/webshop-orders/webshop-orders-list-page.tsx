"use client";
import Link from "next/link";
import {
  Alert,
  Button,
  EmptyState,
  Icon,
  Pagination,
  PilotDataTable,
  PilotPageHeader,
  Skeleton,
  type PilotTableColumn,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  WEBSHOP_ORDER_PAYMENT_STATE_LABELS,
  WEBSHOP_ORDER_STAGES,
  WEBSHOP_ORDER_STAGE_LABELS,
  WEBSHOP_ORDER_STATUSES,
  WEBSHOP_ORDER_STATUS_LABELS,
  type WebshopOrderListItem,
  type WebshopOrderListResponse,
  type WebshopOrderPaymentState,
  type WebshopOrderSortField,
  type WebshopOrderStatus,
  glsDeliveryLabel,
} from "@acropora/types";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import {
  PilotButton,
  PilotInput,
  PilotSegmentedControl,
  PilotSelect,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";
import { formatStatusAge } from "@/components/webshop/webshop-orders-page";
import { webshopOrdersApi } from "@/lib/api/webshop-orders";

/**
 * WEBSHOP / RENDELÉSEK (Balázs, 2026-10-05; Figma 493:3, 493:232, 493:337,
 * 493:499): az új webshop rendeléseinek napi feldolgozó listája. A „UNAS
 * Megrendelések” oldal (`/webshop`) érintetlen mellette.
 *
 * Ebben a körben olvasó lista. A sorok jelölőnégyzete a prompt szerint
 * megvan, de tömeges művelet nincs (acrobot 26310, 3. döntés), ezért a
 * Figma lábléc-gombjai sem.
 */

/** A státusz-csempe: a Figma jele és színe, a Pilot tokenekből (sötét módban is). */
export const STATUS_TILE: Record<
  WebshopOrderStatus,
  { glyph: string; className: string }
> = {
  pending_processing: {
    glyph: "…",
    className: "bg-pilot-amber-100 text-pilot-amber-700",
  },
  confirmed: { glyph: "✓", className: "bg-pilot-blue-50 text-pilot-blue-700" },
  stocking: {
    glyph: "□",
    className: "bg-pilot-violet-50 text-pilot-violet-700",
  },
  out_for_delivery: {
    glyph: "→",
    className: "bg-pilot-accent-warm-soft text-pilot-accent-warm-text",
  },
  ready_for_pickup: {
    glyph: "•",
    className: "bg-pilot-green-50 text-pilot-green-700",
  },
  closed: { glyph: "✓", className: "bg-pilot-green-50 text-pilot-green-700" },
  closed_unsuccessfully: {
    glyph: "✕",
    className: "bg-pilot-red-50 text-pilot-red-700",
  },
};

/** A webshop sorszáma; egyedi rendelésszám (ACR-…) még nincs döntve. */
export const orderNumber = (displayId: number) => `#${displayId}`;

export function formatMoney(total: number, currency: string): string {
  const amount = total.toLocaleString("hu-HU", { maximumFractionDigits: 2 });
  return currency === "HUF" ? `${amount} Ft` : `${amount} ${currency}`;
}

const ORDER_DATE = new Intl.DateTimeFormat("hu-HU", {
  timeZone: "Europe/Budapest",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
export const formatOrderDate = (iso: string) =>
  ORDER_DATE.format(new Date(iso));

export function paymentText(item: WebshopOrderListItem): string {
  const state = item.payment.state
    ? WEBSHOP_ORDER_PAYMENT_STATE_LABELS[item.payment.state]
    : null;
  return [item.payment.method, state].filter(Boolean).join(" · ") || "—";
}

/** A szállítás a listán; GLS-nél a fajtája (ParcelShop, automata, házhoz), a GLS prompt 11. pontja szerint. */
export const shippingText = (item: WebshopOrderListItem) =>
  [
    glsDeliveryLabel({
      method: item.shipping.method,
      pointKind: item.shipping.pointKind,
      hasPoint: !!item.shipping.pickupPoint,
      storePickup: item.shipping.storePickup,
    }) ?? item.shipping.method,
    item.shipping.pickupPoint,
  ]
    .filter(Boolean)
    .join(" · ") || "—";

/** A vásárlói jelek (Balázs, 2026-09-02): ★ új, + másik nyitott, ↓N sikertelen, ⊘ vendég. */
function CustomerMarkers({ item }: { item: WebshopOrderListItem }) {
  const markers: { text: string; title: string }[] = [];
  if (item.customer.isNew) markers.push({ text: "★", title: "Új vásárló" });
  if (item.customer.hasOtherOpenOrder)
    markers.push({ text: "+", title: "Van másik nyitott rendelése" });
  if (item.customer.unsuccessfulOrderCount > 0)
    markers.push({
      text: `↓${item.customer.unsuccessfulOrderCount}`,
      title: `${item.customer.unsuccessfulOrderCount} sikertelenül lezárt rendelése van`,
    });
  if (item.customer.guest)
    markers.push({ text: "⊘", title: "Regisztráció nélkül vásárolt" });
  if (!markers.length) return null;
  return (
    <span className="mt-0.5 flex gap-1.5 text-xs text-pilot-accent-warm-text">
      {markers.map((marker) => (
        <span key={marker.title} title={marker.title} aria-label={marker.title}>
          {marker.text}
        </span>
      ))}
    </span>
  );
}

/**
 * SZÉLES-E A KÉPERNYŐ A TÁBLÁZATHOZ (1280 px fölött). A táblázat a menüsávval
 * együtt kb. 1300 px-et kér; alatta a Figma tablet-kerete (493:232)
 * kártyalistát mutat. Ahol nincs `matchMedia` (szerver, tesztkörnyezet), a
 * táblázat áll: az a teljes nézet.
 */
const WIDE_QUERY = "(min-width: 1280px)";
function useWide(): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const query = window.matchMedia(WIDE_QUERY);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () =>
      typeof window === "undefined" || !window.matchMedia
        ? true
        : window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );
}

/** Egy rendelés kártyaként (tablet, Figma 493:232): ugyanazok az adatok, mint a sorban. */
function OrderCard({
  item,
  now,
  onOpen,
}: {
  item: WebshopOrderListItem;
  now: number;
  onOpen: (item: WebshopOrderListItem) => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-label={`${orderNumber(item.displayId)} megnyitása${item.status.stale ? ", elavult" : ""}`}
        onClick={() => onOpen(item)}
        className={`block w-full rounded-xl border p-4 text-left transition-colors hover:border-pilot-accent-warm ${
          item.status.stale
            ? "border-pilot-amber-100 bg-pilot-amber-50"
            : "border-pilot-grey-200 bg-white"
        }`}
      >
        <span className="flex items-start justify-between gap-3">
          <span className="font-semibold text-pilot-grey-900">
            {orderNumber(item.displayId)}
          </span>
          <StatusCell item={item} now={now} />
        </span>
        <span className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <span className="min-w-0">
            <span className="block truncate font-medium text-pilot-grey-900">
              {item.customer.name ?? item.customer.email}
            </span>
            <CustomerMarkers item={item} />
          </span>
          <span className="font-semibold text-pilot-grey-900">
            {formatMoney(item.total, item.currency)}
          </span>
          <span className="text-[13px] text-pilot-grey-700">
            {shippingText(item)}
          </span>
          <span className="text-[13px] text-pilot-grey-700">
            {paymentText(item)}
          </span>
          <span className="text-xs">
            {item.invoiceNumber ? (
              <span className="text-pilot-grey-600">{item.invoiceNumber}</span>
            ) : item.stage === "invoice" ? (
              <span className="text-pilot-accent-warm-text">Számlára vár</span>
            ) : null}
          </span>
          {item.relatedOrder ? (
            <span className="text-xs text-pilot-accent-warm-text">
              {item.relatedOrder.role === "pickup"
                ? "Van bolti átvételes része"
                : "Bolti átvételes rész"}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

function StatusCell({
  item,
  now,
}: {
  item: WebshopOrderListItem;
  now: number;
}) {
  if (!item.status.code)
    return <span className="text-pilot-grey-500">Nincs státusz</span>;
  const tile = STATUS_TILE[item.status.code];
  return (
    <span className="flex items-start gap-2">
      <span
        aria-hidden="true"
        className={`flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${tile.className}`}
      >
        {tile.glyph}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-pilot-grey-900">
          {item.status.label}
        </span>
        <span
          className={`block text-xs ${item.status.stale ? "font-medium text-pilot-amber-700" : "text-pilot-grey-500"}`}
        >
          {formatStatusAge(item.status.changedAt, now)}
          {item.status.stale ? " · elavult" : ""}
        </span>
      </span>
    </span>
  );
}

const SORTABLE: Partial<Record<string, WebshopOrderSortField>> = {
  number: "displayId",
  date: "createdAt",
  customer: "customer",
  total: "total",
  status: "status",
};

const FILTER_KEYS = [
  "stage",
  "q",
  "from",
  "to",
  "status",
  "shippingMethod",
  "paymentMethod",
  "paymentState",
  "invoice",
  "customerType",
  "newCustomer",
] as const;
const MORE_FILTER_KEYS = [
  "paymentMethod",
  "paymentState",
  "invoice",
  "customerType",
  "newCustomer",
] as const;

export function WebshopOrdersListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [data, setData] = useState<WebshopOrderListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [moreOpen, setMoreOpen] = useState(
    MORE_FILTER_KEYS.some((key) => params.get(key)),
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const wide = useWide();
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.ORDERS_VIEW),
  );
  const token = session?.token ?? "";
  const paramsKey = params.toString();

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setData(
          await webshopOrdersApi.list(
            token,
            new URLSearchParams(paramsKey),
            signal,
          ),
        );
        setNow(Date.now());
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A rendelések nem tölthetők be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canView, paramsKey, token],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const replace = useCallback(
    (change: (next: URLSearchParams) => void, resetPage = true) => {
      const next = new URLSearchParams(paramsKey);
      change(next);
      if (resetPage) next.delete("page");
      router.replace(next.size ? `${pathname}?${next}` : pathname);
    },
    [paramsKey, pathname, router],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (search === (new URLSearchParams(paramsKey).get("q") ?? "")) return;
      replace((next) => (search ? next.set("q", search) : next.delete("q")));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [paramsKey, replace, search]);

  const setParam = (name: string, value: string) =>
    replace((next) => (value ? next.set(name, value) : next.delete(name)));
  const hasFilters = FILTER_KEYS.some((key) => params.get(key));
  const clearFilters = () => {
    setSearch("");
    replace((next) => FILTER_KEYS.forEach((key) => next.delete(key)));
  };
  const view = params.get("view") === "all" ? "all" : "open";
  const sort =
    (params.get("sort") as WebshopOrderSortField | null) ?? "createdAt";
  const direction = params.get("direction") === "asc" ? "asc" : "desc";
  const toggleSort = (field: WebshopOrderSortField) =>
    replace((next) => {
      next.set("sort", field);
      next.set(
        "direction",
        sort === field && direction === "desc" ? "asc" : "desc",
      );
    }, false);
  const openOrder = (item: WebshopOrderListItem) =>
    router.push(`/webshop/rendelesek/${encodeURIComponent(item.id)}`);
  const toggleSelected = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sortHeader = (id: string, label: string) => {
    const field = SORTABLE[id];
    if (!field) return label;
    const active = sort === field;
    return (
      <button
        type="button"
        onClick={() => toggleSort(field)}
        aria-label={`Rendezés: ${label}`}
        aria-sort={
          active
            ? direction === "asc"
              ? "ascending"
              : "descending"
            : undefined
        }
        className="inline-flex items-center gap-1 bg-transparent uppercase hover:text-pilot-grey-700"
      >
        {label}
        <span aria-hidden="true" className={active ? "" : "opacity-0"}>
          {direction === "asc" ? "↑" : "↓"}
        </span>
      </button>
    );
  };

  const columns: PilotTableColumn<WebshopOrderListItem>[] = [
    {
      id: "select",
      header: <span className="sr-only">Kijelölés</span>,
      width: "48px",
      cell: (item) => (
        <input
          type="checkbox"
          aria-label={`Kijelölés: ${orderNumber(item.displayId)}`}
          checked={selected.has(item.id)}
          onClick={(event) => event.stopPropagation()}
          onChange={() => toggleSelected(item.id)}
          className="size-4 accent-pilot-accent-warm"
        />
      ),
    },
    {
      id: "number",
      header: sortHeader("number", "Rendelésszám"),
      width: "150px",
      cell: (item) => (
        <span className="block">
          <span className="font-semibold text-pilot-grey-900">
            {orderNumber(item.displayId)}
          </span>
          {item.relatedOrder ? (
            /*
              A KAPCSOLT RENDELÉS LINK (a prompt 15. pontja): a sor maga is
              megnyitja a saját rendelést, ezért a kattintás itt nem megy tovább.
            */
            <Link
              href={`/webshop/rendelesek/${encodeURIComponent(item.relatedOrder.id)}`}
              onClick={(event) => event.stopPropagation()}
              className="mt-0.5 block text-[11px] text-pilot-accent-warm-text underline-offset-2 hover:underline"
            >
              {item.relatedOrder.role === "pickup"
                ? "Van bolti átvételes része"
                : "Bolti átvételes rész"}
            </Link>
          ) : null}
        </span>
      ),
    },
    {
      id: "date",
      header: sortHeader("date", "Dátum"),
      width: "112px",
      cell: (item) => (
        <span className="text-[13px] text-pilot-grey-600">
          {formatOrderDate(item.createdAt)}
        </span>
      ),
    },
    {
      id: "customer",
      header: sortHeader("customer", "Vevő"),
      cell: (item) => (
        <span className="block min-w-0">
          <span className="block truncate font-semibold text-pilot-grey-900">
            {item.customer.name ?? item.customer.email}
          </span>
          <CustomerMarkers item={item} />
        </span>
      ),
    },
    {
      id: "total",
      header: sortHeader("total", "Összeg"),
      width: "112px",
      cell: (item) => (
        <span className="font-semibold text-pilot-grey-900">
          {formatMoney(item.total, item.currency)}
        </span>
      ),
    },
    {
      id: "shipping",
      header: "Szállítás",
      cell: (item) => (
        <span className="line-clamp-2 text-[13px] text-pilot-grey-700">
          {shippingText(item)}
        </span>
      ),
    },
    {
      id: "payment",
      header: "Fizetés",
      width: "150px",
      cell: (item) => (
        <span className="text-[13px] text-pilot-grey-700">
          {paymentText(item)}
          {item.payment.holdWarning ? (
            <span
              className={`block text-xs font-medium ${item.payment.holdWarning === "expired" ? "text-pilot-red-700" : "text-pilot-amber-700"}`}
            >
              {item.payment.holdWarning === "expired"
                ? "A zárolás lejárt"
                : "A zárolás 2 napon belül lejár"}
            </span>
          ) : null}
          {item.transferReceived ? (
            <span className="block text-xs font-medium text-pilot-green-700">
              Kifizetve
            </span>
          ) : item.proformaExpired ? (
            <span className="block text-xs font-medium text-pilot-red-700">
              Lejárt díjbekérő
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "invoice",
      header: "Számla",
      width: "130px",
      cell: (item) =>
        item.invoiceNumber ? (
          <span className="text-xs text-pilot-grey-600">
            {item.invoiceNumber}
          </span>
        ) : item.stage === "invoice" ? (
          <span className="text-xs text-pilot-accent-warm-text">
            Számlára vár
          </span>
        ) : (
          <span className="text-xs text-pilot-grey-400">—</span>
        ),
    },
    {
      id: "status",
      header: sortHeader("status", "Státusz"),
      width: "200px",
      cell: (item) => <StatusCell item={item} now={now} />,
    },
  ];

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a rendelésekhez"
        description="A megtekintéshez orders.view jogosultság szükséges."
      />
    );

  const stage = params.get("stage") ?? "";
  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / data.pageSize))
    : 1;

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        eyebrow="Webshop / Rendelések"
        title="Rendelések"
        description="Új webshop rendelések feldolgozása, számlázása és feladása egy helyen."
      />

      <div
        role="group"
        aria-label="Feldolgozási számlálók"
        className="grid grid-cols-2 gap-3 md:grid-cols-5"
      >
        {WEBSHOP_ORDER_STAGES.map((key) => {
          const active = stage === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => setParam("stage", active ? "" : key)}
              className={`rounded-xl border bg-white px-4 py-3 text-left transition-colors hover:border-pilot-accent-warm ${active ? "border-pilot-accent-warm" : "border-pilot-grey-200"}`}
            >
              <span
                className={`block text-xs font-semibold ${key === "stale" ? "text-pilot-accent-warm-text" : "text-pilot-grey-700"}`}
              >
                {WEBSHOP_ORDER_STAGE_LABELS[key]}
              </span>
              <span className="mt-1 block text-2xl font-semibold text-pilot-grey-900">
                {data ? data.counters[key] : "–"}
              </span>
            </button>
          );
        })}
      </div>

      <PilotSegmentedControl
        options={["Nyitott", "Összes"]}
        value={view === "all" ? "Összes" : "Nyitott"}
        onChange={(value) =>
          replace((next) =>
            value === "Összes" ? next.set("view", "all") : next.delete("view"),
          )
        }
      />

      <section className="rounded-2xl border border-pilot-grey-200 bg-white p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[240px] flex-[2_1_320px]">
            <PilotInput
              aria-label="Keresés"
              value={search}
              onChange={setSearch}
              leadingIcon={<Icon name="search" size={17} />}
              placeholder="Keresés rendelés, vevő, e-mail, telefon vagy számla alapján"
              className="h-10"
            />
          </div>
          <PilotInput
            aria-label="Dátum -tól"
            type="date"
            value={params.get("from") ?? ""}
            onChange={(value) => setParam("from", value)}
            className="h-10 w-[150px]"
          />
          <PilotInput
            aria-label="Dátum -ig"
            type="date"
            value={params.get("to") ?? ""}
            onChange={(value) => setParam("to", value)}
            className="h-10 w-[150px]"
          />
          <PilotSelect
            chevron
            aria-label="Státusz"
            value={params.get("status") ?? ""}
            onChange={(value) => setParam("status", value)}
            className="min-w-[180px] flex-[1_1_180px] [&_select]:h-10"
          >
            <option value="">Minden státusz</option>
            {WEBSHOP_ORDER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {WEBSHOP_ORDER_STATUS_LABELS[status]}
              </option>
            ))}
          </PilotSelect>
          <PilotSelect
            chevron
            aria-label="Szállítási mód"
            value={params.get("shippingMethod") ?? ""}
            onChange={(value) => setParam("shippingMethod", value)}
            className="min-w-[180px] flex-[1_1_180px] [&_select]:h-10"
          >
            <option value="">Minden szállítási mód</option>
            {(data?.shippingMethods ?? []).map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </PilotSelect>
          <PilotButton
            size="regular"
            variant="secondary"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((open) => !open)}
          >
            További szűrők
          </PilotButton>
          {hasFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="whitespace-nowrap bg-transparent text-xs text-pilot-accent-warm-text hover:underline"
            >
              Szűrők törlése
            </button>
          ) : null}
        </div>
        {moreOpen ? (
          <div className="mt-3 flex flex-wrap gap-3 border-t border-pilot-grey-200 pt-3">
            <PilotSelect
              chevron
              aria-label="Fizetési mód"
              value={params.get("paymentMethod") ?? ""}
              onChange={(value) => setParam("paymentMethod", value)}
              className="min-w-[180px] [&_select]:h-10"
            >
              <option value="">Minden fizetési mód</option>
              {(data?.paymentMethods ?? []).map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </PilotSelect>
            <PilotSelect
              chevron
              aria-label="Fizetési állapot"
              value={params.get("paymentState") ?? ""}
              onChange={(value) => setParam("paymentState", value)}
              className="min-w-[180px] [&_select]:h-10"
            >
              <option value="">Minden fizetési állapot</option>
              {(
                Object.keys(
                  WEBSHOP_ORDER_PAYMENT_STATE_LABELS,
                ) as WebshopOrderPaymentState[]
              ).map((state) => (
                <option key={state} value={state}>
                  {WEBSHOP_ORDER_PAYMENT_STATE_LABELS[state]}
                </option>
              ))}
            </PilotSelect>
            <PilotSelect
              chevron
              aria-label="Számlaállapot"
              value={params.get("invoice") ?? ""}
              onChange={(value) => setParam("invoice", value)}
              className="min-w-[180px] [&_select]:h-10"
            >
              <option value="">Minden számlaállapot</option>
              <option value="missing">Nincs számla</option>
              <option value="issued">Kiállítva</option>
            </PilotSelect>
            <PilotSelect
              chevron
              aria-label="Vásárló"
              value={params.get("customerType") ?? ""}
              onChange={(value) => setParam("customerType", value)}
              className="min-w-[180px] [&_select]:h-10"
            >
              <option value="">Regisztrált és vendég</option>
              <option value="registered">Regisztrált</option>
              <option value="guest">Vendég</option>
            </PilotSelect>
            <PilotSelect
              chevron
              aria-label="Új vásárló"
              value={params.get("newCustomer") ?? ""}
              onChange={(value) => setParam("newCustomer", value)}
              className="min-w-[180px] [&_select]:h-10"
            >
              <option value="">Új és visszatérő</option>
              <option value="true">Csak új vásárló</option>
              <option value="false">Csak visszatérő</option>
            </PilotSelect>
          </div>
        ) : null}
      </section>

      {error ? (
        <Alert
          variant="danger"
          title="A rendelések nem töltődtek be"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Újra
            </Button>
          }
        />
      ) : null}
      {loading && !data ? (
        <div aria-label="Rendelések betöltése" className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : null}
      {data?.truncated ? (
        <Alert
          variant="info"
          title="A lista nem teljes"
          description="A webshop több rendelést tart, mint amennyit az OS egy körben beolvas: a legrégebbiek nem látszanak."
        />
      ) : null}
      {data && !error ? (
        data.items.length ? (
          <section className="relative overflow-hidden rounded-2xl border border-pilot-grey-200 bg-white">
            {wide ? (
              <PilotDataTable
                columns={columns}
                rows={data.items}
                rowKey={(item) => item.id}
                rowLabel={(item) =>
                  `${orderNumber(item.displayId)} megnyitása${item.status.stale ? ", elavult" : ""}`
                }
                rowClassName={(item) =>
                  item.status.stale ? "!bg-pilot-amber-50" : ""
                }
                onRowActivate={openOrder}
                minWidth={1080}
              />
            ) : (
              <ul aria-label="Rendelések" className="space-y-3 p-4">
                {data.items.map((item) => (
                  <OrderCard
                    key={item.id}
                    item={item}
                    now={now}
                    onOpen={openOrder}
                  />
                ))}
              </ul>
            )}
            <div className="flex flex-col gap-3 border-t border-pilot-grey-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-pilot-grey-500">
                {data.total.toLocaleString("hu-HU")} rendelés
                {selected.size ? ` · ${selected.size} kijelölve` : ""}
              </p>
              {totalPages > 1 ? (
                <Pagination
                  variant="directionF"
                  position="bottom"
                  page={data.page}
                  totalPages={totalPages}
                  onPageChange={(page) =>
                    replace((next) => next.set("page", String(page)), false)
                  }
                />
              ) : null}
            </div>
          </section>
        ) : hasFilters ? (
          <EmptyState
            title="Nincs találat"
            description="A szűrésnek egyetlen rendelés sem felel meg."
            action={
              <PilotButton
                size="regular"
                variant="secondary"
                onClick={clearFilters}
              >
                Szűrés törlése
              </PilotButton>
            }
          />
        ) : (
          <EmptyState
            title={
              view === "open"
                ? "Nincs nyitott webshop rendelés"
                : "Még nincs webshop rendelés"
            }
            description={
              view === "open"
                ? "Minden rendelés feldolgozva. Az „Összes” nézet a lezártakat is mutatja."
                : "Az új webshop első rendelése itt jelenik meg."
            }
          />
        )
      ) : null}
    </PilotThemeRoot>
  );
}
