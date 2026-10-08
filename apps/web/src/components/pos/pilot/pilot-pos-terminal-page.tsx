"use client";

import { Alert, Icon, Skeleton } from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type PosPaymentMethod,
  type PosProductSearchResult,
  type PosSaleListItem,
  type PosSaleResult,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  POS_INVOICE_HANDOFF_PARAM,
  posInvoiceHandoffLines,
  writePosInvoiceHandoff,
} from "@/components/billing/pos-invoice-handoff";
import { posApi } from "@/lib/api/pos";
import { createDebouncer } from "@/lib/products/list-state";
import {
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";

import { scrollRowIntoContainer } from "./cart-scroll";

/** POS redesign: canonical Figma 434:41 and 434:419.
 * Sale calculations, permissions, API payload and cart-scroll are retained.
 * Pre-sale stock warnings are estimates only; server stockWarnings remain authoritative.
 */

/** How long an added cart line stays highlighted (and the status line shows). */
export const CART_ADD_HIGHLIGHT_MS = 2000;

interface LastAdded {
  variantId: string;
  productName: string;
  quantity: number;
  unit: string;
}

interface CartLine {
  productId: string;
  variantId: string;
  sku: string;
  productName: string;
  unit: string;
  quantity: number;
  unitGross: number;
  discountPercent: number;
  currentStock: string;
  isPackageProduct: boolean;
  vatRate: string | null;
}

/** Aggregate by variant, matching the server's duplicate-line merge. */
export function getCartStockWarnings(
  lines: ReadonlyArray<{
    variantId: string;
    sku: string;
    quantity: number;
    currentStock: string;
    isPackageProduct: boolean;
    unit: string;
  }>,
) {
  const byVariant = new Map<string, (typeof lines)[number]>();
  for (const line of lines) {
    const previous = byVariant.get(line.variantId);
    byVariant.set(line.variantId, {
      ...line,
      quantity: (previous?.quantity ?? 0) + line.quantity,
    });
  }
  return [...byVariant.values()].filter(
    (line) =>
      line.isPackageProduct === false &&
      Number.isFinite(Number(line.currentStock)) &&
      line.quantity > Number(line.currentStock),
  );
}

const PAYMENT_METHOD_LABEL: Record<PosPaymentMethod, string> = {
  CASH: "Készpénz",
  CARD: "Kártya",
  TRANSFER: "Utalás",
};
/**
 * A "SZÁMLÁZÁS" AZ "UTALÁS" HELYÉN (kártya cdc2771b, Balázs 2026-10-08): nem
 * fizetési mód, hanem átadás az Új számla oldalnak, eladás nélkül. A korábbi
 * átutalásos eladások felirata (`PAYMENT_METHOD_LABEL`) marad.
 */
type CheckoutChoice = PosPaymentMethod | "INVOICE";
const CHECKOUT_OPTIONS: { label: string; value: CheckoutChoice }[] = [
  { label: "Készpénz", value: "CASH" },
  { label: "Kártya", value: "CARD" },
  { label: "Számlázás", value: "INVOICE" },
];

function formatHuf(value: number): string {
  return `${value.toLocaleString("hu-HU", { maximumFractionDigits: 2 })} Ft`;
}

function localDayRange(now = new Date()): {
  createdFrom: string;
  createdTo: string;
} {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { createdFrom: from.toISOString(), createdTo: to.toISOString() };
}

function clampDiscount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * A TERV SAJÁT `NumberInput` MIKRO-KOMPONENSE, PILOT-TOKENEKRE ÁTÜLTETVE.
 * A `PilotInput` `value`/`onChange`-e SZÖVEGET vár, a kosár-mezők viszont
 * SZÁMOT tárolnak -- ugyanaz a döntés, mint a `pilot-aquarium-water-
 * values.tsx` mérési mezőinél: nyers `<input type="number">`, a
 * `PilotInput` osztálykészletével, nem a komponensen keresztül.
 */
function NumberInput({
  label,
  value,
  onChange,
  min,
  ariaLabel,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  ariaLabel?: string;
  suffix?: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs">
      <span className="text-[10px] font-medium text-pilot-grey-500">
        {label}
      </span>
      <div className="relative">
        <input
          type="number"
          min={min}
          step="any"
          value={value}
          aria-label={ariaLabel}
          onChange={(event) => onChange(Number(event.target.value))}
          className={`h-[38px] w-full min-w-0 rounded-lg bg-white px-3 py-2 text-right text-xs text-pilot-grey-900 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500 ${
            suffix ? "pr-7" : ""
          }`}
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-pilot-grey-300">
            {suffix}
          </span>
        ) : null}
      </div>
    </label>
  );
}

