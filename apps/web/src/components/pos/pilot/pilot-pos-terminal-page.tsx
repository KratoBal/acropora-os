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
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { posApi } from "@/lib/api/pos";
import { createDebouncer } from "@/lib/products/list-state";
import {
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";

/**
 * A FIGMA MAKE TERV ÁTÜLTETÉSE -- PÉNZTÁR (POS), 11. KÖR.
 *
 * Forrás: `exchange/figma-penztar-make-11/src/PosScreen.tsx`
 * (`PosTerminalPage`). A brief (`exchange/figma-penztar-atultetes-brief-
 * 2026-09-25.md`) szerint a régi `../pos-terminal-page.tsx` MŰKÖDÉSE
 * (adat, jogosultság, feliratok, API-hívások) VÁLTOZATLAN -- ez a fájl a
 * teljes állapot- és hívás-logikát SZÓ SZERINT átveszi onnan, csak a
 * megjelenítő réteg (JSX, osztályok) a Figma pilot-tokenjeire vált. A régi
 * fájl ÉRINTETLEN marad (ugyanaz a minta, mint az Akváriumok/Hibajegyek/
 * Eszközök/Munkalapok köröknél: a route erre a pilot verzióra áll át, a
 * régi fájl a helyén marad).
 *
 * === KÜLÖNBSÉGEK A TERVHEZ KÉPEST, KIMONDVA ===
 *
 * 1. A terv demo-adatai (termékkatalógus, mai eladások) KIMARADTAK -- a mai
 *    kód valódi API-hívást ad (`posApi.searchProducts`/`listSales`), nem
 *    talál ki terméket vagy eladást.
 * 2. A terv `Btn` "lg" mérete és `fullWidth`-je a megosztott `PilotButton`-
 *    ba került fel (opcionális `size`/`fullWidth` prop, alapértelmezetten
 *    kikapcsolva) -- ez az ELSŐ hívó, ami ezt kéri, lásd a komponens saját
 *    fejlécét a `packages/ui/src/pilot-ui.tsx`-ben.
 * 3. A `PilotCardHeader` nem ismer `subtitle` propot (csak `title`/
 *    `action`) -- a "Kosár" tételszáma ezért az `action` foglalóban áll,
 *    JOBB oldalon, nem a cím mellett balra, ahogy a terv rajzolja. Kis
 *    eltérés, a meglévő komponens megtartása mellett.
 * 4. A fizetési mód VÁLASZTÓJA a terv szerint épült: három gomb egy
 *    `grid-cols-3` rácsban, kiválasztva teli aqua háttérrel, egyébként
 *    fehér+szegély -- a régi lap dropdownja NEM marad meg ezen az oldalon,
 *    mert a leírás 3. pontja kifejezetten engedi ezt a cserét, ugyanazzal
 *    az értékkészlettel (CASH/CARD/TRANSFER). JAVÍTVA 2026-09-25 (kártya
 *    5bf263a2, Balázs képe): az ELSŐ verzió tévedésből a `PilotSegmentedControl`-t
 *    használta (kis, tömör pill-váltó), holott a terv három NAGY gombot ad
 *    -- ez a fejléc korábban is "három nagy gombot" állított, de a kód
 *    mást csinált. Most a kettő fedi egymást.
 * 5. Blokknyomtatás, vevőválasztó, vonalkód-kamera: NINCS a mai kódban,
 *    NEM épült meg -- a terv egyik képernyőjén sem szerepelnek ezek, ez a
 *    pont csak a brief 4. pontjának megfelelését dokumentálja.
 * 6. A kosár-sor "Egységár (Ft, bruttó)" felirata a terv EGYENLŐ
 *    harmadolású rácsán (és az eredeti 380px kosár-szélességen) két
 *    sorba tört, és emiatt a mezője lejjebb csúszott a másik kettőhöz
 *    képest -- ez MAGÁBAN A TERVBEN is megvan (`exchange/figma-penztar-
 *    make-11/src/PosScreen.tsx`, azonos felirat, azonos harmadolás),
 *    tehát nem az átültetés hibája, hanem a terv rá nem ért figyelni.
 *    JAVÍTVA 2026-09-25: a kosár 380px helyett 440px, és a három mező
 *    aránya `0.85fr 1.3fr 0.85fr` (nem egyenlő harmadok) -- az Egységár
 *    oszlopa kap több helyet, a Mennyiség és a Kedvezmény felirata
 *    változatlanul elfér a szűkebb hányadban is.
 */

interface CartLine {
  variantId: string;
  sku: string;
  productName: string;
  unit: string;
  quantity: number;
  unitGross: number;
  discountPercent: number;
}

const PAYMENT_METHOD_LABEL: Record<PosPaymentMethod, string> = {
  CASH: "Készpénz",
  CARD: "Kártya",
  TRANSFER: "Utalás",
};
const PAYMENT_METHOD_OPTIONS = ["Készpénz", "Kártya", "Utalás"] as const;
const LABEL_TO_PAYMENT_METHOD: Record<string, PosPaymentMethod> = {
  Készpénz: "CASH",
  Kártya: "CARD",
  Utalás: "TRANSFER",
};

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
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  ariaLabel?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-pilot-grey-400">
        {label}
      </span>
      <input
        type="number"
        min={min}
        step="any"
        value={value}
        aria-label={ariaLabel}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full rounded-md px-3 py-2 text-right text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
      />
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

  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<PosProductSearchResult[]>(
    [],
  );
  const [searching, setSearching] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>("CASH");
  const [discountPercent, setDiscountPercent] = useState(0);
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<PosSaleResult | null>(null);
  const [recentSales, setRecentSales] = useState<PosSaleListItem[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  const loadRecentSales = useCallback(() => {
    // Gate on the permission, not on having a client-readable token: in
    // production the session is an httpOnly cookie and `token` is always
    // "" (see ProductionAuthAdapter) - apiRequest already knows to rely on
    // the cookie when no Bearer token is given.
    if (!canView) return;
    setLoadingRecent(true);
    void posApi
      .listSales(token, { page: 1, pageSize: 10, ...localDayRange() })
      .then((response) => setRecentSales(response.items))
      .catch(() => undefined)
      .finally(() => setLoadingRecent(false));
  }, [canView, token]);

  useEffect(() => {
    if (!canView) return;
    loadRecentSales();
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

  const addToCart = (product: PosProductSearchResult) => {
    setCart((previous) => {
      const existing = previous.find(
        (line) => line.variantId === product.variantId,
      );
      if (existing) {
        return previous.map((line) =>
          line.variantId === product.variantId
            ? { ...line, quantity: line.quantity + 1 }
            : line,
        );
      }
      return [
        ...previous,
        {
          variantId: product.variantId,
          sku: product.sku,
          productName: product.productName,
          unit: product.unit,
          quantity: 1,
          unitGross: product.grossPrice ? Number(product.grossPrice) : 0,
          discountPercent: 0,
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

  const checkout = () => {
    // Mirrors the button's own `canManage ? ... : null` rendering guard -
    // reasserted here so this can't silently no-op or (worse) proceed if
    // ever called from anywhere else. Not a token check: apiRequest
    // relies on the session cookie in production, same as everywhere
    // else in this component.
    if (!canManage || cart.length === 0 || checkingOut) return;
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

  if (!canView) {
    return (
      <PilotThemeRoot className="-m-6 flex min-h-screen flex-col bg-pilot-grey-50">
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
    <PilotThemeRoot className="-m-6 flex min-h-screen flex-col bg-pilot-grey-50">
      <div className="border-b border-pilot-grey-200 bg-white px-8 py-5">
        <p className="mb-0.5 text-xs text-pilot-grey-400">Pénztár</p>
        <h1 className="text-xl font-semibold text-pilot-grey-900">
          Bolti eladások rögzítése
        </h1>
      </div>

      {error ? (
        <div className="mx-8 mt-5">
          <Alert variant="danger" title="Hiba történt" description={error} />
        </div>
      ) : null}

      {lastResult ? (
        <div className="mx-8 mt-5">
          {lastResult.stockWarnings.length > 0 ? (
            <div className="rounded-xl bg-pilot-amber-50 px-5 py-4 ring-1 ring-pilot-amber-100">
              <p className="text-sm font-semibold text-pilot-grey-900">
                Eladás rögzítve: {lastResult.detail.orderNumber}
              </p>
              <p className="mt-0.5 text-xs text-pilot-grey-600">
                Figyelem, negatívba fordult a nyilvántartott készlet:{" "}
                {lastResult.stockWarnings
                  .map(
                    (warning) =>
                      `${warning.productName} (${warning.resultingQty})`,
                  )
                  .join(", ")}
                . Ez nem akadályozta meg az eladás rögzítését.
              </p>
            </div>
          ) : (
            <div className="rounded-xl bg-pilot-aqua-50 px-5 py-4 ring-1 ring-pilot-aqua-200">
              <p className="text-sm font-semibold text-pilot-aqua-800">
                Eladás rögzítve: {lastResult.detail.orderNumber}
              </p>
              <p className="mt-0.5 text-xs text-pilot-aqua-600">
                A készlet helyileg lekönyvelve. A UNAS-szinkron a háttérben,
                ettől függetlenül fut.
              </p>
            </div>
          )}
        </div>
      ) : null}

      <div className="grid flex-1 grid-cols-1 items-start gap-6 px-8 py-6 lg:grid-cols-[1fr_440px]">
        {/* Left column */}
        <div className="flex flex-col gap-5">
          <div className="relative">
            <Icon
              name="search"
              size={16}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-pilot-grey-300"
            />
            <input
              type="text"
              autoFocus
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Keresés cikkszám, terméknév vagy vonalkód alapján…"
              aria-label="Termék keresése"
              className="w-full rounded-xl py-3.5 pl-11 pr-4 text-sm text-pilot-grey-900 shadow-sm ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
            />
          </div>

          {searching ? (
            <PilotCard className="p-5">
              <Skeleton className="h-4 w-1/2" />
            </PilotCard>
          ) : null}

          {!searching && searchTerm.trim() && searchResults.length === 0 ? (
            <PilotCard className="p-5 text-sm italic text-pilot-grey-400">
              Nincs találat.
            </PilotCard>
          ) : null}

          {searchResults.length > 0 ? (
            <PilotCard className="divide-y divide-pilot-grey-50 overflow-hidden">
              {searchResults.map((product) => (
                <button
                  key={product.variantId}
                  type="button"
                  onClick={() => addToCart(product)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-pilot-aqua-50/40"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-pilot-grey-900">
                      {product.productName}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-pilot-grey-400">
                      {product.sku}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {product.grossPrice ? (
                      <p className="font-mono text-sm font-semibold text-pilot-grey-900">
                        {formatHuf(Number(product.grossPrice))}
                      </p>
                    ) : (
                      <p className="text-sm italic text-pilot-grey-400">
                        Nincs ár
                      </p>
                    )}
                    <p
                      className={`mt-0.5 font-mono text-xs ${
                        Number(product.currentStock) === 0
                          ? "text-red-400"
                          : "text-pilot-grey-400"
                      }`}
                    >
                      Készlet: {product.currentStock} {product.unit}
                    </p>
                  </div>
                </button>
              ))}
            </PilotCard>
          ) : null}

          <PilotCard>
            <PilotCardHeader title="Mai eladások" />
            {loadingRecent ? (
              <div className="p-5">
                <Skeleton className="h-4 w-1/3" />
              </div>
            ) : recentSales.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm italic text-pilot-grey-400">
                  Ma még nem történt eladás.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-pilot-grey-50">
                {recentSales.map((sale) => (
                  <button
                    key={sale.id}
                    type="button"
                    onClick={() => router.push(`/pos/${sale.id}`)}
                    className="flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left transition-colors hover:bg-pilot-grey-50"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-semibold text-pilot-grey-800">
                        {sale.orderNumber}
                      </p>
                      <p className="mt-0.5 text-xs text-pilot-grey-400">
                        {new Date(sale.createdAt).toLocaleTimeString("hu-HU")} ·{" "}
                        {sale.paymentMethod
                          ? PAYMENT_METHOD_LABEL[sale.paymentMethod]
                          : "—"}{" "}
                        · {sale.lineCount} tétel
                      </p>
                    </div>
                    <p className="shrink-0 font-mono text-sm font-semibold text-pilot-grey-900">
                      {formatHuf(Number(sale.totalGross))}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </PilotCard>
        </div>

        {/* Right column (cart) */}
        <div className="lg:sticky lg:top-6">
          <PilotCard>
            <PilotCardHeader
              title="Kosár"
              action={
                cart.length > 0 ? (
                  <PilotBadge variant="grey">
                    {cart.reduce((sum, line) => sum + line.quantity, 0)} tétel
                  </PilotBadge>
                ) : undefined
              }
            />

            {cart.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pilot-grey-100">
                  <Icon name="cart" size={18} className="text-pilot-grey-400" />
                </div>
                <p className="text-sm text-pilot-grey-400">
                  A kosár üres. Keress rá egy termékre a hozzáadáshoz.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-pilot-grey-50">
                {cart.map((line) => (
                  <div
                    key={line.variantId}
                    className="flex flex-col gap-3 px-5 py-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-snug text-pilot-grey-900">
                          {line.productName}
                        </p>
                        <p className="mt-0.5 font-mono text-xs text-pilot-grey-400">
                          {line.sku}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLine(line.variantId)}
                        className="shrink-0 whitespace-nowrap text-xs font-medium text-red-500 transition hover:text-red-700"
                      >
                        Eltávolítás
                      </button>
                    </div>
                    <div className="grid grid-cols-[0.85fr_1.3fr_0.85fr] gap-2">
                      <NumberInput
                        label={`Mennyiség (${line.unit})`}
                        value={line.quantity}
                        min={0.001}
                        onChange={(value) =>
                          updateQuantity(line.variantId, value)
                        }
                      />
                      <NumberInput
                        label="Egységár (Ft, bruttó)"
                        value={line.unitGross}
                        min={0}
                        onChange={(value) =>
                          updateUnitGross(line.variantId, value)
                        }
                      />
                      <NumberInput
                        label="Kedvezmény (%)"
                        value={line.discountPercent}
                        min={0}
                        ariaLabel={`${line.productName} kedvezmény`}
                        onChange={(value) =>
                          updateLineDiscount(line.variantId, value)
                        }
                      />
                    </div>
                    <p className="text-right font-mono text-sm font-semibold text-pilot-grey-900">
                      {formatHuf(
                        line.unitGross *
                          line.quantity *
                          (1 - line.discountPercent / 100),
                      )}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-4 border-t border-pilot-grey-100 px-5 py-5">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <NumberInput
                    label="Végösszeg kedvezmény (%)"
                    value={discountPercent}
                    min={0}
                    ariaLabel="Végösszeg kedvezmény"
                    onChange={(value) =>
                      setDiscountPercent(clampDiscount(value))
                    }
                  />
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[11px] font-medium text-pilot-grey-400">
                    Fizetendő
                  </p>
                  <p className="mt-0.5 font-mono text-2xl font-bold leading-tight tabular-nums text-pilot-grey-900">
                    {formatHuf(totalGross)}
                  </p>
                </div>
              </div>

              <div>
                <p className="mb-2 text-[11px] font-medium text-pilot-grey-400">
                  Fizetési mód
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {PAYMENT_METHOD_OPTIONS.map((label) => {
                    const selected =
                      LABEL_TO_PAYMENT_METHOD[label] === paymentMethod;
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() =>
                          setPaymentMethod(
                            LABEL_TO_PAYMENT_METHOD[label] ?? "CASH",
                          )
                        }
                        className={`cursor-pointer rounded-lg py-2.5 text-sm font-medium ring-1 transition-all duration-100 ${
                          selected
                            ? "bg-pilot-aqua-600 text-white shadow-sm ring-pilot-aqua-600"
                            : "bg-white text-pilot-grey-600 ring-pilot-grey-200 hover:bg-pilot-grey-50 hover:ring-pilot-grey-300"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {canManage ? (
                <PilotButton
                  variant="primary"
                  size="lg"
                  fullWidth
                  onClick={checkout}
                  disabled={cart.length === 0 || checkingOut}
                >
                  {checkingOut ? "Fizetés folyamatban…" : "Fizetés"}
                </PilotButton>
              ) : null}
            </div>
          </PilotCard>
        </div>
      </div>
    </PilotThemeRoot>
  );
}
