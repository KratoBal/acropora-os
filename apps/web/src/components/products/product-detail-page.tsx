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
  Textarea,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type ProductDetail,
  type ProductExtensionDetail,
  type ProductExtensionUpdateInput,
} from "@acropora/types";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { FilterXSS, type IFilterXSSOptions } from "xss";

import { useAuth } from "@/components/auth/auth-provider";
import { ProductAuthorityCard } from "@/components/products/product-authority-card";
import { productApi } from "@/lib/api/products";
import { BarcodeEditor } from "./barcode-editor";

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
// Same money-formatting convention used across the app's detail/list pages
// (see e.g. product-list-page.tsx's formatHuf/formatStock, and the
// formatMoney helpers in the purchasing pages): hu-HU grouped digits via
// Intl/toLocaleString, currency as a plain trailing code. No standalone
// currency is ever shown without an amount.
const formatMoney = (
  amount: string | null | undefined,
  currency: string | null | undefined,
): string => {
  if (!amount) return "—";
  const formatted = Number(amount).toLocaleString("hu-HU", {
    maximumFractionDigits: 2,
  });
  return currency ? `${formatted} ${currency}` : formatted;
};
// Matches product-list-page.tsx's formatStock exactly, so the same
// on-hand quantity reads identically on the list and detail pages.
const formatStock = (candidate: string | null | undefined): string =>
  candidate == null
    ? "—"
    : Number(candidate).toLocaleString("hu-HU", { maximumFractionDigits: 2 });

// The UNAS product description is rich HTML (bold, lists, tables, links)
// copied from the UNAS editor. We want it to display the same way it does
// in UNAS, so it's rendered via dangerouslySetInnerHTML rather than as
// plain text.
//
// Sanitization uses `xss` (js-xss, leizongmin/js-xss) - NOT sanitize-html.
// sanitize-html's own GitHub repo was archived by its owner in Feb 2026
// (read-only, no further fixes will land there), and worse, its 2.17.6
// release depends on htmlparser2@^12, which resolves to htmlparser2@12.0.0
// - an ESM-only package ("type": "module", no CJS entry point). sanitize-
// html itself is CommonJS and does a plain `require("htmlparser2")`, so
// the two are simply incompatible: loading it throws ERR_REQUIRE_ESM. This
// was confirmed against a clean `pnpm install --frozen-lockfile` - both
// Vitest and Next's own Node runtime hit the same failure importing this
// file. It isn't something a transitive-dependency override should paper
// over (forcing a pre-12 htmlparser2 via a pnpm override would just mean
// running an unpatched, no-longer-compatible version of a dependency of an
// archived package - the underlying tool is what needed to change).
//
// `xss` avoids this whole category of problem structurally: it's plain
// CommonJS end to end (its only two dependencies, cssfilter and commander,
// are CommonJS too - no mixed module systems anywhere in the chain), and
// it's a hand-written string tokenizer rather than a DOM-based sanitizer.
// It never touches `DOMParser`, `jsdom`, or any HTML5 parser implementation,
// so the exact same code runs during SSR, under Vitest, and in the browser
// - there's no "two different parsers that might disagree" risk the way
// there would be with e.g. DOMPurify+jsdom on the server vs. native
// DOMPurify in the browser. Output is therefore byte-for-byte identical
// between server and client, so it can't cause a hydration mismatch. The
// project (leizongmin/js-xss) is still actively published (last release
// Feb 2026), not archived, and has ~5.3k GitHub stars / hundreds of forks.
const DESCRIPTION_ALLOWED_TAGS: NonNullable<IFilterXSSOptions["whiteList"]> = {
  a: ["href", "title"],
  abbr: ["title"],
  b: [],
  blockquote: [],
  br: [],
  caption: [],
  code: [],
  div: [],
  em: [],
  figcaption: [],
  figure: [],
  h1: [],
  h2: [],
  h3: [],
  h4: [],
  h5: [],
  h6: [],
  hr: [],
  i: [],
  img: ["src", "alt", "title", "width", "height"],
  li: [],
  ol: [],
  p: [],
  pre: [],
  s: [],
  small: [],
  span: [],
  strong: [],
  sub: [],
  sup: [],
  table: [],
  tbody: [],
  td: ["colspan", "rowspan"],
  tfoot: [],
  th: ["colspan", "rowspan"],
  thead: [],
  tr: [],
  u: [],
  ul: [],
};

