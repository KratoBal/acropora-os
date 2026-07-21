"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
  PageHeader,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type ProductDetail,
  type ProductExtensionDetail,
  type ProductExtensionUpdateInput,
} from "@acropora/types";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { productApi } from "@/lib/api/products";

const value = (candidate: string | null | undefined) => candidate || "—";
const dateTime = (candidate: string | null | undefined) =>
  candidate
    ? new Intl.DateTimeFormat("hu-HU", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(candidate))
    : "—";
const flag = (candidate: boolean | null | undefined) =>
  candidate === null || candidate === undefined
    ? "—"
    : candidate
      ? "Igen"
      : "Nem";

interface ExtensionForm {
  defaultPurchaseCurrency: string;
  minimumStock: string;
  optimalStock: string;
  reorderPoint: string;
  safetyStock: string;
  lastPurchaseNetPrice: string;
  lastPurchaseVatRate: string;
  stockTrackingEnabled: boolean;
  purchasingDisabled: boolean;
  phaseOut: boolean;
  autoReorderEnabled: boolean;
  internalNote: string;
}

const extensionForm = (
  extension: ProductExtensionDetail | null,
): ExtensionForm => ({
  defaultPurchaseCurrency: extension?.defaultPurchaseCurrency ?? "",
  minimumStock: extension?.minimumStock ?? "",
  optimalStock: extension?.optimalStock ?? "",
  reorderPoint: extension?.reorderPoint ?? "",
  safetyStock: extension?.safetyStock ?? "",
  lastPurchaseNetPrice: extension?.lastPurchaseNetPrice ?? "",
  lastPurchaseVatRate: extension?.lastPurchaseVatRate ?? "",
  stockTrackingEnabled: extension?.stockTrackingEnabled ?? true,
  purchasingDisabled: extension?.purchasingDisabled ?? false,
  phaseOut: extension?.phaseOut ?? false,
  autoReorderEnabled: extension?.autoReorderEnabled ?? false,
  internalNote: extension?.internalNote ?? "",
});

const isHufCurrency = (currency: string | null | undefined) =>
  (currency ?? "").trim().toUpperCase() === "HUF";

// Display-only computed value (never persisted): gross = net * (1 + vat / 100).
// The stored source of truth is always the net price and the VAT rate.
const computeGrossPrice = (
  netPrice: string | null | undefined,
  vatRate: string | null | undefined,
): string | null => {
  if (!netPrice) return null;
  const net = Number(netPrice.replace(",", "."));
  if (!Number.isFinite(net)) return null;
  const vat = Number((vatRate ?? "0").replace(",", "."));
  return (net * (1 + (Number.isFinite(vat) ? vat : 0) / 100)).toFixed(2);
};

