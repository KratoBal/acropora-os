"use client";

import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  Icon,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from "@acropora/ui";
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

interface CartLine {
  variantId: string;
  sku: string;
  productName: string;
  unit: string;
  quantity: number;
  unitGross: number;
}

const PAYMENT_METHOD_LABEL: Record<PosPaymentMethod, string> = {
  CASH: "Készpénz",
  CARD: "Kártya",
  TRANSFER: "Utalás",
};

function formatHuf(value: number): string {
  return `${value.toLocaleString("hu-HU", { maximumFractionDigits: 2 })} Ft`;
}

export function PosTerminalPage() {
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
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<PosSaleResult | null>(null);
  const [recentSales, setRecentSales] = useState<PosSaleListItem[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  const loadRecentSales = useCallback(() => {
    if (!token) return;
    setLoadingRecent(true);
    void posApi
      .listSales(token, { page: 1, pageSize: 10 })
      .then((response) => setRecentSales(response.items))
      .catch(() => undefined)
      .finally(() => setLoadingRecent(false));
  }, [token]);

  useEffect(() => {
    if (!canView || !token) return;
    loadRecentSales();
  }, [canView, loadRecentSales, token]);

  useEffect(() => {
    if (!canView || !token) return;
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

  const removeLine = (variantId: string) => {
    setCart((previous) =>
      previous.filter((line) => line.variantId !== variantId),
    );
  };

  const totalGross = useMemo(
    () => cart.reduce((sum, line) => sum + line.unitGross * line.quantity, 0),
    [cart],
  );

  const checkout = () => {
    if (!token || cart.length === 0 || checkingOut) return;
    setCheckingOut(true);
    setError(null);
    void posApi
      .createSale(token, {
        paymentMethod,
        lines: cart.map((line) => ({
          variantId: line.variantId,
          quantity: line.quantity,
          unitGross: line.unitGross,
        })),
      })
      .then((result) => {
        setLastResult(result);
        setCart([]);
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
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a pénztárhoz"
        description="A megnyitáshoz orders.view jogosultság szükséges."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pénztár (POS)"
        description="Bolti eladások rögzítése"
      />

      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}

      {lastResult ? (
        <Alert
          variant={lastResult.failedCount > 0 ? "danger" : "info"}
          title={`Eladás rögzítve: ${lastResult.detail.orderNumber}`}
          description={
            lastResult.stockWarnings.length > 0
              ? `Figyelem, negatívba fordult a nyilvántartott készlet: ${lastResult.stockWarnings
                  .map(
                    (warning) =>
                      `${warning.productName} (${warning.resultingQty})`,
                  )
                  .join(
                    ", ",
                  )}. UNAS szinkron: ${lastResult.successCount} sikeres, ${lastResult.failedCount} sikertelen.`
              : `UNAS szinkron: ${lastResult.successCount} sikeres, ${lastResult.failedCount} sikertelen.`
          }
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          <Card className="p-4">
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              leadingIcon={<Icon name="search" size={17} />}
              placeholder="Keresés cikkszám, terméknév vagy vonalkód alapján…"
              aria-label="Termék keresése"
              autoFocus
            />
          </Card>

          {searching ? (
            <Card className="p-5">
              <Skeleton className="h-4 w-1/2" />
            </Card>
          ) : null}

          {!searching && searchTerm.trim() && searchResults.length === 0 ? (
            <Card className="p-5 text-sm text-slate-500">Nincs találat.</Card>
          ) : null}

          {searchResults.length > 0 ? (
            <Card className="divide-y divide-slate-100 overflow-hidden">
              {searchResults.map((product) => (
                <button
                  key={product.variantId}
                  type="button"
                  onClick={() => addToCart(product)}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-slate-50"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {product.productName}
                    </p>
                    <p className="font-mono text-xs text-slate-500">
                      {product.sku}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-900">
                      {product.grossPrice
                        ? formatHuf(Number(product.grossPrice))
                        : "Nincs ár"}
                    </p>
                    <p className="text-xs text-slate-500">
                      Készlet: {product.currentStock} {product.unit}
                    </p>
                  </div>
                </button>
              ))}
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-900">
                Mai eladások
              </h2>
            </CardHeader>
            <CardContent className="space-y-2">
              {loadingRecent ? <Skeleton className="h-4 w-1/3" /> : null}
              {!loadingRecent && recentSales.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Ma még nem történt eladás.
                </p>
              ) : null}
              {recentSales.map((sale) => (
                <button
                  key={sale.id}
                  type="button"
                  onClick={() => router.push(`/pos/${sale.id}`)}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-left text-sm transition hover:bg-slate-50"
                >
                  <div>
                    <p className="font-medium text-slate-900">
                      {sale.orderNumber}
                    </p>
                    <p className="text-xs text-slate-500">
                      {new Date(sale.createdAt).toLocaleTimeString("hu-HU")} ·{" "}
                      {sale.paymentMethod
                        ? PAYMENT_METHOD_LABEL[sale.paymentMethod]
                        : "—"}{" "}
                      · {sale.lineCount} tétel
                    </p>
                  </div>
                  <p className="font-semibold text-slate-900">
                    {formatHuf(Number(sale.totalGross))}
                  </p>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="lg:sticky lg:top-4 lg:self-start">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-900">Kosár</h2>
              <span className="text-xs text-slate-500">
                {cart.length.toLocaleString("hu-HU")} tétel
              </span>
            </CardHeader>
            <CardContent className="space-y-3">
              {cart.length === 0 ? (
                <p className="text-sm text-slate-500">
                  A kosár üres. Keress rá egy termékre a hozzáadáshoz.
                </p>
              ) : (
                <div className="space-y-3">
                  {cart.map((line) => (
                    <div
                      key={line.variantId}
                      className="rounded-lg border border-slate-100 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {line.productName}
                          </p>
                          <p className="font-mono text-xs text-slate-500">
                            {line.sku}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeLine(line.variantId)}
                          className="shrink-0 text-xs text-rose-600 hover:underline"
                        >
                          Eltávolítás
                        </button>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <label className="text-xs text-slate-500">
                          Mennyiség ({line.unit})
                          <input
                            type="number"
                            min={0.001}
                            step="any"
                            value={line.quantity}
                            onChange={(event) =>
                              updateQuantity(
                                line.variantId,
                                Number(event.target.value),
                              )
                            }
                            className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
                          />
                        </label>
                        <label className="text-xs text-slate-500">
                          Egységár (Ft, bruttó)
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={line.unitGross}
                            onChange={(event) =>
                              updateUnitGross(
                                line.variantId,
                                Number(event.target.value),
                              )
                            }
                            className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
                          />
                        </label>
                      </div>
                      <p className="mt-2 text-right text-sm font-semibold text-slate-900">
                        {formatHuf(line.unitGross * line.quantity)}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <div className="border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Fizetendő</span>
                  <span className="text-lg font-bold text-slate-900">
                    {formatHuf(totalGross)}
                  </span>
                </div>
              </div>

              <div>
                <p className="mb-1 text-xs text-slate-500">Fizetési mód</p>
                <Select
                  value={paymentMethod}
                  onChange={(event) =>
                    setPaymentMethod(event.target.value as PosPaymentMethod)
                  }
                  aria-label="Fizetési mód"
                >
                  <option value="CASH">Készpénz</option>
                  <option value="CARD">Kártya</option>
                  <option value="TRANSFER">Utalás</option>
                </Select>
              </div>

              {canManage ? (
                <Button
                  className="w-full"
                  size="lg"
                  onClick={checkout}
                  disabled={cart.length === 0 || checkingOut}
                >
                  {checkingOut ? "Fizetés folyamatban…" : "Fizetés"}
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