const ALLOWED_LINK_SCHEME = /^(https?:|mailto:|tel:)/i;
const ALLOWED_IMAGE_SCHEME = /^https?:/i;

const descriptionFilter = new FilterXSS({
  whiteList: DESCRIPTION_ALLOWED_TAGS,
  // No tag above whitelists a "style" attribute, so `xss`'s CSS-filtering
  // codepath (cssfilter) is never even reached for any attribute - there's
  // no way for CSS-based content (position:fixed overlays, url(javascript:
  // ...), etc.) to survive sanitization.
  //
  // script/style/SVG/MathML and embed-style tags are dropped together with
  // their entire subtree (not just unwrapped/escaped-as-text), in case
  // something dangerous is smuggled in as a nested child.
  stripIgnoreTagBody: [
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "noscript",
    "svg",
    "math",
    "template",
    "head",
    "title",
    "textarea",
    "option",
  ],
  allowCommentTag: false,
  // href/src get a narrow scheme allowlist - anything else (javascript:,
  // data:, vbscript:, etc.) is dropped as a whole attribute rather than
  // left behind as an empty/bogus one.
  onTagAttr(tag, name, value) {
    if (name === "href" || name === "src") {
      const trimmed = value.trim();
      const allowed =
        tag === "img"
          ? ALLOWED_IMAGE_SCHEME.test(trimmed)
          : ALLOWED_LINK_SCHEME.test(trimmed);
      if (!allowed) return "";
    }
    return undefined;
  },
});