function ProductExtensionEditor({
  canManage,
  extension,
  onSaved,
  token,
  variantId,
}: {
  canManage: boolean;
  extension: ProductExtensionDetail | null;
  onSaved: () => void;
  token: string;
  variantId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(() => extensionForm(extension));

  useEffect(() => setForm(extensionForm(extension)), [extension]);

  const textField = (field: keyof ExtensionForm, nextValue: string) =>
    setForm((current) => ({ ...current, [field]: nextValue }));
  const toggle = (field: keyof ExtensionForm, checked: boolean) =>
    setForm((current) => ({ ...current, [field]: checked }));
  const formIsHuf = isHufCurrency(form.defaultPurchaseCurrency);
  const formGrossPrice = formIsHuf
    ? computeGrossPrice(form.lastPurchaseNetPrice, form.lastPurchaseVatRate)
    : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const currency = form.defaultPurchaseCurrency.trim().toUpperCase();
    if (currency && !/^[A-Z]{3}$/.test(currency)) {
      setError("A beszerzési deviza hárombetűs ISO-kód legyen, például EUR.");
      return;
    }
    const decimal = (candidate: string) => {
      const normalized = candidate.trim().replace(",", ".");
      if (normalized && !/^\d{1,13}(?:\.\d{1,6})?$/.test(normalized))
        throw new Error(
          "A készletérték legfeljebb 6 tizedesjegyű, nem negatív szám lehet.",
        );
      return normalized || null;
    };

    const isHuf = isHufCurrency(currency);
    setSaving(true);
    setError(null);
    try {
      const input: ProductExtensionUpdateInput = {
        defaultPurchaseCurrency: currency || null,
        minimumStock: decimal(form.minimumStock),
        optimalStock: decimal(form.optimalStock),
        reorderPoint: decimal(form.reorderPoint),
        safetyStock: decimal(form.safetyStock),
        lastPurchaseNetPrice: decimal(form.lastPurchaseNetPrice),
        lastPurchaseVatRate: isHuf ? decimal(form.lastPurchaseVatRate) : null,
        stockTrackingEnabled: form.stockTrackingEnabled,
        purchasingDisabled: form.purchasingDisabled,
        phaseOut: form.phaseOut,
        autoReorderEnabled: form.autoReorderEnabled,
        internalNote: form.internalNote.trim() || null,
      };
      await productApi.updateExtension(token, variantId, input);
      setEditing(false);
      onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A Product Extension mentése nem sikerült.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-sky-100 bg-sky-50/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-sky-800">
            Acropora Product Extension
          </p>
          <Badge variant="info">Saját adat</Badge>
        </div>
        {canManage && !editing ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setEditing(true)}
          >
            Szerkesztés
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-xs font-medium text-rose-700">
          {error}
        </p>
      ) : null}

      {editing ? (
        <form className="mt-4 space-y-4" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["defaultPurchaseCurrency", "Beszerzési deviza", "EUR"],
              ["minimumStock", "Minimumkészlet", "0"],
              ["optimalStock", "Optimális készlet", "0"],
              ["reorderPoint", "Újrarendelési pont", "0"],
              ["safetyStock", "Biztonsági készlet", "0"],
            ].map(([field, label, placeholder]) => (
              <div key={field} className="text-xs font-medium text-slate-600">
                <span>{label}</span>
                <Input
                  aria-label={label}
                  className="mt-1"
                  inputMode={
                    field === "defaultPurchaseCurrency" ? "text" : "decimal"
                  }
                  maxLength={
                    field === "defaultPurchaseCurrency" ? 3 : undefined
                  }
                  placeholder={placeholder}
                  value={form[field as keyof ExtensionForm] as string}
                  onChange={(event) =>
                    textField(field as keyof ExtensionForm, event.target.value)
                  }
                />
              </div>
            ))}
          </div>

          <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500 sm:col-span-2 lg:col-span-4">
              Utolsó beszerzés
            </p>
            {formIsHuf ? (
              <>
                <div className="text-xs font-medium text-slate-600">
                  <span>Utolsó beszerzési nettó ár</span>
                  <Input
                    aria-label="Utolsó beszerzési nettó ár"
                    className="mt-1"
                    inputMode="decimal"
                    placeholder="0"
                    value={form.lastPurchaseNetPrice}
                    onChange={(event) =>
                      textField("lastPurchaseNetPrice", event.target.value)
                    }
                  />
                </div>
                <div className="text-xs font-medium text-slate-600">
                  <span>Utolsó beszerzési ÁFA (%)</span>
                  <Input
                    aria-label="Utolsó beszerzési ÁFA"
                    className="mt-1"
                    inputMode="decimal"
                    placeholder="27"
                    value={form.lastPurchaseVatRate}
                    onChange={(event) =>
                      textField("lastPurchaseVatRate", event.target.value)
                    }
                  />
                </div>
                <div className="text-xs font-medium text-slate-600">
                  <span>Bruttó ár</span>
                  <p className="mt-1 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    {formGrossPrice ?? "—"} HUF
                  </p>
                </div>
              </>
            ) : (
              <div className="text-xs font-medium text-slate-600">
                <span>
                  Utolsó beszerzési ár
                  {form.defaultPurchaseCurrency
                    ? ` (${form.defaultPurchaseCurrency})`
                    : ""}
                </span>
                <Input
                  aria-label="Utolsó beszerzési ár"
                  className="mt-1"
                  inputMode="decimal"
                  placeholder="0"
                  value={form.lastPurchaseNetPrice}
                  onChange={(event) =>
                    textField("lastPurchaseNetPrice", event.target.value)
                  }
                />
              </div>
            )}
          </div>

          <div className="grid gap-2 text-xs text-slate-700 sm:grid-cols-2">
            {[
              ["stockTrackingEnabled", "Készletkövetés engedélyezve"],
              ["autoReorderEnabled", "Automatikus újrarendelés"],
              ["purchasingDisabled", "Beszerzésből kizárva"],
              ["phaseOut", "Kifutó termék"],
            ].map(([field, label]) => (
              <label key={field} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form[field as keyof ExtensionForm] as boolean}
                  onChange={(event) =>
                    toggle(field as keyof ExtensionForm, event.target.checked)
                  }
                  className="size-4 rounded border-slate-300 text-teal-700"
                />
                {label}
              </label>
            ))}
          </div>
          <label className="block text-xs font-medium text-slate-600">
            Belső megjegyzés
            <textarea
              className="mt-1 min-h-24 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15"
              maxLength={5000}
              value={form.internalNote}
              onChange={(event) =>
                textField("internalNote", event.target.value)
              }
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button
              disabled={saving}
              variant="secondary"
              onClick={() => {
                setForm(extensionForm(extension));
                setError(null);
                setEditing(false);
              }}
            >
              Mégse
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Mentés…" : "Mentés"}
            </Button>
          </div>
        </form>
      ) : (
        <>
          {!extension ? (
            <p className="mt-2 text-xs text-slate-500">
              Ehhez a változathoz még nincs mentett saját beállítás — az alábbi
              mezők üresek.
            </p>
          ) : null}
          <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-slate-400">Beszerzési deviza</dt>
              <dd className="mt-1 text-slate-700">
                {value(extension?.defaultPurchaseCurrency)}
              </dd>
            </div>
            {isHufCurrency(extension?.defaultPurchaseCurrency) ? (
              <>
                <div>
                  <dt className="text-slate-400">Utolsó beszerzési nettó ár</dt>
                  <dd className="mt-1 text-slate-700">
                    {value(extension?.lastPurchaseNetPrice)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">Utolsó beszerzési ÁFA</dt>
                  <dd className="mt-1 text-slate-700">
                    {extension?.lastPurchaseVatRate
                      ? `${extension.lastPurchaseVatRate}%`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">
                    Utolsó beszerzési bruttó ár
                  </dt>
                  <dd className="mt-1 text-slate-700">
                    {value(
                      computeGrossPrice(
                        extension?.lastPurchaseNetPrice,
                        extension?.lastPurchaseVatRate,
                      ),
                    )}
                  </dd>
                </div>
              </>
            ) : (
              <div>
                <dt className="text-slate-400">
                  Utolsó beszerzési ár
                  {extension?.defaultPurchaseCurrency
                    ? ` (${extension.defaultPurchaseCurrency})`
                    : ""}
                </dt>
                <dd className="mt-1 text-slate-700">
                  {value(extension?.lastPurchaseNetPrice)}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-slate-400">Minimumkészlet</dt>
              <dd className="mt-1 text-slate-700">
                {value(extension?.minimumStock)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Optimális készlet</dt>
              <dd className="mt-1 text-slate-700">
                {value(extension?.optimalStock)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Újrarendelési pont</dt>
              <dd className="mt-1 text-slate-700">
                {value(extension?.reorderPoint)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Biztonsági készlet</dt>
              <dd className="mt-1 text-slate-700">
                {value(extension?.safetyStock)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Készletkövetés</dt>
              <dd className="mt-1 text-slate-700">
                {flag(extension?.stockTrackingEnabled)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Automatikus újrarendelés</dt>
              <dd className="mt-1 text-slate-700">
                {flag(extension?.autoReorderEnabled)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Beszerzésből kizárva</dt>
              <dd className="mt-1 text-slate-700">
                {flag(extension?.purchasingDisabled)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Kifutó termék</dt>
              <dd className="mt-1 text-slate-700">
                {flag(extension?.phaseOut)}
              </dd>
            </div>
            {extension?.internalNote ? (
              <div className="sm:col-span-3">
                <dt className="text-slate-400">Belső megjegyzés</dt>
                <dd className="mt-1 whitespace-pre-wrap text-slate-700">
                  {extension.internalNote}
                </dd>
              </div>
            ) : null}
          </dl>
        </>
      )}
    </div>
  );
}

export function ProductDetailPage({ productId }: { productId: string }) {
  const { session } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const listHref = returnTo ? `/products?${returnTo}` : "/products";
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_MANAGE),
  );

  useEffect(() => {
    if (!canView || !session?.token) return;
    let active = true;
    setError(null);
    void productApi
      .detail(session.token, productId)
      .then((response) => {
        if (active) setProduct(response);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "A termék betöltése nem sikerült.",
          );
      });
    return () => {
      active = false;
    };
  }, [canView, productId, requestVersion, session?.token]);

  if (!canView) {
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a termékhez"
        description="A megnyitáshoz products.view jogosultság szükséges."
      />
    );
  }

  if (error) {
    return (
      <Alert
        variant="danger"
        title="A termék nem tölthető be"
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
    );
  }

  if (!product) {
    return (
      <div className="space-y-6" aria-label="Termék betöltése">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={product.primarySku ?? "Nincs SKU"}
        title={product.name}
        actions={
          <Button variant="secondary" onClick={() => router.push(listHref)}>
            Vissza a listához
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {product.unasMirror ? (
            <Card className="border-teal-200">
              <CardHeader className="bg-teal-50/70">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    UNAS terméktükör
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Product Master adatok · csak olvasható
                  </p>
                </div>
                <Badge
                  variant={
                    product.unasMirror.state === "ACTIVE"
                      ? "success"
                      : product.unasMirror.state === "MISSING"
                        ? "warning"
                        : "danger"
                  }
                >
                  {product.unasMirror.state === "ACTIVE"
                    ? "Szinkronban"
                    : product.unasMirror.state === "MISSING"
                      ? "Hiányzik az UNAS-ból"
                      : product.unasMirror.state === "CONFLICT"
                        ? "Azonosítási konfliktus"
                        : "Ismeretlen állapot"}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-5">
                <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt className="text-xs font-medium text-slate-400">
                      UNAS Product ID
                    </dt>
                    <dd className="mt-1 font-mono text-slate-800">
                      {value(product.unasMirror.externalId)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-slate-400">
                      Utolsó forrásmódosítás
                    </dt>
                    <dd className="mt-1 text-slate-800">
                      {dateTime(product.unasMirror.sourceUpdatedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-slate-400">
                      Utolsó szinkron
                    </dt>
                    <dd className="mt-1 text-slate-800">
                      {dateTime(product.unasMirror.lastSyncedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-slate-400">
                      Hiány kezdete
                    </dt>
                    <dd className="mt-1 text-slate-800">
                      {dateTime(product.unasMirror.missingSince)}
                    </dd>
                  </div>
                </dl>

                <div className="border-t border-slate-100 pt-5">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    UNAS értékesítési adatok
                  </h3>
                  <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <dt className="text-xs text-slate-400">Nettó ár</dt>
                      <dd className="mt-1 font-semibold text-slate-800">
                        {value(product.unasMirror.netPrice)}{" "}
                        {product.unasMirror.currency ?? ""}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400">Bruttó ár</dt>
                      <dd className="mt-1 font-semibold text-slate-800">
                        {value(product.unasMirror.grossPrice)}{" "}
                        {product.unasMirror.currency ?? ""}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400">
                        Akciós bruttó ár
                      </dt>
                      <dd className="mt-1 text-slate-800">
                        {value(product.unasMirror.saleGrossPrice)}{" "}
                        {product.unasMirror.currency ?? ""}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400">
                        UNAS jelentett készlet
                      </dt>
                      <dd className="mt-1 font-semibold text-slate-800">
                        {value(product.unasMirror.reportedStock)}
                      </dd>
                      <p className="mt-1 text-[11px] text-amber-700">
                        Összehasonlító adat, nem az Acropora készlet.
                      </p>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400">
                        Minimum mennyiség
                      </dt>
                      <dd className="mt-1 text-slate-800">
                        {value(product.unasMirror.minimumOrderQuantity)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400">Lépésköz</dt>
                      <dd className="mt-1 text-slate-800">
                        {value(product.unasMirror.orderQuantityStep)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400">
                        Vásárolható készlet nélkül
                      </dt>
                      <dd className="mt-1 text-slate-800">
                        {flag(product.unasMirror.backorderAllowed)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400">
                        Készlet snapshot ideje
                      </dt>
                      <dd className="mt-1 text-slate-800">
                        {dateTime(product.unasMirror.reportedStockSyncedAt)}
                      </dd>
                    </div>
                  </dl>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Alert
              title="Acropora által kezelt termék"
              description="Ehhez a termékhez nem tartozik UNAS terméktükör."
            />
          )}

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-900">
                Változatok és SKU-k
              </h2>
            </CardHeader>
            <div className="divide-y divide-slate-100">
              {product.variants.length ? (
                product.variants.map((variant) => (
                  <div key={variant.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">
                          {variant.name ?? product.name}
                        </p>
                        <p className="mt-0.5 font-mono text-xs text-slate-500">
                          {variant.sku}
                        </p>
                      </div>
                      <Badge variant={variant.isActive ? "success" : "neutral"}>
                        {variant.isActive ? "Aktív" : "Inaktív"}
                      </Badge>
                    </div>
                    <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
                      <div>
                        <dt className="text-slate-400">Egység</dt>
                        <dd className="mt-1 text-slate-700">{variant.unit}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">Gyártói cikkszám</dt>
                        <dd className="mt-1 text-slate-700">
                          {value(variant.manufacturerPartNumber)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">Másodlagos egység</dt>
                        <dd className="mt-1 text-slate-700">
                          {variant.secondaryUnit
                            ? `${variant.secondaryUnit} × ${value(variant.secondaryUnitFactor)}`
                            : "—"}
                        </dd>
                      </div>
                    </dl>

                    <ProductExtensionEditor
                      canManage={canManage}
                      extension={variant.extension}
                      onSaved={() =>
                        setRequestVersion((current) => current + 1)
                      }
                      token={session?.token ?? ""}
                      variantId={variant.id}
                    />
                  </div>
                ))
              ) : (
                <p className="px-5 py-5 text-sm text-slate-500">
                  Nincs rögzített változat.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-900">
                Termékleírás
              </h2>
            </CardHeader>
            <CardContent>
              {product.description ? (
                <p className="whitespace-pre-wrap text-sm text-slate-700">
                  {product.description}
                </p>
              ) : (
                <p className="text-sm text-slate-500">
                  Ehhez a termékhez nincs leírás.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-900">Képek</h2>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {product.images.length ? (
                product.images.map((image) => (
                  <figure key={image.id}>
                    <img
                      src={image.url}
                      alt={image.altText ?? product.name}
                      className="aspect-square w-full rounded-xl border border-slate-200 object-cover"
                    />
                    {image.title ? (
                      <figcaption className="mt-2 text-xs text-slate-500">
                        {image.title}
                      </figcaption>
                    ) : null}
                  </figure>
                ))
              ) : (
                <p className="text-sm text-slate-500">Nincs termékkép.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-900">
                Alapadatok
              </h2>
              <Badge variant={product.isActive ? "success" : "neutral"}>
                {product.isActive ? "Aktív" : "Archivált"}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <p className="text-xs font-medium text-slate-400">Márka</p>
                <p className="mt-1 text-slate-800">
                  {product.brand?.name ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-400">Kategóriák</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {product.categories.length ? (
                    product.categories.map((category) => (
                      <Badge
                        key={category.id}
                        variant={category.isPrimary ? "info" : "neutral"}
                      >
                        {category.name}
                        {category.isPrimary ? " · elsődleges" : ""}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-900">
                Csatornák
              </h2>
            </CardHeader>
            <CardContent className="space-y-3">
              {product.channelListings.length ? (
                product.channelListings.map((listing) => (
                  <div
                    key={listing.channel}
                    className="rounded-lg border border-slate-200 p-3"
                  >
                    <p className="text-sm font-semibold text-slate-800">
                      {listing.channel}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Nyers külső státusz: {listing.externalStatus ?? "—"}
                    </p>
                    {listing.productUrl ? (
                      <a
                        href={listing.productUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-block text-xs font-semibold text-teal-700 hover:underline"
                      >
                        Webshop oldal megnyitása
                      </a>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">Nincs csatornalisting.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
