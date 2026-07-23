"use client";

import {
  Alert,
  Button,
  Card,
  FormField,
  Icon,
  Input,
  PageHeader,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type PurchaseInvoiceResult,
  type PurchaseProductSearchResult,
  type SupplierSummary,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { purchasingApi } from "@/lib/api/purchasing";
import { suppliersApi } from "@/lib/api/suppliers";
import { createDebouncer } from "@/lib/products/list-state";

interface InvoiceLineState {
  key: string;
  variantId: string;
  sku: string;
  productName: string;
  unit: string;
  sourceDescription: string;
  orderedQuantity: number;
  actualQuantity: number;
  unitNet: number;
  discountPercent: number | "";
}

function lineNet(line: InvoiceLineState): number {
  const gross = line.actualQuantity * line.unitNet;
  const discount = line.discountPercent
    ? gross * (Number(line.discountPercent) / 100)
    : 0;
  return gross - discount;
}

function formatMoney(value: number, currency: string): string {
  return `${value.toLocaleString("hu-HU", { maximumFractionDigits: 2 })} ${currency}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PurchaseInvoiceEuEditorPage() {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PURCHASING_MANAGE),
  );

  const [supplierSearch, setSupplierSearch] = useState("");
  const [supplierResults, setSupplierResults] = useState<SupplierSummary[]>([]);
  const [selectedSupplier, setSelectedSupplier] =
    useState<SupplierSummary | null>(null);
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierTaxNumber, setNewSupplierTaxNumber] = useState("");
  const [newSupplierCountry, setNewSupplierCountry] = useState("DE");
  const [newSupplierEmail, setNewSupplierEmail] = useState("");
  const [newSupplierPhone, setNewSupplierPhone] = useState("");
  const [creatingSupplier, setCreatingSupplier] = useState(false);

  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [exchangeRate, setExchangeRate] = useState<number | "">("");
  const [rateLoading, setRateLoading] = useState(false);
  const [rateNotice, setRateNotice] = useState<string | null>(null);
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState("");
  const [isPaid, setIsPaid] = useState(false);
  const [paidAt, setPaidAt] = useState("");
  const [note, setNote] = useState("");

  const [productSearch, setProductSearch] = useState("");
  const [productResults, setProductResults] = useState<
    PurchaseProductSearchResult[]
  >([]);
  const [searchingProducts, setSearchingProducts] = useState(false);
  const [lines, setLines] = useState<InvoiceLineState[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<PurchaseInvoiceResult | null>(
    null,
  );

  useEffect(() => {
    if (!token || !supplierSearch.trim()) {
      setSupplierResults([]);
      return;
    }
    const debouncer = createDebouncer((value: string) => {
      void suppliersApi
        .search(token, value)
        .then((response) => setSupplierResults(response.items))
        .catch(() => setSupplierResults([]));
    }, 300);
    debouncer.schedule(supplierSearch);
    return () => debouncer.cancel();
  }, [supplierSearch, token]);

  useEffect(() => {
    if (!token || !productSearch.trim()) {
      setProductResults([]);
      return;
    }
    const debouncer = createDebouncer((value: string) => {
      setSearchingProducts(true);
      void purchasingApi
        .searchProducts(token, value)
        .then(setProductResults)
        .catch(() => setProductResults([]))
        .finally(() => setSearchingProducts(false));
    }, 300);
    debouncer.schedule(productSearch);
    return () => debouncer.cancel();
  }, [productSearch, token]);

  useEffect(() => {
    if (!token || !invoiceDate) return;
    if (currency.trim().toUpperCase() === "HUF") {
      setExchangeRate("");
      setRateNotice(null);
      return;
    }
    setRateLoading(true);
    setRateNotice(null);
    void purchasingApi
      .getExchangeRate(token, currency.trim().toUpperCase(), invoiceDate)
      .then((result) => {
        setExchangeRate(Number(result.rate));
        setRateNotice(
          result.quotedDate === invoiceDate
            ? `MNB hivatalos árfolyam: ${result.rate}`
            : `MNB hivatalos árfolyam: ${result.rate} (utolsó jegyzés: ${new Date(result.quotedDate).toLocaleDateString("hu-HU")})`,
        );
      })
      .catch((cause: unknown) =>
        setRateNotice(
          cause instanceof Error
            ? cause.message
            : "Az MNB árfolyam nem tölthető be, add meg kézzel.",
        ),
      )
      .finally(() => setRateLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, invoiceDate, token]);

  const addLine = (product: PurchaseProductSearchResult) => {
    setLines((previous) => [
      ...previous,
      {
        key: `${product.variantId}-${previous.length}-${Date.now()}`,
        variantId: product.variantId,
        sku: product.sku,
        productName: product.productName,
        unit: product.unit,
        sourceDescription: "",
        orderedQuantity: 1,
        actualQuantity: 1,
        unitNet: product.lastPurchaseNetPrice
          ? Number(product.lastPurchaseNetPrice)
          : 0,
        discountPercent: "",
      },
    ]);
    setProductSearch("");
    setProductResults([]);
  };

  const updateLine = (key: string, patch: Partial<InvoiceLineState>) => {
    setLines((previous) =>
      previous.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  };

  const updateOrderedQuantity = (key: string, value: number) => {
    // A rendelt mennyiség beírásakor automatikusan a tényleges (átvett)
    // mennyiséghez is bemásoljuk - eltérés esetén ezt utána külön
    // módosíthatod a Tényleges mezőben.
    updateLine(key, { orderedQuantity: value, actualQuantity: value });
  };

  const removeLine = (key: string) =>
    setLines((previous) => previous.filter((line) => line.key !== key));

  const totalNet = lines.reduce((sum, line) => sum + lineNet(line), 0);

  const createSupplier = async () => {
    if (!newSupplierName.trim() || creatingSupplier) return;
    setCreatingSupplier(true);
    setError(null);
    try {
      const created = await suppliersApi.create(token, {
        name: newSupplierName.trim(),
        taxNumber: newSupplierTaxNumber.trim() || undefined,
        country: newSupplierCountry.trim() || undefined,
        email: newSupplierEmail.trim() || undefined,
        phone: newSupplierPhone.trim() || undefined,
      });
      setSelectedSupplier(created);
      setShowNewSupplier(false);
      setNewSupplierName("");
      setNewSupplierTaxNumber("");
      setNewSupplierEmail("");
      setNewSupplierPhone("");
      setSupplierSearch("");
      setSupplierResults([]);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A beszállító létrehozása nem sikerült.",
      );
    } finally {
      setCreatingSupplier(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!selectedSupplier) {
      setError("Válassz ki egy beszállítót, vagy hozz létre újat.");
      return;
    }
    if (!supplierInvoiceNumber.trim()) {
      setError("A számlaszám megadása kötelező.");
      return;
    }
    if (!currency.trim()) {
      setError("A pénznem megadása kötelező.");
      return;
    }
    if (lines.length === 0) {
      setError("Legalább egy tétel szükséges a számlához.");
      return;
    }
    setSubmitting(true);
    setLastResult(null);
    try {
      const result = await purchasingApi.create(token, {
        source: "EU",
        supplierId: selectedSupplier.id,
        supplierInvoiceNumber: supplierInvoiceNumber.trim(),
        currency: currency.trim().toUpperCase(),
        exchangeRate: exchangeRate === "" ? undefined : Number(exchangeRate),
        invoiceDate: new Date(invoiceDate).toISOString(),
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        isPaid,
        paidAt: isPaid && paidAt ? new Date(paidAt).toISOString() : undefined,
        note: note.trim() || undefined,
        lines: lines.map((line) => ({
          variantId: line.variantId,
          sourceDescription: line.sourceDescription.trim() || undefined,
          orderedQuantity: line.orderedQuantity,
          actualQuantity: line.actualQuantity,
          unit: line.unit,
          unitNet: line.unitNet,
          discountPercent:
            line.discountPercent === ""
              ? undefined
              : Number(line.discountPercent),
        })),
      });
      // Nem navigálunk el azonnal: a UNAS szinkron soronkénti sikeres/
      // sikertelen eredményét itt is meg kell mutatni, különben egy
      // csendben elhasaló push észrevétlen maradna.
      setLastResult(result);
      setLines([]);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A számla rögzítése nem sikerült.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!canManage) {
    return (
      <Alert
        variant="danger"
        title="Nincs jogosultságod számla rögzítéséhez"
        description="purchasing.manage jogosultság szükséges."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Új EU-s beszerzési számla"
        description="Beérkezett EU-n belüli beszállítói számla rögzítése, tételes bevételezéssel."
        actions={
          <Button variant="secondary" onClick={() => router.push("/beszerzes")}>
            Vissza a listához
          </Button>
        }
      />

      {error ? (
        <Alert
          variant="danger"
          title="A művelet nem sikerült"
          description={error}
        />
      ) : null}

      {lastResult ? (
        <Alert
          variant={lastResult.failedCount > 0 ? "danger" : "info"}
          title={`Számla rögzítve: ${lastResult.detail.documentNumber}`}
          description={
            lastResult.failedCount > 0
              ? `A készlet helyileg frissült, de a UNAS-szinkron ${lastResult.failedCount} tételnél sikertelen volt (${lastResult.successCount} sikeres). Nyisd meg a számlát a részletekért.`
              : `Készlet és UNAS-szinkron frissítve (${lastResult.successCount} tétel).`
          }
          action={
            <Button
              variant="secondary"
              onClick={() => router.push(`/beszerzes/${lastResult.detail.id}`)}
            >
              Számla megnyitása
            </Button>
          }
        />
      ) : null}

      <form className="space-y-6" onSubmit={submit}>
        <Card className="p-6">
          <h2 className="font-semibold">Beszállító</h2>
          {selectedSupplier ? (
            <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-200 p-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {selectedSupplier.name}
                </p>
                <p className="text-xs text-slate-500">
                  {selectedSupplier.code}
                  {selectedSupplier.taxNumber
                    ? ` · ${selectedSupplier.taxNumber}`
                    : ""}{" "}
                  · {selectedSupplier.country}
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setSelectedSupplier(null)}
              >
                Módosítás
              </Button>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <Input
                aria-label="Beszállító keresése"
                value={supplierSearch}
                onChange={(event) => setSupplierSearch(event.target.value)}
                placeholder="Beszállító neve, adószáma…"
                leadingIcon={<Icon name="search" size={17} />}
              />
              {supplierResults.length > 0 ? (
                <Card className="divide-y divide-slate-100 overflow-hidden">
                  {supplierResults.map((supplier) => (
                    <button
                      key={supplier.id}
                      type="button"
                      onClick={() => {
                        setSelectedSupplier(supplier);
                        setSupplierResults([]);
                      }}
                      className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-slate-50"
                    >
                      <span className="font-medium text-slate-900">
                        {supplier.name}
                      </span>
                      <span className="text-xs text-slate-500">
                        {supplier.country}
                      </span>
                    </button>
                  ))}
                </Card>
              ) : null}
              {!showNewSupplier ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowNewSupplier(true)}
                >
                  Új beszállító létrehozása
                </Button>
              ) : (
                <div className="space-y-3 rounded-lg border border-slate-200 p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField label="Név">
                      <Input
                        aria-label="Beszállító neve"
                        value={newSupplierName}
                        onChange={(event) =>
                          setNewSupplierName(event.target.value)
                        }
                      />
                    </FormField>
                    <FormField label="Közösségi adószám">
                      <Input
                        aria-label="Adószám"
                        value={newSupplierTaxNumber}
                        onChange={(event) =>
                          setNewSupplierTaxNumber(event.target.value)
                        }
                        placeholder="DE123456789"
                      />
                    </FormField>
                    <FormField label="Ország (ISO kód)">
                      <Input
                        aria-label="Ország"
                        value={newSupplierCountry}
                        maxLength={2}
                        onChange={(event) =>
                          setNewSupplierCountry(
                            event.target.value.toUpperCase(),
                          )
                        }
                        placeholder="DE"
                      />
                    </FormField>
                    <FormField label="E-mail">
                      <Input
                        aria-label="E-mail"
                        value={newSupplierEmail}
                        onChange={(event) =>
                          setNewSupplierEmail(event.target.value)
                        }
                      />
                    </FormField>
                    <FormField label="Telefon">
                      <Input
                        aria-label="Telefon"
                        value={newSupplierPhone}
                        onChange={(event) =>
                          setNewSupplierPhone(event.target.value)
                        }
                      />
                    </FormField>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setShowNewSupplier(false)}
                    >
                      Mégse
                    </Button>
                    <Button
                      type="button"
                      disabled={!newSupplierName.trim() || creatingSupplier}
                      onClick={() => void createSupplier()}
                    >
                      {creatingSupplier
                        ? "Létrehozás…"
                        : "Beszállító létrehozása"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="font-semibold">Számla adatai</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <FormField label="Számlaszám">
              <Input
                aria-label="Számlaszám"
                value={supplierInvoiceNumber}
                onChange={(event) =>
                  setSupplierInvoiceNumber(event.target.value)
                }
              />
            </FormField>
            <FormField label="Pénznem">
              <Input
                aria-label="Pénznem"
                value={currency}
                maxLength={3}
                onChange={(event) =>
                  setCurrency(event.target.value.toUpperCase())
                }
              />
            </FormField>
            <FormField label="MNB árfolyam (HUF)">
              <Input
                aria-label="Árfolyam"
                type="number"
                step="any"
                min={0}
                value={exchangeRate}
                disabled={currency.trim().toUpperCase() === "HUF"}
                onChange={(event) =>
                  setExchangeRate(
                    event.target.value === "" ? "" : Number(event.target.value),
                  )
                }
              />
              {rateLoading ? (
                <p className="mt-1 text-xs text-slate-500">
                  Árfolyam lekérdezése…
                </p>
              ) : rateNotice ? (
                <p className="mt-1 text-xs text-slate-500">{rateNotice}</p>
              ) : null}
            </FormField>
            <FormField label="Számla kelte">
              <Input
                aria-label="Számla kelte"
                type="date"
                value={invoiceDate}
                onChange={(event) => setInvoiceDate(event.target.value)}
              />
            </FormField>
            <FormField label="Fizetési határidő">
              <Input
                aria-label="Fizetési határidő"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </FormField>
            <FormField label="Megjegyzés">
              <Input
                aria-label="Megjegyzés"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </FormField>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isPaid}
                onChange={(event) => setIsPaid(event.target.checked)}
              />
              A számla ki van fizetve
            </label>
            {isPaid ? (
              <FormField label="Fizetés dátuma">
                <Input
                  aria-label="Fizetés dátuma"
                  type="date"
                  value={paidAt}
                  onChange={(event) => setPaidAt(event.target.value)}
                />
              </FormField>
            ) : null}
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="font-semibold">Tételek</h2>
          <p className="mt-1 text-sm text-slate-500">
            Keresd meg a saját termékedet a számlán szereplő tétel alapján
            (cikkszám vagy terméknév).
          </p>
          <div className="mt-4">
            <Input
              aria-label="Termék keresése"
              value={productSearch}
              onChange={(event) => setProductSearch(event.target.value)}
              placeholder="Cikkszám vagy terméknév…"
              leadingIcon={<Icon name="search" size={17} />}
            />
            {searchingProducts ? <Skeleton className="mt-2 h-4 w-1/3" /> : null}
            {productResults.length > 0 ? (
              <Card className="mt-2 divide-y divide-slate-100 overflow-hidden">
                {productResults.map((product) => (
                  <button
                    key={product.variantId}
                    type="button"
                    onClick={() => addLine(product)}
                    className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    <div>
                      <p className="font-medium text-slate-900">
                        {product.productName}
                      </p>
                      <p className="font-mono text-xs text-slate-500">
                        {product.sku}
                      </p>
                    </div>
                    <p className="text-xs text-slate-500">
                      Készlet: {product.currentStock} {product.unit}
                    </p>
                  </button>
                ))}
              </Card>
            ) : null}
          </div>

          {lines.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">
              Még nincs felvett tétel. Keress rá egy termékre a hozzáadáshoz.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {lines.map((line) => (
                <div
                  key={line.key}
                  className="rounded-lg border border-slate-200 p-3"
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
                      onClick={() => removeLine(line.key)}
                      className="shrink-0 text-xs text-rose-600 hover:underline"
                    >
                      Eltávolítás
                    </button>
                  </div>
                  <div className="mt-2">
                    <label className="text-xs text-slate-500">
                      Megnevezés a számlán (opcionális)
                      <input
                        value={line.sourceDescription}
                        onChange={(event) =>
                          updateLine(line.key, {
                            sourceDescription: event.target.value,
                          })
                        }
                        className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
                      />
                    </label>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <label className="text-xs text-slate-500">
                      Rendelt ({line.unit})
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={line.orderedQuantity}
                        onChange={(event) =>
                          updateOrderedQuantity(
                            line.key,
                            Number(event.target.value),
                          )
                        }
                        className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
                      />
                    </label>
                    <label className="text-xs text-slate-500">
                      Tényleges ({line.unit})
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={line.actualQuantity}
                        onChange={(event) =>
                          updateLine(line.key, {
                            actualQuantity: Number(event.target.value),
                          })
                        }
                        className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
                      />
                    </label>
                    <label className="text-xs text-slate-500">
                      Egység
                      <input
                        value={line.unit}
                        onChange={(event) =>
                          updateLine(line.key, { unit: event.target.value })
                        }
                        className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
                      />
                    </label>
                    <label className="text-xs text-slate-500">
                      Egységár ({currency || "—"})
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={line.unitNet}
                        onChange={(event) =>
                          updateLine(line.key, {
                            unitNet: Number(event.target.value),
                          })
                        }
                        className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
                      />
                    </label>
                    <label className="text-xs text-slate-500">
                      Kedvezmény (%)
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="any"
                        value={line.discountPercent}
                        onChange={(event) =>
                          updateLine(line.key, {
                            discountPercent:
                              event.target.value === ""
                                ? ""
                                : Number(event.target.value),
                          })
                        }
                        className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
                      />
                    </label>
                  </div>
                  <p className="mt-2 text-right text-sm font-semibold text-slate-900">
                    {formatMoney(lineNet(line), currency)}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex justify-end border-t border-slate-100 pt-4 text-sm">
            <div className="text-right">
              <p className="text-slate-400">Nettó összeg</p>
              <p className="text-lg font-bold text-slate-900">
                {formatMoney(totalNet, currency)}
              </p>
            </div>
          </div>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Mentés…" : "Számla rögzítése és készlet frissítése"}
          </Button>
        </div>
      </form>
    </div>
  );
}
