"use client";

import {
  Alert,
  Button,
  Input,
  PilotDataGrid,
  PilotDataItem,
  PilotPageHeader,
  PilotPairedRows,
  PilotSection,
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
import {
  PilotBadge,
  PilotButton,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";
import { ProductAuthorityCard } from "@/components/products/product-authority-card";
import { ProductShippingProfileCard } from "@/components/products/product-shipping-profile-card";
import { ProductBasicsEditor } from "@/components/products/product-basics-editor";
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
  noteShownElsewhere = false,
  onSaved,
  token,
  variantId,
}: {
  canManage: boolean;
  extension: ProductExtensionDetail | null;
  /**
   * A belső megjegyzést a lap jobb oszlopa mutatja (egyváltozatos termék,
   * Direction F): az olvasó nézet ilyenkor nem ismétli meg. A szerkesztő
   * mezője marad, itt szerkeszthető.
   */
  noteShownElsewhere?: boolean;
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
          <PilotBadge variant="blue">Saját adat</PilotBadge>
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
              <div key={field} className="text-xs font-medium text-dusk-600">
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

          <div className="grid gap-3 rounded-lg border border-dusk-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
            <p className="text-xs font-bold uppercase tracking-wide text-dusk-500 sm:col-span-2 lg:col-span-4">
              Utolsó beszerzés
            </p>
            {formIsHuf ? (
              <>
                <div className="text-xs font-medium text-dusk-600">
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
                <div className="text-xs font-medium text-dusk-600">
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
                <div className="text-xs font-medium text-dusk-600">
                  <span>Bruttó ár</span>
                  <p className="mt-1 rounded-lg border border-dusk-100 bg-dusk-50 px-3 py-2 text-sm text-dusk-700">
                    {formGrossPrice ?? "—"} HUF
                  </p>
                </div>
              </>
            ) : (
              <div className="text-xs font-medium text-dusk-600">
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

          <div className="grid gap-2 text-xs text-dusk-700 sm:grid-cols-2">
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
                  className="size-4 rounded border-dusk-300 text-brand-700"
                />
                {label}
              </label>
            ))}
          </div>
          <label className="block text-xs font-medium text-dusk-600">
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
            <p className="mt-2 text-xs text-dusk-500">
              Ehhez a változathoz még nincs mentett saját beállítás — az alábbi
              mezők üresek.
            </p>
          ) : null}
          <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-dusk-400">Beszerzési deviza</dt>
              <dd className="mt-1 text-dusk-700">
                {value(extension?.defaultPurchaseCurrency)}
              </dd>
            </div>
            {isHufCurrency(extension?.defaultPurchaseCurrency) ? (
              <>
                <div>
                  <dt className="text-dusk-400">Utolsó beszerzési nettó ár</dt>
                  <dd className="mt-1 text-dusk-700">
                    {value(extension?.lastPurchaseNetPrice)}
                  </dd>
                </div>
                <div>
                  <dt className="text-dusk-400">Utolsó beszerzési ÁFA</dt>
                  <dd className="mt-1 text-dusk-700">
                    {extension?.lastPurchaseVatRate
                      ? `${extension.lastPurchaseVatRate}%`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-dusk-400">Utolsó beszerzési bruttó ár</dt>
                  <dd className="mt-1 text-dusk-700">
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
                <dt className="text-dusk-400">
                  Utolsó beszerzési ár
                  {extension?.defaultPurchaseCurrency
                    ? ` (${extension.defaultPurchaseCurrency})`
                    : ""}
                </dt>
                <dd className="mt-1 text-dusk-700">
                  {value(extension?.lastPurchaseNetPrice)}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-dusk-400">Minimumkészlet</dt>
              <dd className="mt-1 text-dusk-700">
                {value(extension?.minimumStock)}
              </dd>
            </div>
            <div>
              <dt className="text-dusk-400">Optimális készlet</dt>
              <dd className="mt-1 text-dusk-700">
                {value(extension?.optimalStock)}
              </dd>
            </div>
            <div>
              <dt className="text-dusk-400">Újrarendelési pont</dt>
              <dd className="mt-1 text-dusk-700">
                {value(extension?.reorderPoint)}
              </dd>
            </div>
            <div>
              <dt className="text-dusk-400">Biztonsági készlet</dt>
              <dd className="mt-1 text-dusk-700">
                {value(extension?.safetyStock)}
              </dd>
            </div>
            <div>
              <dt className="text-dusk-400">Készletkövetés</dt>
              <dd className="mt-1 text-dusk-700">
                {flag(extension?.stockTrackingEnabled)}
              </dd>
            </div>
            <div>
              <dt className="text-dusk-400">Automatikus újrarendelés</dt>
              <dd className="mt-1 text-dusk-700">
                {flag(extension?.autoReorderEnabled)}
              </dd>
            </div>
            <div>
              <dt className="text-dusk-400">Beszerzésből kizárva</dt>
              <dd className="mt-1 text-dusk-700">
                {flag(extension?.purchasingDisabled)}
              </dd>
            </div>
            <div>
              <dt className="text-dusk-400">Kifutó termék</dt>
              <dd className="mt-1 text-dusk-700">
                {flag(extension?.phaseOut)}
              </dd>
            </div>
            {extension?.internalNote && !noteShownElsewhere ? (
              <div className="sm:col-span-3">
                <dt className="text-dusk-400">Belső megjegyzés</dt>
                <dd className="mt-1 whitespace-pre-wrap text-dusk-700">
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

  const originBadge =
    product.origin === "UNAS" ? (
      <PilotBadge variant="blue">UNAS-termék</PilotBadge>
    ) : product.origin === "LOCAL" ? (
      <PilotBadge variant="grey">Helyi Acropora OS-termék</PilotBadge>
    ) : (
      <PilotBadge variant="amber">Eredet ellenőrzendő</PilotBadge>
    );
  const statusBadge = (
    <PilotBadge variant={product.isActive ? "success" : "grey"}>
      {product.isActive ? "Aktív" : "Archivált"}
    </PilotBadge>
  );
  const primaryCategory =
    product.categories.find((category) => category.isPrimary) ??
    product.primaryCategory;
  const otherCategories = product.categories.filter(
    (category) => !category.isPrimary,
  );
  const variantNotes = activeVariants.filter(
    (variant) => variant.extension?.internalNote,
  );

  const basics = (
    <PilotSection title="Alapadatok" action={statusBadge}>
      <PilotDataGrid>
        <PilotDataItem label="Márka">{product.brand?.name}</PilotDataItem>
        <PilotDataItem label="Elsődleges kategória">
          {primaryCategory?.name}
        </PilotDataItem>
        {otherCategories.length ? (
          <div className="col-span-2">
            <PilotDataItem label="További kategóriák">
              {otherCategories.map((category) => category.name).join(", ")}
            </PilotDataItem>
          </div>
        ) : null}
      </PilotDataGrid>
    </PilotSection>
  );

  /*
    KÉSZLET ÉS BESZERZÉS, A TERV JOBB OSZLOPÁBAN. Az adat VÁLTOZÓNKÉNT él
    (a beszerzési kiegészítő a változaté), és a szerkesztője a Változatok
    kártyán marad: ez a kártya olvas. Egyváltozatos terméknél a változat
    értékeit mutatja, többváltozatosnál a Változatok kártyára utal. A csomag
    saját készletet nem tart, azt a terméktükör mondja ki.
  */
  const stock = (
    <PilotSection title="Készlet és beszerzés">
      <PilotDataGrid>
        <PilotDataItem
          label="OS készlet"
          hint={product.unasMirror?.isPackageProduct ? "Csomagtermék" : null}
        >
          {product.unasMirror?.isPackageProduct
            ? null
            : formatStock(product.stockOnHand)}
        </PilotDataItem>
        {primaryPurchaseExtension ? (
          <>
            <PilotDataItem label="Beszerzár">
              {formatMoney(
                primaryPurchaseExtension.lastPurchaseNetPrice,
                primaryPurchaseExtension.defaultPurchaseCurrency,
              )}
            </PilotDataItem>
            <PilotDataItem label="Minimum">
              {primaryPurchaseExtension.minimumStock}
            </PilotDataItem>
            <PilotDataItem label="Optimális">
              {primaryPurchaseExtension.optimalStock}
            </PilotDataItem>
            <PilotDataItem label="Újrarendelési pont">
              {primaryPurchaseExtension.reorderPoint}
            </PilotDataItem>
            <PilotDataItem label="Automata újrarendelés">
              {flag(primaryPurchaseExtension.autoReorderEnabled)}
            </PilotDataItem>
          </>
        ) : null}
      </PilotDataGrid>
      {!primaryPurchaseExtension ? (
        <p className="mt-4 text-xs leading-5 text-pilot-grey-500">
          {activeVariants.length > 1
            ? "Változatonként: a Változatok és SKU-k kártyán."
            : "Ehhez a termékhez még nincs mentett beszerzési beállítás."}
        </p>
      ) : null}
    </PilotSection>
  );

  const channels = (
    <PilotSection title="Csatornák">
      {product.channelListings.length ? (
        <ul className="divide-y divide-pilot-grey-200">
          {product.channelListings.map((listing) => (
            <li key={listing.channel} className="py-3 first:pt-0 last:pb-0">
              <p className="text-sm font-semibold text-pilot-grey-900">
                {listing.channel}
              </p>
              <p className="mt-1 text-xs text-pilot-grey-500">
                Nyers külső státusz: {listing.externalStatus ?? "—"}
              </p>
              {listing.productUrl ? (
                <a
                  href={listing.productUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-xs font-semibold text-pilot-aqua-700 hover:underline"
                >
                  Webshop oldal megnyitása
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-pilot-grey-500">Nincs csatornalisting.</p>
      )}
    </PilotSection>
  );

  /*
    A BELSŐ MEGJEGYZÉS, HALVÁNY MELEG HÁTTÉRREL (a terv szerint). Egyváltozatos
    terméknél a változat jegyzete (a szerkesztő olvasó nézete ilyenkor nem
    ismétli meg), többváltozatosnál a jegyzetes változatok, névvel.
  */
  const note = (
    <PilotSection title="Belső megjegyzés" tone="warm">
      {variantNotes.length === 0 ? (
        <p className="text-sm text-pilot-grey-500">Nincs belső megjegyzés.</p>
      ) : activeVariants.length === 1 ? (
        <p className="whitespace-pre-wrap text-sm leading-6 text-pilot-grey-700">
          {variantNotes[0]!.extension!.internalNote}
        </p>
      ) : (
        <dl className="space-y-3">
          {variantNotes.map((variant) => (
            <div key={variant.id}>
              <dt className="text-xs font-semibold text-pilot-grey-600">
                {variant.name ?? variant.unasBaseSku ?? variant.sku}
              </dt>
              <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-pilot-grey-700">
                {variant.extension!.internalNote}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </PilotSection>
  );

  const mirror = product.unasMirror ? (
    <PilotSection
      title="UNAS terméktükör"
      subtitle="Product Master adatok · csak olvasható"
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {product.unasMirror.isPackageProduct ? (
            <PilotBadge variant="amber">Számított csomagtermék</PilotBadge>
          ) : null}
          <PilotBadge
            variant={
              product.unasMirror.state === "ACTIVE"
                ? "success"
                : product.unasMirror.state === "MISSING"
                  ? "amber"
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
          </PilotBadge>
        </div>
      }
    >
      <PilotDataGrid columns={4}>
        <PilotDataItem label="UNAS Product ID" mono>
          {value(product.unasMirror.externalId)}
        </PilotDataItem>
        <PilotDataItem label="Utolsó szinkron">
          {dateTime(product.unasMirror.lastSyncedAt)}
        </PilotDataItem>
        <PilotDataItem label="Nettó ár">
          {value(product.unasMirror.netPrice)}{" "}
          {product.unasMirror.currency ?? ""}
        </PilotDataItem>
        <PilotDataItem label="Bruttó ár">
          {value(product.unasMirror.grossPrice)}{" "}
          {product.unasMirror.currency ?? ""}
        </PilotDataItem>
        <PilotDataItem label="Akciós bruttó ár">
          {value(product.unasMirror.saleGrossPrice)}{" "}
          {product.unasMirror.currency ?? ""}
        </PilotDataItem>
        <PilotDataItem
          label={
            product.unasMirror.isPackageProduct
              ? "UNAS számított csomagkészlet"
              : "UNAS jelentett készlet"
          }
          hint="Összehasonlító adat, nem az Acropora készlet."
        >
          {value(product.unasMirror.reportedStock)}
        </PilotDataItem>
        <PilotDataItem label="Acropora OS készlet">
          {product.unasMirror.isPackageProduct
            ? "Nincs önálló készlet"
            : formatStock(product.stockOnHand)}
        </PilotDataItem>
        <PilotDataItem label="Vásárolható készlet nélkül">
          {flag(product.unasMirror.backorderAllowed)}
        </PilotDataItem>
        <PilotDataItem label="Utolsó beszerár">
          {formatMoney(
            primaryPurchaseExtension?.lastPurchaseNetPrice,
            primaryPurchaseExtension?.defaultPurchaseCurrency,
          )}
        </PilotDataItem>
        {/*
          A RENDELESI KORLATOK. A tukorbol jonnek; ez a lap a belso kollega
          kepernyoje, tehat a megjelenites itt nem tesz igeretet a vevonek.
          A bevitel ellenorzese a bolti oldal kerdese, es kulon dontes.
        */}
        <PilotDataItem label="Minimális rendelhető mennyiség">
          {value(product.unasMirror.minimumOrderQuantity)}
        </PilotDataItem>
        <PilotDataItem label="Maximális rendelhető mennyiség">
          {value(product.unasMirror.maximumOrderQuantity)}
        </PilotDataItem>
        <PilotDataItem label="Rendelési lépésköz">
          {value(product.unasMirror.orderQuantityStep)}
        </PilotDataItem>
        <PilotDataItem label="Utolsó forrásmódosítás">
          {dateTime(product.unasMirror.sourceUpdatedAt)}
        </PilotDataItem>
        <PilotDataItem label="Hiány kezdete">
          {dateTime(product.unasMirror.missingSince)}
        </PilotDataItem>
        <PilotDataItem label="Készlet snapshot ideje">
          {dateTime(product.unasMirror.reportedStockSyncedAt)}
        </PilotDataItem>
      </PilotDataGrid>
      {product.unasMirror.isPackageProduct ? (
        <div className="mt-5 rounded-lg bg-pilot-amber-50 p-4 ring-1 ring-pilot-amber-100">
          <p className="text-xs font-semibold uppercase tracking-[0.05em] text-pilot-amber-700">
            Csomag összetevői
          </p>
          <p className="mt-1 text-xs text-pilot-amber-700">
            A csomag készletét az UNAS az összetevők elérhető mennyiségéből
            számítja; a csomaghoz nem tartozik önálló Acropora OS készlet.
          </p>
          <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            {product.unasMirror.packageComponents.map((component) => (
              <li
                key={`${component.sku}:${component.qty}`}
                className="flex items-center justify-between rounded-md bg-white px-3 py-2"
              >
                <span className="font-mono text-xs text-pilot-grey-700">
                  {component.sku}
                </span>
                <span className="font-semibold text-pilot-grey-900">
                  {component.qty} db
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </PilotSection>
  ) : (
    <Alert
      title="Acropora által kezelt termék"
      description="Ehhez a termékhez nem tartozik UNAS terméktükör."
    />
  );

  const variants = (
    <PilotSection title="Változatok és SKU-k" bodyClassName="">
      <div className="divide-y divide-pilot-grey-200">
        {product.variants.length ? (
          product.variants.map((variant) => (
            <div key={variant.id} className="px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-pilot-grey-900">
                    {variant.name ?? product.name}
                  </p>
                  <p className="mt-0.5 text-xs text-pilot-grey-500">
                    {variant.unasBaseSku ?? variant.sku}
                  </p>
                </div>
                <PilotBadge variant={variant.isActive ? "success" : "grey"}>
                  {variant.isActive ? "Aktív" : "Inaktív"}
                </PilotBadge>
              </div>
              <div className="mt-4">
                <PilotDataGrid columns={4}>
                  {variant.unasVariantValues ? (
                    <PilotDataItem label="UNAS-változat">
                      {variant.unasVariantValues
                        .map((item) => `${item.name}: ${item.value}`)
                        .join(", ")}
                    </PilotDataItem>
                  ) : null}
                  <PilotDataItem label="UNAS készlet">
                    {value(variant.unasReportedStock)}
                  </PilotDataItem>
                  <PilotDataItem label="Egység">{variant.unit}</PilotDataItem>
                  <PilotDataItem label="Gyártói cikkszám">
                    {value(variant.manufacturerPartNumber)}
                  </PilotDataItem>
                  <PilotDataItem label="Másodlagos egység">
                    {variant.secondaryUnit
                      ? `${variant.secondaryUnit} × ${value(variant.secondaryUnitFactor)}`
                      : "—"}
                  </PilotDataItem>
                </PilotDataGrid>
              </div>

              <BarcodeEditor
                barcodes={variant.barcodes}
                canManage={canManage}
                onChanged={() => setRequestVersion((current) => current + 1)}
                token={token}
                variantId={variant.id}
              />

              <ProductExtensionEditor
                canManage={canManage}
                extension={variant.extension}
                noteShownElsewhere={activeVariants.length === 1}
                onSaved={() => setRequestVersion((current) => current + 1)}
                token={token}
                variantId={variant.id}
              />
            </div>
          ))
        ) : (
          <p className="px-5 py-5 text-sm text-pilot-grey-500">
            Nincs rögzített változat.
          </p>
        )}
      </div>
    </PilotSection>
  );

  const description = (
    <PilotSection title="Termékleírás">
      {product.description ? (
        <div
          data-testid="product-description"
          className="max-w-none text-sm leading-6 text-pilot-grey-700 [&_a]:text-pilot-aqua-700 [&_a]:underline [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_img]:max-w-full [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3 [&_p:last-child]:mb-0 [&_table]:w-full [&_td]:border [&_td]:border-pilot-grey-200 [&_td]:p-2 [&_th]:border [&_th]:border-pilot-grey-200 [&_th]:p-2 [&_ul]:list-disc [&_ul]:pl-5"
          dangerouslySetInnerHTML={{ __html: descriptionHtml }}
        />
      ) : (
        <p className="text-sm text-pilot-grey-500">
          Ehhez a termékhez nincs leírás.
        </p>
      )}
    </PilotSection>
  );

  const images = (
    <PilotSection title="Képek">
      {product.images.length ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {product.images.map((image) => (
            <figure key={image.id}>
              <img
                src={image.url}
                alt={image.altText ?? product.name}
                className="aspect-[156/112] w-full rounded-lg border border-pilot-grey-200 object-cover"
              />
              {image.title ? (
                <figcaption className="mt-2 text-xs text-pilot-grey-500">
                  {image.title}
                </figcaption>
              ) : null}
            </figure>
          ))}
        </div>
      ) : (
        <p className="text-sm text-pilot-grey-500">Nincs termékkép.</p>
      )}
    </PilotSection>
  );

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <PilotPageHeader
        eyebrow={product.primarySku ?? "Nincs SKU"}
        title={product.name}
        meta={
          <>
            {originBadge}
            {statusBadge}
          </>
        }
        actions={
          <PilotButton
            size="regular"
            variant="secondary"
            onClick={() => router.push(listHref)}
          >
            <span aria-hidden="true">←</span>
            Vissza a listához
          </PilotButton>
        }
      />

      {/*
        A PÁROS SOROK (a brief 6. pontja): minden bal kártya mellett a párja,
        közös kezdőponttal. Ami után nem áll pár, a bal oszlopban marad.
      */}
      <PilotPairedRows
        rows={[
          {
            id: "authority",
            main: (
              <ProductAuthorityCard
                token={token}
                product={product}
                canTransfer={canTransferAuthority}
                onTransferred={setProduct}
              />
            ),
            side: basics,
          },
          /*
            A szerkesztő csak az Acropora OS tulajdonában lévő terméken jelenik
            meg. Ez KÉNYELEM, nem védelem: a tiltás a szolgáltatásban áll.
          */
          ...(product.catalogAuthority === "ACROPORA"
            ? [
                {
                  id: "basics-editor",
                  main: (
                    <ProductBasicsEditor
                      token={token}
                      product={product}
                      canManage={canManage}
                      onSaved={setProduct}
                    />
                  ),
                },
              ]
            : []),
          /*
            A szállítási jellemzők KÉZZEL gondozott törzsadatok: a UNAS-szinkron
            nem ír rájuk, ezért a gazda-állapottól függetlenül látszanak.
          */
          {
            id: "shipping",
            main: (
              <ProductShippingProfileCard
                token={token}
                productId={product.id}
                canManage={canManage}
              />
            ),
            side: stock,
          },
          { id: "mirror", main: mirror, side: channels },
          { id: "variants", main: variants, side: note },
          { id: "description", main: description },
          { id: "images", main: images },
        ]}
      />
    </PilotThemeRoot>
  );
}