export function PilotPosTerminalPage() {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.ORDERS_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.ORDERS_MANAGE),
  );
  // a számla vázlatát ugyanez a jog hozza létre (`billing.create`)
  const canInvoice = Boolean(
    session && hasPermission(session.user, PERMISSIONS.BILLING_CREATE),
  );
  const checkoutOptions = CHECKOUT_OPTIONS.filter(
    (option) => option.value !== "INVOICE" || canInvoice,
  );

  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<PosProductSearchResult[]>(
    [],
  );
  const [searching, setSearching] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<CheckoutChoice>("CASH");
  const [discountPercent, setDiscountPercent] = useState(0);
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<PosSaleResult | null>(null);
  const [recentSales, setRecentSales] = useState<PosSaleListItem[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [lastAdded, setLastAdded] = useState<LastAdded | null>(null);
  const cartListRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const loadRecentSales = useCallback(() => {
    // Gate on the permission, not on having a client-readable token: in
    // production the session is an httpOnly cookie and `token` is always
    // "" (see ProductionAuthAdapter) - apiRequest already knows to rely on
    // the cookie when no Bearer token is given.
    if (!canView) return;
    setLoadingRecent(true);
    const dayRange = localDayRange();
    void posApi
      .listSales(token, { page: 1, pageSize: 10, ...dayRange })
      .then((response) => {
        // A response from yesterday must not repopulate the list after midnight.
        if (dayRange.createdFrom === localDayRange().createdFrom) {
          setRecentSales(response.items);
        }
      })
      .catch(() => undefined)
      .finally(() => setLoadingRecent(false));
  }, [canView, token]);

  useEffect(() => {
    if (!canView) return;
    loadRecentSales();
    let currentDay = localDayRange().createdFrom;
    let timer: ReturnType<typeof setTimeout>;
    const refreshDay = () => {
      const day = localDayRange().createdFrom;
      if (day !== currentDay) {
        currentDay = day;
        setRecentSales([]);
        loadRecentSales();
      }
    };
    const scheduleMidnight = () => {
      timer = setTimeout(
        () => {
          refreshDay();
          scheduleMidnight();
        },
        Math.max(1, new Date(localDayRange().createdTo).getTime() - Date.now()),
      );
    };
    scheduleMidnight();
    // Catch a date change while the browser's background timers were suspended.
    document.addEventListener("visibilitychange", refreshDay);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshDay);
    };
  }, [canView, loadRecentSales]);

  useEffect(() => {
    if (!canView) return;
    if (!searchTerm.trim()) {
      setSearchResults([]);
      return;
    }
    const debouncer = createDebouncer((value: string) => {
      setSearching(true);
      void posApi
        .searchProducts(token, value)
        .then(setSearchResults)
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 300);
    debouncer.schedule(searchTerm);
    return () => debouncer.cancel();
  }, [canView, searchTerm, token]);

  useEffect(() => {
    if (!lastAdded) return;
    const list = cartListRef.current;
    const row = list
      ? Array.from(list.children).find(
          (child): child is HTMLElement =>
            child instanceof HTMLElement &&
            child.dataset.variantId === lastAdded.variantId,
        )
      : undefined;
    if (list && row) scrollRowIntoContainer(list, row);
    const timer = setTimeout(() => setLastAdded(null), CART_ADD_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [lastAdded]);

  const addToCart = (product: PosProductSearchResult) => {
    const existingLine = cart.find(
      (line) => line.variantId === product.variantId,
    );
    // A fresh object on every add - also for the same line - re-runs the
    // highlight effect, so a repeat click restarts the 2 s highlight.
    setLastAdded({
      variantId: product.variantId,
      productName: product.productName,
      quantity: (existingLine?.quantity ?? 0) + 1,
      unit: product.unit,
    });
    searchInputRef.current?.focus();
    setCart((previous) => {
      const existing = previous.find(
        (line) => line.variantId === product.variantId,
      );
      if (existing) {
        return previous.map((line) =>
          line.variantId === product.variantId
            ? {
                ...line,
                quantity: line.quantity + 1,
                currentStock: product.currentStock,
                isPackageProduct: product.isPackageProduct,
                vatRate: product.vatRate,
              }
            : line,
        );
      }
      return [
        ...previous,
        {
          productId: product.productId,
          variantId: product.variantId,
          sku: product.sku,
          productName: product.productName,
          unit: product.unit,
          quantity: 1,
          unitGross: product.grossPrice ? Number(product.grossPrice) : 0,
          discountPercent: 0,
          currentStock: product.currentStock,
          isPackageProduct: product.isPackageProduct,
          vatRate: product.vatRate,
        },
      ];
    });
  };

  const updateQuantity = (variantId: string, quantity: number) => {
    setCart((previous) =>
      previous.map((line) =>
        line.variantId === variantId ? { ...line, quantity } : line,
      ),
    );
  };

  const updateUnitGross = (variantId: string, unitGross: number) => {
    setCart((previous) =>
      previous.map((line) =>
        line.variantId === variantId ? { ...line, unitGross } : line,
      ),
    );
  };

  const updateLineDiscount = (variantId: string, value: number) => {
    setCart((previous) =>
      previous.map((line) =>
        line.variantId === variantId
          ? { ...line, discountPercent: clampDiscount(value) }
          : line,
      ),
    );
  };

  const removeLine = (variantId: string) => {
    setCart((previous) =>
      previous.filter((line) => line.variantId !== variantId),
    );
  };

  const subtotalGross = useMemo(
    () =>
      cart.reduce(
        (sum, line) =>
          sum +
          line.unitGross * line.quantity * (1 - line.discountPercent / 100),
        0,
      ),
    [cart],
  );
  const totalGross = subtotalGross * (1 - discountPercent / 100);

  const stockWarnings = useMemo(() => getCartStockWarnings(cart), [cart]);
  const missingVat = cart.filter((line) => line.vatRate === null);

  const checkout = () => {
    // Mirrors the button's own `canManage ? ... : null` rendering guard -
    // reasserted here so this can't silently no-op or (worse) proceed if
    // ever called from anywhere else. Not a token check: apiRequest
    // relies on the session cookie in production, same as everywhere
    // else in this component.
    if (!canManage || cart.length === 0 || checkingOut || missingVat.length > 0)
      return;
    if (paymentMethod === "INVOICE") return;
    setCheckingOut(true);
    setError(null);
    void posApi
      .createSale(token, {
        paymentMethod,
        discountPercent,
        lines: cart.map((line) => ({
          variantId: line.variantId,
          quantity: line.quantity,
          unitGross: line.unitGross,
          discountPercent: line.discountPercent,
        })),
      })
      .then((result) => {
        setLastResult(result);
        setLastAdded(null);
        setCart([]);
        setDiscountPercent(0);
        setSearchTerm("");
        setSearchResults([]);
        loadRecentSales();
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Az eladás rögzítése nem sikerült.",
        ),
      )
      .finally(() => setCheckingOut(false));
  };

  const sendToInvoice = () => {
    if (!canInvoice || cart.length === 0 || missingVat.length > 0) return;
    const key = writePosInvoiceHandoff(
      window.sessionStorage,
      posInvoiceHandoffLines(cart, discountPercent),
    );
    router.push(
      `/penzugy/szamlazas/uj?${POS_INVOICE_HANDOFF_PARAM}=${encodeURIComponent(key)}`,
    );
  };
  const invoicing = paymentMethod === "INVOICE";

  if (!canView) {
    return (
      <PilotThemeRoot className="-m-6 flex min-h-screen flex-col bg-pilot-grey-50 lg:-m-8 [&_h1]:![font-family:inherit] [&_h2]:![font-family:inherit] [&_h3]:![font-family:inherit]">
        <div className="p-8">
          <Alert
            variant="danger"
            title="Nincs hozzáférésed a pénztárhoz"
            description="A megnyitáshoz orders.view jogosultság szükséges."
          />
        </div>
      </PilotThemeRoot>
    );
  }

  return (
    <PilotThemeRoot className="-m-6 flex min-h-screen flex-col bg-pilot-grey-50 lg:-m-8 [&_h1]:![font-family:inherit] [&_h2]:![font-family:inherit] [&_h3]:![font-family:inherit]">
      <div className="px-8 pb-5 pt-6">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-pilot-aqua-700">
          Pénztár
        </p>
        <h1 className="text-[28px] font-semibold leading-tight text-pilot-grey-900">
          Bolti eladás
        </h1>
        <p className="mt-1.5 text-xs text-pilot-grey-600">
          Keresés, kosár és fizetés egy képernyőn. A készlet az Acropora OS-ből
          jön.
        </p>
      </div>

      {lastResult ? (
        <div className="mx-8 mb-5">
          <Alert
            variant="info"
            className={
              lastResult.stockWarnings.length > 0
                ? "!border-pilot-amber-100 !bg-pilot-amber-50 !text-pilot-amber-700"
                : "!border-pilot-aqua-200 !bg-pilot-aqua-50 !text-pilot-aqua-700"
            }
            title={`Eladás rögzítve: ${lastResult.detail.orderNumber}`}
            description={
              lastResult.stockWarnings.length > 0
                ? `Figyelem, negatívba fordult a nyilvántartott készlet: ${lastResult.stockWarnings.map((warning) => `${warning.productName} (${warning.resultingQty})`).join(", ")}. Ez nem akadályozta meg az eladás rögzítését.`
                : "A készlet helyileg lekönyvelve. A UNAS-szinkron a háttérben, ettől függetlenül fut."
            }
            action={
              <button
                type="button"
                onClick={() => setLastResult(null)}
                aria-label="Bezárás"
              >
                <Icon name="x" size={14} />
              </button>
            }
          />
        </div>
      ) : null}

      <div className="grid flex-1 grid-cols-1 items-start gap-6 px-8 pb-8 lg:grid-cols-[minmax(0,1fr)_424px]">
        <div className="flex min-w-0 flex-col gap-5">
          <PilotCard className="px-5 py-6">
            <h2 className="mb-3 text-sm font-semibold text-pilot-grey-900">
              Termék keresése
            </h2>
            <div className="relative">
              <Icon
                name="search"
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-pilot-grey-500"
              />
              <input
                ref={searchInputRef}
                type="text"
                autoFocus
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Cikkszám, terméknév vagy vonalkód…"
                aria-label="Termék keresése"
                className="h-[50px] w-full min-w-0 rounded-lg bg-white pl-10 pr-3 text-xs text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-500 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
              />
            </div>
            {/* Reserve feedback space so result buttons never move on add. */}
            <p
              role="status"
              aria-live="polite"
              className="mt-3 flex h-[50px] items-center rounded-lg bg-pilot-aqua-50 px-3 text-[11px] text-pilot-aqua-700"
            >
              <span className="truncate" title={lastAdded?.productName}>
                {lastAdded
                  ? `Hozzáadva: ${lastAdded.productName}. A kosárban: ${lastAdded.quantity} ${lastAdded.unit}`
                  : ""}
              </span>
            </p>
          </PilotCard>

          <PilotCard className="overflow-hidden">
            <PilotCardHeader
              title="Találatok"
              action={
                <PilotBadge variant="grey">
                  {searchResults.length} találat
                </PilotBadge>
              }
            />
            {searching ? (
              <div className="p-5" aria-label="Keresés folyamatban">
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : searchResults.length === 0 ? (
              <p className="px-5 py-8 text-xs text-pilot-grey-500">
                {searchTerm.trim()
                  ? "Nincs találat."
                  : "Keress cikkszám, terméknév vagy vonalkód alapján."}
              </p>
            ) : (
              searchResults.map((product) => (
                <button
                  key={product.variantId}
                  type="button"
                  onClick={() => addToCart(product)}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto_18px] items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-pilot-aqua-50"
                >
                  <span className="min-w-0">
                    <span className="block break-words text-[13px] font-semibold text-pilot-grey-900">
                      {product.productName}
                    </span>
                    <span className="mt-1 block break-all text-[10px] text-pilot-grey-500">
                      {product.sku}
                    </span>
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-right">
                    <span className="block text-[13px] font-semibold tabular-nums text-pilot-grey-900">
                      {product.grossPrice
                        ? formatHuf(Number(product.grossPrice))
                        : "Nincs ár"}
                    </span>
                    <span
                      className={`mt-1 block text-[10px] tabular-nums ${Number(product.currentStock) <= 0 ? "text-pilot-amber-700" : "text-pilot-grey-600"}`}
                    >
                      Készlet: {product.currentStock} {product.unit}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="text-center text-lg font-semibold text-pilot-aqua-700"
                  >
                    +
                  </span>
                </button>
              ))
            )}
          </PilotCard>

          <PilotCard>
            <PilotCardHeader
              title="Mai eladások"
              action={
                <span className="text-[10px] text-pilot-grey-500">
                  Csak a mai nap · legfeljebb 10
                </span>
              }
            />
            {loadingRecent ? (
              <div className="p-5">
                <Skeleton className="h-4 w-1/3" />
              </div>
            ) : recentSales.length === 0 ? (
              <p className="px-5 py-8 text-center text-xs text-pilot-grey-500">
                Ma még nem történt eladás.
              </p>
            ) : (
              <div className="px-4">
                {recentSales.map((sale) => (
                  <button
                    key={sale.id}
                    type="button"
                    onClick={() => router.push(`/pos/${sale.id}`)}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto_12px] items-center gap-3 border-b border-pilot-grey-100 py-4 text-left last:border-0 hover:bg-pilot-grey-50"
                  >
                    <span className="min-w-0">
                      <span className="block break-all text-xs font-semibold text-pilot-grey-900">
                        {sale.orderNumber}
                      </span>
                      <span className="mt-1 block text-[10px] text-pilot-grey-500">
                        {new Date(sale.createdAt).toLocaleTimeString("hu-HU", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        ·{" "}
                        {sale.paymentMethod
                          ? PAYMENT_METHOD_LABEL[sale.paymentMethod]
                          : "—"}{" "}
                        · {sale.lineCount} tétel
                      </span>
                    </span>
                    <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-pilot-grey-900">
                      {formatHuf(Number(sale.totalGross))}
                    </span>
                    <span aria-hidden="true" className="text-pilot-grey-600">
                      ›
                    </span>
                  </button>
                ))}
              </div>
            )}
          </PilotCard>
        </div>

        <div className="min-w-0 lg:sticky lg:top-16">
          <PilotCard className="flex flex-col overflow-hidden lg:h-[min(830px,calc(100dvh-12.5rem))]">
            <div className="flex shrink-0 items-center justify-between px-4 py-3">
              <h2 className="text-sm font-semibold text-pilot-grey-900">
                Kosár
              </h2>
              <PilotBadge variant="grey">{cart.length} tétel</PilotBadge>
            </div>
            <div
              ref={cartListRef}
              data-testid="pos-cart-lines"
              className="space-y-2 px-2 pb-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain"
            >
              {cart.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
                  <Icon name="cart" size={24} className="text-pilot-grey-500" />
                  <p className="text-xs text-pilot-grey-500">
                    A kosár üres. Keress rá egy termékre a hozzáadáshoz.
                  </p>
                </div>
              ) : (
                cart.map((line) => {
                  const justAdded = lastAdded?.variantId === line.variantId;
                  return (
                    <div
                      key={line.variantId}
                      data-variant-id={line.variantId}
                      data-just-added={justAdded ? "true" : undefined}
                      className={`rounded-[10px] border border-pilot-grey-200 p-3 transition-colors duration-500 ${justAdded ? "bg-pilot-aqua-50" : "bg-white"}`}
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="break-words text-[13px] font-semibold leading-4 text-pilot-grey-900">
                            {line.productName}
                          </p>
                          <p className="mt-0.5 break-all text-[10px] leading-[14px] text-pilot-grey-500">
                            {line.sku}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeLine(line.variantId)}
                          aria-label={`${line.productName} eltávolítása`}
                          className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-pilot-grey-600 hover:bg-pilot-grey-100"
                        >
                          <Icon name="x" size={14} />
                        </button>
                      </div>
                      <div className="grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.3fr)_minmax(0,0.85fr)] gap-2">
                        <NumberInput
                          label="Mennyiség"
                          ariaLabel={`Mennyiség (${line.unit})`}
                          suffix={line.unit}
                          value={line.quantity}
                          min={0.001}
                          onChange={(value) =>
                            updateQuantity(line.variantId, value)
                          }
                        />
                        <NumberInput
                          label="Egységár"
                          ariaLabel="Egységár (Ft, bruttó)"
                          suffix="Ft"
                          value={line.unitGross}
                          min={0}
                          onChange={(value) =>
                            updateUnitGross(line.variantId, value)
                          }
                        />
                        <NumberInput
                          label="Kedvezmény"
                          suffix="%"
                          ariaLabel={`${line.productName} kedvezmény`}
                          value={line.discountPercent}
                          min={0}
                          onChange={(value) =>
                            updateLineDiscount(line.variantId, value)
                          }
                        />
                      </div>
                      <p className="mt-1 text-right text-xs font-semibold leading-4 tabular-nums text-pilot-grey-900">
                        {formatHuf(
                          line.unitGross *
                            line.quantity *
                            (1 - line.discountPercent / 100),
                        )}
                      </p>
                    </div>
                  );
                })
              )}
            </div>

            <div
              data-testid="pos-cart-footer"
              className="flex shrink-0 flex-col gap-3 border-t border-pilot-grey-200 bg-white p-4"
            >
              <div className="grid grid-cols-[160px_minmax(0,1fr)] items-center gap-3">
                <NumberInput
                  label="Végösszeg kedvezmény"
                  ariaLabel="Végösszeg kedvezmény"
                  suffix="%"
                  value={discountPercent}
                  min={0}
                  onChange={(value) => setDiscountPercent(clampDiscount(value))}
                />
                <div className="flex items-center justify-end gap-2 text-[11px]">
                  <span className="text-pilot-grey-600">Részösszeg</span>
                  <span className="whitespace-nowrap font-medium tabular-nums text-pilot-grey-900">
                    {formatHuf(subtotalGross)}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-pilot-grey-600">Fizetendő</span>
                <p className="text-[26px] font-semibold leading-tight tabular-nums text-pilot-grey-900">
                  {formatHuf(totalGross)}
                </p>
              </div>
              <div>
                <p className="mb-2 text-[11px] text-pilot-grey-600">
                  Fizetési mód
                </p>
                <div
                  className={`grid ${checkoutOptions.length === 3 ? "grid-cols-3" : "grid-cols-2"} gap-2 text-[11px] font-semibold`}
                >
                  {checkoutOptions.map(({ label, value }) => {
                    const selected = value === paymentMethod;
                    return (
                      <button
                        key={label}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setPaymentMethod(value)}
                        className={`h-12 cursor-pointer rounded-lg py-2.5 text-[11px] font-semibold ring-1 transition-colors ${selected ? "bg-pilot-aqua-600 text-white ring-pilot-aqua-600" : "bg-white text-pilot-grey-900 ring-pilot-grey-200 hover:bg-pilot-grey-50"}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {stockWarnings.length > 0 ? (
                <div data-testid="pos-stock-warning">
                  <Alert
                    variant="info"
                    role="alert"
                    className="!border-pilot-amber-100 !bg-pilot-amber-50 !text-pilot-amber-700 !px-3 !py-2 [&_p]:!text-[10px]"
                    title="A mennyiség meghaladja a készletet"
                    description={`${stockWarnings[0]!.sku}: kosár ${stockWarnings[0]!.quantity} ${stockWarnings[0]!.unit}, készlet ${stockWarnings[0]!.currentStock} ${stockWarnings[0]!.unit}${stockWarnings.length > 1 ? `; további ${stockWarnings.length - 1} termék` : ""}. Eladás engedélyezett; keresési készlet alapján becslés.`}
                  />
                </div>
              ) : (
                <p className="rounded-lg bg-pilot-grey-100 px-3 py-4 text-[10px] text-pilot-grey-600">
                  Negatív készlet engedélyezett, figyelmeztetéssel.
                </p>
              )}
              {missingVat.length > 0 ? (
                <Alert
                  variant="danger"
                  className="!px-3 !py-2 [&_p]:!text-[10px]"
                  title="Hiányzó ÁFA kulcs"
                  description={`Nincs beállítva ÁFA kulcs ehhez a termékhez: ${missingVat[0]!.sku}${missingVat.length > 1 ? ` (+${missingVat.length - 1} termék)` : ""}.`}
                />
              ) : null}
              {error ? (
                <Alert
                  variant="danger"
                  className="!px-3 !py-2 [&_p]:!text-[10px]"
                  title="Hiba történt"
                  description={error}
                  action={
                    <button
                      type="button"
                      onClick={() => setError(null)}
                      aria-label="Bezárás"
                    >
                      <Icon name="x" size={14} />
                    </button>
                  }
                />
              ) : null}
              {invoicing && canInvoice ? (
                <div className="text-xs font-semibold [&_button]:!h-[42px] [&_button]:!rounded-lg">
                  <PilotButton
                    variant="primary"
                    size="regular"
                    fullWidth
                    onClick={sendToInvoice}
                    disabled={cart.length === 0 || missingVat.length > 0}
                  >
                    {`Tovább a számlához · ${formatHuf(totalGross)}`}
                  </PilotButton>
                </div>
              ) : !invoicing && canManage ? (
                <div className="text-xs font-semibold [&_button]:!h-[42px] [&_button]:!rounded-lg">
                  <PilotButton
                    variant="primary"
                    size="regular"
                    fullWidth
                    onClick={checkout}
                    disabled={
                      cart.length === 0 || checkingOut || missingVat.length > 0
                    }
                  >
                    {checkingOut
                      ? "Fizetés folyamatban…"
                      : `Fizetés · ${formatHuf(totalGross)}`}
                  </PilotButton>
                </div>
              ) : null}
            </div>
          </PilotCard>
        </div>
      </div>
    </PilotThemeRoot>
  );
}