const sanitizeDescriptionHtml = (html: string): string => {
  if (!html) return "";
  const sanitized = descriptionFilter.process(html);
  // Force every remaining link to open safely in a new tab. This string
  // replace runs on `sanitized`, not on the untrusted input: by this point
  // every literal "<" from the original HTML has already been escaped to
  // "&lt;" by the filter above, so every remaining literal "<a" here is a
  // real anchor tag the filter itself just emitted, never attacker text.
  return sanitized.replace(
    /<a(?=[\s>])/gi,
    '<a target="_blank" rel="noopener noreferrer"',
  );
};

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
            <Textarea
              className="mt-1 min-h-24"
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
  // Külön jog, nem a PRODUCTS_MANAGE: aki napi terméktörzset gondoz, annak a
  // gazdaváltáshoz nem kell jogosultsága (lásd packages/types auth.ts).
  const canTransferAuthority = Boolean(
    session &&
    hasPermission(
      session.user,
      PERMISSIONS.PRODUCTS_CATALOG_AUTHORITY_TRANSFER,
    ),
  );
  // Matches the same fallback used throughout the rest of the app: in
  // production the session is an httpOnly cookie and `token` is always
  // undefined (see ProductionAuthAdapter) - apiRequest already relies on
  // the cookie when no Bearer token is given, so this must never gate an
  // effect or action, only be passed through as a call parameter.
  const token = session?.token ?? "";

  useEffect(() => {
    if (!canView) return;
    let active = true;
    setError(null);
    void productApi
      .detail(token, productId)
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
  }, [canView, productId, requestVersion, token]);

  const descriptionHtml = useMemo(
    () => sanitizeDescriptionHtml(product?.description ?? ""),
    [product?.description],
  );

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

  // The product-level mirror card can only show one purchase extension.
  // Keep that compatibility display for single-variant products; every
  // multi-variant product has its own editor and values in the list below.
  const activeVariants = product.variants.filter((variant) => variant.isActive);
  const primaryPurchaseExtension =
    activeVariants.length === 1 ? (activeVariants[0]?.extension ?? null) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={product.primarySku ?? "Nincs SKU"}
        title={product.name}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge
              variant={
                product.origin === "UNAS"
                  ? "info"
                  : product.origin === "LOCAL"
                    ? "neutral"
                    : "warning"
              }
            >
              {product.origin === "UNAS"
                ? "UNAS-termék"
                : product.origin === "LOCAL"
                  ? "Helyi Acropora OS-termék"
                  : "Eredet ellenőrzendő"}
            </Badge>
            <Button variant="secondary" onClick={() => router.push(listHref)}>
              Vissza a listához
            </Button>
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <ProductAuthorityCard
            token={token}
            product={product}
            canTransfer={canTransferAuthority}
            onTransferred={setProduct}
          />
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
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {product.unasMirror.isPackageProduct ? (
                    <Badge variant="warning">Számított csomagtermék</Badge>
                  ) : null}
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
                </div>
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
                        {product.unasMirror.isPackageProduct
                          ? "UNAS számított csomagkészlet"
                          : "UNAS jelentett készlet"}
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
                        Utolsó beszerár
                      </dt>
                      <dd className="mt-1 text-slate-800">
                        {formatMoney(
                          primaryPurchaseExtension?.lastPurchaseNetPrice,
                          primaryPurchaseExtension?.defaultPurchaseCurrency,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400">
                        Acropora OS készlet
                      </dt>
                      <dd className="mt-1 font-semibold text-slate-800">
                        {product.unasMirror.isPackageProduct
                          ? "Nincs önálló készlet"
                          : formatStock(product.stockOnHand)}
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
                  {product.unasMirror.isPackageProduct ? (
                    <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
                      <p className="text-xs font-bold uppercase tracking-wide text-amber-800">
                        Csomag összetevői
                      </p>
                      <p className="mt-1 text-xs text-amber-700">
                        A csomag készletét az UNAS az összetevők elérhető
                        mennyiségéből számítja; a csomaghoz nem tartozik önálló
                        Acropora OS készlet.
                      </p>
                      <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                        {product.unasMirror.packageComponents.map(
                          (component) => (
                            <li
                              key={`${component.sku}:${component.qty}`}
                              className="flex items-center justify-between rounded-md bg-white px-3 py-2"
                            >
                              <span className="font-mono text-xs text-slate-700">
                                {component.sku}
                              </span>
                              <span className="font-semibold text-slate-800">
                                {component.qty} db
                              </span>
                            </li>
                          ),
                        )}
                      </ul>
                    </div>
                  ) : null}
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
                          {variant.unasBaseSku ?? variant.sku}
                        </p>
                      </div>
                      <Badge variant={variant.isActive ? "success" : "neutral"}>
                        {variant.isActive ? "Aktív" : "Inaktív"}
                      </Badge>
                    </div>
                    <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-4">
                      {variant.unasVariantValues ? (
                        <div>
                          <dt className="text-slate-400">UNAS-változat</dt>
                          <dd className="mt-1 text-slate-700">
                            {variant.unasVariantValues
                              .map((item) => `${item.name}: ${item.value}`)
                              .join(", ")}
                          </dd>
                        </div>
                      ) : null}
                      <div>
                        <dt className="text-slate-400">UNAS készlet</dt>
                        <dd className="mt-1 text-slate-700">
                          {value(variant.unasReportedStock)}
                        </dd>
                      </div>
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

                    <BarcodeEditor
                      barcodes={variant.barcodes}
                      canManage={canManage}
                      onChanged={() =>
                        setRequestVersion((current) => current + 1)
                      }
                      token={token}
                      variantId={variant.id}
                    />

                    <ProductExtensionEditor
                      canManage={canManage}
                      extension={variant.extension}
                      onSaved={() =>
                        setRequestVersion((current) => current + 1)
                      }
                      token={token}
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
                <div
                  data-testid="product-description"
                  className="max-w-none text-sm text-slate-700 [&_a]:text-teal-700 [&_a]:underline [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_img]:max-w-full [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3 [&_p:last-child]:mb-0 [&_table]:w-full [&_td]:border [&_td]:border-slate-200 [&_td]:p-2 [&_th]:border [&_th]:border-slate-200 [&_th]:p-2 [&_ul]:list-disc [&_ul]:pl-5"
                  dangerouslySetInnerHTML={{
                    __html: descriptionHtml,
                  }}
                />
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
