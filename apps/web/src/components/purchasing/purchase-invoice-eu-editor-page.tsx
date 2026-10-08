"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  FormField,
  Icon,
  Input,
  PilotCallout,
  PilotPageHeader,
  PilotSection,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type CatalogOption,
  type ProjectOption,
  type PurchaseInvoiceResult,
  type PurchaseInvoiceSource,
  type PurchaseProductConflictLookup,
  type PurchaseProductSearchResult,
  type SupplierInvoiceImportFormat,
  type SupplierInvoiceImportResult,
  type SupplierLineSuggestionResult,
  type SupplierLineSuggestionSource,
  type SupplierSummary,
  type ViesVatLookupResult,
  viesFill,
} from "@acropora/types";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  PilotBadge,
  PilotButton,
  PilotInput,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";
import { inferCountryFromTaxNumber } from "@/components/customers/country-options";
import { expectedArrivalsApi } from "@/lib/api/expected-arrivals";
import { navIncomingInvoicesApi } from "@/lib/api/nav-incoming-invoices";
import { productApi } from "@/lib/api/products";
import { purchasingApi } from "@/lib/api/purchasing";
import { suppliersApi } from "@/lib/api/suppliers";
import { viesVatApi } from "@/lib/api/vies-vat";
import {
  ViesConflicts,
  type ViesConflict,
} from "@/components/vies/vies-conflicts";
import { ViesMissingDetails } from "@/components/vies/vies-missing-details";
import { createDebouncer } from "@/lib/products/list-state";

// Ez a komponens az EU-s és a belföldi (kézi és NAV-alapú) beszerzési
// számla rögzítést is kiszolgálja ugyanazon a felületen - a fájl-/export
// név a történeti EU-s eredetből maradt, de a `source` állapot dönti el a
// tényleges viselkedést (deviza+MNB árfolyam vs. HUF+ÁFA-kulcs).

interface InvoiceLineState {
  key: string;
  /** Nincs, ha a tétel nincs a terméktörzsben - ilyenkor a sourceDescription kötelező, és nincs UNAS-szinkron. */
  variantId: string | null;
  createLocalProduct: {
    name: string;
    primaryCategoryId: string;
    /** #1199 P-026: az új termék alapadatai; üres = nincs megadva. */
    brandId: string;
    vatRate: number | "";
    ean: string;
    supplierSku: string;
    /** A webshopba is, piszkozatként; alapból nem (Balázs, 2026-09-28). */
    webshopDraft: boolean;
  } | null;
  sku: string;
  productName: string;
  unit: string;
  sourceDescription: string;
  /**
   * A beszállító saját cikkszáma, ha a sor beszállítói számlafájlból jött.
   * Csak kijelzés és keresési segítség: a számlasorral nem mentődik.
   */
  supplierSku?: string | null;
  /** EAN, ha a beszállítói számla hordozta; új termék felvételénél előtölt. */
  ean?: string | null;
  /** Fuvar- vagy díjsor a beolvasott számlán: nem kér termék-javaslatot. */
  isCharge?: boolean;
  /** #1199 P-026: a sorhoz kért javaslat audit-futása; a mentés ezzel zárja le. */
  decisionRunId?: string | null;
  /** A NAV számlasor sorszáma, ha a sor NAV bejövő számlából jött; a mentés ezzel köti a sort a NAV sorhoz. */
  navLineNumber: number | null;
  orderedQuantity: number;
  actualQuantity: number;
  unitNet: number;
  discountPercent: number | "";
  projectAllocations: Array<{
    key: string;
    projectId: string;
    quantity: number;
  }>;
}

function lineNet(line: InvoiceLineState): number {
  const gross = line.actualQuantity * line.unitNet;
  const discount = line.discountPercent
    ? gross * (Number(line.discountPercent) / 100)
    : 0;
  return gross - discount;
}

function allocatedQuantity(line: InvoiceLineState): number {
  return line.projectAllocations.reduce(
    (sum, allocation) => sum + (Number(allocation.quantity) || 0),
    0,
  );
}

/**
 * A TÉTELSOR OSZLOPRÁCSA, EGY HELYEN (a Beszerzés-brief 13. pontja): a
 * fejléc és minden sor mezői ugyanezt használják, tehát nem tudnak
 * elcsúszni egymáshoz képest. Nagy képernyőn: számlasor, rendelt,
 * tényleges, egység, egységár, kedvezmény, sorösszeg; kisebben két-három
 * oszlopba törik, a mezők saját címkéjével.
 */
const LINE_GRID =
  "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-[minmax(0,1fr)_84px_84px_72px_112px_72px_128px] lg:items-end";

/**
 * A SOR TERMÉK-ÁLLAPOTA A MEGJELENÍTÉSHEZ (a brief 14. pontja). Csak olvas:
 * a javaslat kérése és elfogadása a meglévő logikán megy, változatlanul.
 */
export function lineState(
  line: Pick<InvoiceLineState, "variantId" | "createLocalProduct">,
  suggestion:
    (SupplierLineSuggestionResult & { dismissed?: boolean }) | undefined,
): "matched" | "local" | "suggested" | "unlinked" {
  if (line.createLocalProduct) return "local";
  if (line.variantId) return "matched";
  if (
    suggestion?.suggestion &&
    !suggestion.dismissed &&
    !suggestion.conflict &&
    !suggestion.blocked
  )
    return "suggested";
  return "unlinked";
}

/** Az alsó összegző sora: a valós sorokból, nem a terv mintaszámaiból. */
export function submitSummary(
  lines: readonly Pick<
    InvoiceLineState,
    "createLocalProduct" | "projectAllocations"
  >[],
): string {
  if (lines.length === 0) return "Még nincs számlasor";
  const local = lines.filter((line) => line.createLocalProduct).length;
  const reservations = lines.reduce(
    (sum, line) =>
      sum +
      line.projectAllocations.filter(
        (allocation) => allocation.projectId && Number(allocation.quantity) > 0,
      ).length,
    0,
  );
  return `${lines.length} számlasor · ${local} helyi termék · ${reservations} projektfoglalás`;
}

function formatMoney(value: number, currency: string): string {
  return `${value.toLocaleString("hu-HU", { maximumFractionDigits: 2 })} ${currency}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function toDateInput(isoDate: string | undefined): string {
  return isoDate ? isoDate.slice(0, 10) : "";
}

export function PurchaseInvoiceEuEditorPage() {
  const { session } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const navInvoiceId = searchParams.get("navInvoiceId") ?? undefined;
  // Várható beérkezések: a levélből jött számla, a listáról megnyitva.
  const arrivalId = navInvoiceId
    ? undefined
    : (searchParams.get("beerkezes") ?? undefined);
  const token = session?.token ?? "";
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PURCHASING_MANAGE),
  );

  // NAV-alapú bevételezésnél a forrás fixen HU_NAV, nincs váltó; egyébként
  // a felhasználó választhat EU-s és belföldi kézi rögzítés között.
  const [source, setSource] = useState<PurchaseInvoiceSource>(
    navInvoiceId ? "HU_NAV" : "EU",
  );
  const isDomestic = source !== "EU";
  const [navPrefillLoading, setNavPrefillLoading] = useState(
    Boolean(navInvoiceId),
  );
  const [navPrefillError, setNavPrefillError] = useState<string | null>(null);
  const [navPrefillNumber, setNavPrefillNumber] = useState<string | null>(null);
  const [arrivalPrefillLoading, setArrivalPrefillLoading] = useState(
    Boolean(arrivalId),
  );
  const [arrivalPrefillError, setArrivalPrefillError] = useState<string | null>(
    null,
  );
  const [arrivalPrefill, setArrivalPrefill] = useState<{
    fileName: string;
    orderReference: string | null;
  } | null>(null);

  const [supplierSearch, setSupplierSearch] = useState("");
  const [supplierResults, setSupplierResults] = useState<SupplierSummary[]>([]);
  const [selectedSupplier, setSelectedSupplier] =
    useState<SupplierSummary | null>(null);
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierTaxNumber, setNewSupplierTaxNumber] = useState("");
  const [newSupplierCountry, setNewSupplierCountry] = useState("");
  const [newSupplierEmail, setNewSupplierEmail] = useState("");
  const [newSupplierPhone, setNewSupplierPhone] = useState("");
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  const [viesBusy, setViesBusy] = useState(false);
  const [viesConflicts, setViesConflicts] = useState<ViesConflict[]>([]);
  const latestTaxNumber = useRef(newSupplierTaxNumber);
  latestTaxNumber.current = newSupplierTaxNumber;
  const [viesResult, setViesResult] = useState<ViesVatLookupResult | null>(
    null,
  );

  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("");
  const [supplierInvoiceNumberError, setSupplierInvoiceNumberError] =
    useState(false);
  const supplierInvoiceNumberFieldRef = useRef<HTMLDivElement>(null);
  const [currency, setCurrency] = useState(navInvoiceId ? "HUF" : "EUR");
  const [exchangeRate, setExchangeRate] = useState<number | "">("");
  const [rateLoading, setRateLoading] = useState(false);
  const [rateNotice, setRateNotice] = useState<string | null>(null);
  const [vatRate, setVatRate] = useState<number | "">(27);
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState("");
  const [isPaid, setIsPaid] = useState(false);
  const [paidAt, setPaidAt] = useState("");
  const [note, setNote] = useState("");

  const [productSearch, setProductSearch] = useState("");
  const [productSearchTargetKey, setProductSearchTargetKey] = useState<
    string | null
  >(null);
  const [productResults, setProductResults] = useState<
    PurchaseProductSearchResult[]
  >([]);
  const [searchingProducts, setSearchingProducts] = useState(false);
  const [categoryOptions, setCategoryOptions] = useState<CatalogOption[]>([]);
  const [brandOptions, setBrandOptions] = useState<CatalogOption[]>([]);
  /** Soronként: van-e már termék az új termék EAN-jével vagy cikkszámával. */
  /** #1199 P-026: soronként a javaslat, és hogy az ember elvetette-e. */
  const [lineSuggestions, setLineSuggestions] = useState<
    Record<string, SupplierLineSuggestionResult & { dismissed?: boolean }>
  >({});
  const suggestionRequested = useRef(new Set<string>());
  const clientOperationId = useRef(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `op-${Date.now()}`,
  );
  const [productConflicts, setProductConflicts] = useState<
    Record<string, PurchaseProductConflictLookup>
  >({});
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [newProjectName, setNewProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [lines, setLines] = useState<InvoiceLineState[]>([]);
  /** the manual line just added: its name field takes the focus */
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<PurchaseInvoiceResult | null>(
    null,
  );
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<{
    format: SupplierInvoiceImportFormat;
    lineCount: number;
    warnings: string[];
  } | null>(null);

  /**
   * Egy beolvasott beszállítói számla a szerkesztőbe: fejléc, szállító-adatok
   * és a sorok, termék nélkül. A fájlfeltöltés és a Várható beérkezések
   * ugyanezzel tölt, tehát a két út sorai ugyanazt a kulcsot kapják
   * (`import-{i}-{lineNumber}`), amire az érkezéskor számolt javaslat is szól.
   */
  const applySupplierInvoice = (result: SupplierInvoiceImportResult) => {
    if (result.invoiceNumber) setSupplierInvoiceNumber(result.invoiceNumber);
    if (result.invoiceDate) setInvoiceDate(result.invoiceDate);
    setDueDate(result.dueDate ?? "");
    if (result.currency) setCurrency(result.currency);
    if (result.supplier.name) setNewSupplierName(result.supplier.name);
    if (result.supplier.vatId) setNewSupplierTaxNumber(result.supplier.vatId);
    if (result.supplier.country) setNewSupplierCountry(result.supplier.country);
    // the supplier list is searched by the tax id first: a name can differ
    // between the invoice and our record, the tax id does not
    setSupplierSearch(result.supplier.vatId ?? result.supplier.name ?? "");
    setLines(
      result.lines.map((line, index) => ({
        key: `import-${index}-${line.lineNumber}`,
        variantId: null,
        createLocalProduct: null,
        sku: "",
        productName: "",
        unit: line.unit,
        sourceDescription: line.description,
        supplierSku: line.supplierSku,
        ean: line.ean,
        isCharge: line.isCharge,
        navLineNumber: null,
        orderedQuantity: line.quantity,
        actualQuantity: line.quantity,
        unitNet: line.unitNet,
        discountPercent: line.discountPercent ?? "",
        projectAllocations: [],
      })),
    );
    setImportSummary({
      format: result.format,
      lineCount: result.lines.length,
      warnings: result.warnings,
    });
  };

  /**
   * Beszállítói számlafájl betöltése (#1199 P-026). CSAK előtöltés: a
   * fejléc, a szállító adatai és a sorok kitöltődnek, a sorok termék nélkül
   * jönnek be, és semmi nem rögzül, amíg az ember nem ment.
   */
  const importSupplierFile = async (file: File) => {
    setImporting(true);
    setImportError(null);
    setImportSummary(null);
    try {
      const result: SupplierInvoiceImportResult =
        await purchasingApi.importSupplierInvoice(token, file);
      applySupplierInvoice(result);
    } catch (cause) {
      setImportError(
        cause instanceof Error ? cause.message : "A számla nem tölthető be.",
      );
    } finally {
      setImporting(false);
    }
  };

  const changeSource = (next: PurchaseInvoiceSource) => {
    setSource(next);
    setCurrency(next === "EU" ? "EUR" : "HUF");
    setSelectedSupplier((current) => {
      if (!current) return null;
      const isHungarian = current.country.trim().toUpperCase() === "HU";
      return (next === "EU" && !isHungarian) || (next !== "EU" && isHungarian)
        ? current
        : null;
    });
    setSupplierResults([]);
    const inferred = inferCountryFromTaxNumber(newSupplierTaxNumber);
    setNewSupplierCountry(
      next === "EU" && inferred && inferred !== "HU"
        ? inferred
        : next === "EU"
          ? ""
          : "HU",
    );
  };

  // NAV-alapú bevételezés előtöltése: a beszállító nevét/adószámát a
  // keresőmezőbe és a soron kívüli gyorslétrehozás mezőibe is betöltjük
  // (ha a törzsszám alapján egyértelmű, ki is választjuk; különben a
  // felhasználó választja ki a találatot vagy hozza létre egy
  // kattintással), a tételeket pedig a NAV-on szereplő megnevezéssel,
  // mennyiséggel és egységárral - ezeket írja át a saját elnevezésére és a
  // ténylegesen átvett mennyiségre a bevételezés előtt.
  useEffect(() => {
    // A teljes oldal canManage jogosultsághoz kötött (lásd lent), a token
    // önmagában nem feltétel: cookie-alapú authnál üres, az apiRequest
    // ilyenkor a httpOnly session cookie-t használja.
    if (!navInvoiceId) return;
    setSource("HU_NAV");
    setCurrency("HUF");
    setNavPrefillLoading(true);
    setNavPrefillError(null);
    void navIncomingInvoicesApi
      .detail(token, navInvoiceId)
      .then(async (detail) => {
        setNavPrefillNumber(detail.navInvoiceNumber);
        setSupplierInvoiceNumber(detail.navInvoiceNumber);
        setInvoiceDate(toDateInput(detail.invoiceIssueDate) || todayIso());
        setDueDate(toDateInput(detail.paymentDate));
        setVatRate(
          detail.suggestedVatRatePercent
            ? Number(detail.suggestedVatRatePercent)
            : 27,
        );
        setSupplierSearch(detail.supplierTaxNumber);
        setNewSupplierName(detail.supplierName);
        setNewSupplierTaxNumber(detail.supplierTaxNumber);
        setNewSupplierCountry("HU");
        setLines(
          detail.lines.map((line, index) => {
            const quantity = Number(line.quantity) || 0;
            const unitPrice =
              line.unitPrice !== undefined
                ? Number(line.unitPrice)
                : quantity > 0
                  ? Number(line.lineNetAmount) / quantity
                  : 0;
            return {
              key: `nav-${index}-${line.lineNumber}`,
              variantId: null,
              createLocalProduct: null,
              sku: "",
              productName: "",
              unit: line.unit,
              sourceDescription: line.description,
              // a NAV tétel saját (OWN) kódja és az érvényes EAN: a javaslat
              // ezekkel keres, ahogy a fájlból beolvasott számlán
              supplierSku: line.supplierSku ?? null,
              ean: line.ean ?? null,
              // a díjsor javaslatot nem kér, ahogy a fájlból beolvasott számlán
              isCharge: line.isCharge,
              navLineNumber: line.lineNumber,
              orderedQuantity: quantity,
              actualQuantity: quantity,
              unitNet: Number.isFinite(unitPrice) ? unitPrice : 0,
              discountPercent: "",
              projectAllocations: [],
            };
          }),
        );
        // A szállító a törzsben, ha az adószám törzsszáma (első 8 jegy)
        // pontosan egyre illik: kiválasztjuk, ahogy a levélből jött tételnél,
        // és ezzel a sor-javaslatok is elindulnak. Ha nincs meg, marad a
        // keresőmező és a gyorslétrehozás.
        if (detail.supplierId) {
          const supplier = await suppliersApi
            .detail(token, detail.supplierId)
            .catch(() => null);
          if (supplier) setSelectedSupplier(supplier);
        }
      })
      .catch((cause: unknown) =>
        setNavPrefillError(
          cause instanceof Error
            ? cause.message
            : "A NAV számla adatai nem tölthetők be.",
        ),
      )
      .finally(() => setNavPrefillLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navInvoiceId, token]);

  /*
    VÁRHATÓ BEÉRKEZÉS ELŐTÖLTÉSE (?beerkezes=<id>): a levélből érkezéskor
    beolvasott számla, ugyanúgy, mint egy feltöltött fájl. Ha a beszállító
    adószámmal ismert, ki is választjuk. Az érkezéskor számolt sor-javaslatok
    a sorokra kerülnek, a saját audit-futásukkal együtt, és ezekre a sorokra
    NEM kérünk újat: a mentés ezeket a futásokat zárja le.
  */
  useEffect(() => {
    if (!arrivalId) return;
    setSource("EU");
    setArrivalPrefillLoading(true);
    setArrivalPrefillError(null);
    void expectedArrivalsApi
      .detail(token, arrivalId)
      .then(async (detail) => {
        applySupplierInvoice(detail.importResult);
        const kept = detail.lineSuggestions.filter(
          (answer) => answer.result.enabled,
        );
        for (const answer of detail.lineSuggestions)
          suggestionRequested.current.add(answer.lineKey);
        setLineSuggestions(
          Object.fromEntries(
            kept.map((answer) => [answer.lineKey, answer.result]),
          ),
        );
        setLines((current) =>
          current.map((line) => {
            const answer = kept.find(
              (candidate) => candidate.lineKey === line.key,
            );
            return answer?.result.decisionRunId
              ? { ...line, decisionRunId: answer.result.decisionRunId }
              : line;
          }),
        );
        setArrivalPrefill({
          fileName: detail.fileName,
          orderReference: detail.orderReference,
        });
        if (detail.supplierId) {
          const supplier = await suppliersApi
            .detail(token, detail.supplierId)
            .catch(() => null);
          if (supplier) setSelectedSupplier(supplier);
        }
      })
      .catch((cause: unknown) =>
        setArrivalPrefillError(
          cause instanceof Error
            ? cause.message
            : "A várható beérkezés nem tölthető be.",
        ),
      )
      .finally(() => setArrivalPrefillLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivalId, token]);

  useEffect(() => {
    void purchasingApi
      .listProjects(token)
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [token]);

  useEffect(() => {
    if (!supplierSearch.trim()) {
      setSupplierResults([]);
      return;
    }
    const debouncer = createDebouncer((value: string) => {
      void suppliersApi
        .search(token, value, isDomestic ? "DOMESTIC" : "EU")
        .then((response) =>
          setSupplierResults(
            response.items.filter((supplier) => {
              const isHungarian =
                supplier.country.trim().toUpperCase() === "HU";
              return isDomestic ? isHungarian : !isHungarian;
            }),
          ),
        )
        .catch(() => setSupplierResults([]));
    }, 300);
    debouncer.schedule(supplierSearch);
    return () => debouncer.cancel();
  }, [supplierSearch, token, isDomestic]);

  useEffect(() => {
    if (!productSearch.trim()) {
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
    if (!canManage) return;
    void productApi
      .categoryOptions(token)
      .then(setCategoryOptions)
      .catch(() => setCategoryOptions([]));
    void productApi
      .brandOptions(token)
      .then(setBrandOptions)
      .catch(() => setBrandOptions([]));
  }, [canManage, token]);

  useEffect(() => {
    // Belföldi (HU_MANUAL/HU_NAV) számlánál nincs MNB-lekérdezés: a
    // pénznem mindig HUF, az árfolyam mező nem értelmezett.
    if (isDomestic) {
      setExchangeRate("");
      setRateNotice(null);
      return;
    }
    if (!invoiceDate) return;
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
  }, [currency, invoiceDate, token, isDomestic]);

  const addLine = (product: PurchaseProductSearchResult) => {
    if (productSearchTargetKey) {
      setLines((previous) =>
        previous.map((line) =>
          line.key === productSearchTargetKey
            ? {
                ...line,
                variantId: product.variantId,
                createLocalProduct: null,
                sku: product.sku,
                productName: product.productName,
                unit: product.unit,
              }
            : line,
        ),
      );
      setProductSearchTargetKey(null);
      setProductSearch("");
      setProductResults([]);
      return;
    }
    setLines((previous) => [
      ...previous,
      {
        key: `${product.variantId}-${previous.length}-${Date.now()}`,
        variantId: product.variantId,
        createLocalProduct: null,
        sku: product.sku,
        productName: product.productName,
        unit: product.unit,
        sourceDescription: "",
        navLineNumber: null,
        orderedQuantity: 1,
        actualQuantity: 1,
        unitNet: product.lastPurchaseNetPrice
          ? Number(product.lastPurchaseNetPrice)
          : 0,
        discountPercent: "",
        projectAllocations: [],
      },
    ]);
    setProductSearch("");
    setProductResults([]);
  };

  const addManualLine = () => {
    const key = `manual-${lines.length}-${Date.now()}`;
    setFocusKey(key);
    setLines((previous) => [
      ...previous,
      {
        key,
        variantId: null,
        createLocalProduct: null,
        sku: "",
        productName: "",
        unit: "",
        sourceDescription: "",
        navLineNumber: null,
        orderedQuantity: 1,
        actualQuantity: 1,
        unitNet: 0,
        discountPercent: "",
        projectAllocations: [],
      },
    ]);
  };

  const updateLine = (key: string, patch: Partial<InvoiceLineState>) => {
    setLines((previous) =>
      previous.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  };

  const createProject = async () => {
    const name = newProjectName.trim();
    if (name.length < 2 || creatingProject) return;
    setCreatingProject(true);
    setError(null);
    try {
      const project = await purchasingApi.createProject(token, { name });
      setProjects((previous) =>
        [...previous, project].sort((left, right) =>
          left.name.localeCompare(right.name, "hu"),
        ),
      );
      setNewProjectName("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A projekt létrehozása nem sikerült.",
      );
    } finally {
      setCreatingProject(false);
    }
  };

  const addProjectAllocation = (line: InvoiceLineState) => {
    const usedIds = new Set(
      line.projectAllocations.map((allocation) => allocation.projectId),
    );
    const firstAvailable = projects.find((project) => !usedIds.has(project.id));
    updateLine(line.key, {
      projectAllocations: [
        ...line.projectAllocations,
        {
          key: `allocation-${line.key}-${Date.now()}`,
          projectId: firstAvailable?.id ?? "",
          quantity: Math.max(0, line.actualQuantity - allocatedQuantity(line)),
        },
      ],
    });
  };

  const updateProjectAllocation = (
    line: InvoiceLineState,
    allocationKey: string,
    patch: Partial<InvoiceLineState["projectAllocations"][number]>,
  ) => {
    updateLine(line.key, {
      projectAllocations: line.projectAllocations.map((allocation) =>
        allocation.key === allocationKey
          ? { ...allocation, ...patch }
          : allocation,
      ),
    });
  };

  const removeProjectAllocation = (
    line: InvoiceLineState,
    allocationKey: string,
  ) => {
    updateLine(line.key, {
      projectAllocations: line.projectAllocations.filter(
        (allocation) => allocation.key !== allocationKey,
      ),
    });
  };

  const beginExistingProductLink = (line: InvoiceLineState) => {
    setProductSearchTargetKey(line.key);
    setProductSearch(line.sourceDescription || line.productName);
  };

  /**
   * #1199 P-026: a termék nélküli, nem díj-sorokhoz egyszer kér javaslatot,
   * amint a szállító ki van választva. A javaslat csak felajánl; a
   * szerver kapcsolói döntik el, fut-e egyáltalán.
   */
  useEffect(() => {
    if (!canManage || !selectedSupplier) return;
    const pending = lines.filter(
      (line) =>
        !line.variantId &&
        !line.createLocalProduct &&
        !line.isCharge &&
        line.sourceDescription.trim() &&
        !suggestionRequested.current.has(line.key),
    );
    if (pending.length === 0) return;
    for (const line of pending) suggestionRequested.current.add(line.key);
    // NOT cancelled when `lines` changes: every answer updates a line, and a
    // cancel there would drop the requests still queued behind it.
    void (async () => {
      for (const line of pending) {
        try {
          const result = await purchasingApi.suggestLine(token, {
            clientOperationId: clientOperationId.current,
            lineKey: line.key,
            supplierId: selectedSupplier.id,
            description: line.sourceDescription,
            supplierSku: line.supplierSku ?? undefined,
            ean: line.ean ?? undefined,
          });
          if (!result.enabled) return; // off for this supplier: ask no more
          setLineSuggestions((current) => ({ ...current, [line.key]: result }));
          if (result.decisionRunId)
            updateLine(line.key, { decisionRunId: result.decisionRunId });
        } catch {
          // no suggestion is an answer; the line is linked by hand as today
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, selectedSupplier, lines, token]);

  const acceptSuggestion = (key: string) => {
    const suggestion = lineSuggestions[key]?.suggestion;
    if (!suggestion) return;
    updateLine(key, {
      variantId: suggestion.variantId,
      sku: suggestion.sku,
      productName: suggestion.productName,
      createLocalProduct: null,
    });
  };

  const dismissSuggestion = (key: string) =>
    setLineSuggestions((current) => ({
      ...current,
      [key]: { ...current[key]!, dismissed: true },
    }));

  const beginLocalProductCreation = (line: InvoiceLineState) => {
    if (productSearchTargetKey === line.key) {
      setProductSearchTargetKey(null);
      setProductSearch("");
      setProductResults([]);
    }
    const localProduct = {
      name: line.sourceDescription,
      primaryCategoryId: "",
      brandId: "",
      vatRate: 27 as number | "",
      ean: line.ean ?? "",
      supplierSku: line.supplierSku ?? "",
      webshopDraft: false,
    };
    updateLine(line.key, {
      variantId: null,
      sku: "",
      productName: "",
      createLocalProduct: localProduct,
    });
    void checkProductConflicts(line.key, localProduct);
  };

  /**
   * Új termék felvétele ELŐTT (#1199 P-026): ha az EAN vagy a beszállítói
   * cikkszám már egy meglévő termékhez tartozik, a termék nem új. A mentést
   * a szerver is megtagadja; itt korábban szólunk, és felajánljuk a kötést.
   */
  const checkProductConflicts = async (
    key: string,
    product: { ean: string; supplierSku: string },
  ) => {
    const ean = product.ean.trim();
    const supplierSku = product.supplierSku.trim();
    if (!ean && !(supplierSku && selectedSupplier)) {
      setProductConflicts(({ [key]: _gone, ...rest }) => rest);
      return;
    }
    try {
      const found = await purchasingApi.productConflicts(token, {
        ean: ean || undefined,
        supplierId: selectedSupplier?.id,
        supplierSku: supplierSku || undefined,
      });
      setProductConflicts((current) => ({ ...current, [key]: found }));
    } catch {
      // the server checks again on save; a failed lookup is not a verdict
    }
  };

  const linkToExisting = (
    key: string,
    owner: { variantId: string; sku: string; productName: string },
  ) => {
    updateLine(key, {
      variantId: owner.variantId,
      sku: owner.sku,
      productName: owner.productName,
      createLocalProduct: null,
    });
    setProductConflicts(({ [key]: _gone, ...rest }) => rest);
  };

  const updateOrderedQuantity = (key: string, value: number) => {
    // A rendelt mennyiség beírásakor automatikusan a tényleges (átvett)
    // mennyiséghez is bemásoljuk - eltérés esetén ezt utána külön
    // módosíthatod a Tényleges mezőben.
    updateLine(key, { orderedQuantity: value, actualQuantity: value });
  };

  const removeLine = (key: string) => {
    if (productSearchTargetKey === key) {
      setProductSearchTargetKey(null);
      setProductSearch("");
      setProductResults([]);
    }
    setLines((previous) => previous.filter((line) => line.key !== key));
  };

  const totalNet = lines.reduce((sum, line) => sum + lineNet(line), 0);
  const effectiveCurrency = isDomestic ? "HUF" : currency.trim().toUpperCase();

  const createSupplier = async () => {
    if (!newSupplierName.trim() || creatingSupplier) return;
    const inferredCountry = inferCountryFromTaxNumber(newSupplierTaxNumber);
    const supplierCountry = isDomestic
      ? "HU"
      : inferredCountry && inferredCountry !== "HU"
        ? inferredCountry
        : undefined;
    if (!supplierCountry) {
      setError(
        "EU-s beszállítónál adj meg országkóddal kezdődő közösségi adószámot (például DE123456789).",
      );
      return;
    }
    setCreatingSupplier(true);
    setError(null);
    try {
      const created = await suppliersApi.create(token, {
        name: newSupplierName.trim(),
        taxNumber: newSupplierTaxNumber.trim() || undefined,
        country: supplierCountry,
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

  /**
   * THE VIES NAME INTO THE NEW SUPPLIER (card 600575a0). This form has no
   * address fields, and the country follows the tax number at creation, so
   * only the name is filled: when empty; another typed name is offered.
   */
  const checkVies = async () => {
    if (!newSupplierTaxNumber.trim() || viesBusy) return;
    setViesBusy(true);
    setViesResult(null);
    setViesConflicts([]);
    try {
      const asked = newSupplierTaxNumber.trim();
      const result = await viesVatApi.check(token, asked);
      // the number was changed while VIES answered: this answer is not its
      if (latestTaxNumber.current.trim() !== asked) return;
      setViesResult(result);
      if (result.valid) {
        const { fill, conflicts } = viesFill(
          { name: newSupplierName },
          { name: result.name, taxNumber: newSupplierTaxNumber },
        );
        if (fill.name) setNewSupplierName(fill.name);
        setViesConflicts(conflicts);
      }
    } catch (cause) {
      setViesResult({
        message:
          cause instanceof Error
            ? cause.message
            : "A VIES ellenőrzés nem sikerült.",
      });
    } finally {
      setViesBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!supplierInvoiceNumber.trim()) {
      setSupplierInvoiceNumberError(true);
      supplierInvoiceNumberFieldRef.current?.querySelector("input")?.focus();
      return;
    }
    setSupplierInvoiceNumberError(false);
    if (!selectedSupplier) {
      setError("Válassz ki egy beszállítót, vagy hozz létre újat.");
      return;
    }
    if (!effectiveCurrency) {
      setError("A pénznem megadása kötelező.");
      return;
    }
    if (isDomestic && vatRate === "") {
      setError("Belföldi számlánál az ÁFA-kulcs megadása kötelező.");
      return;
    }
    if (lines.length === 0) {
      setError("Legalább egy tétel szükséges a számlához.");
      return;
    }
    for (const line of lines) {
      if (
        !line.variantId &&
        !line.createLocalProduct &&
        !line.sourceDescription.trim()
      ) {
        setError(
          "A terméktörzsben nem szereplő tételeknél a számlán szereplő megnevezés megadása kötelező.",
        );
        return;
      }
      if (!line.unit.trim()) {
        setError("Az egység megadása minden tételnél kötelező.");
        return;
      }
      if (line.createLocalProduct) {
        if (line.createLocalProduct.name.trim().length < 2) {
          setError("Az új helyi termék neve legalább 2 karakter legyen.");
          return;
        }
      }
      const usedProjectIds = new Set<string>();
      for (const allocation of line.projectAllocations) {
        if (!allocation.projectId) {
          setError("Válassz projektet minden projektfoglaláshoz.");
          return;
        }
        if (usedProjectIds.has(allocation.projectId)) {
          setError(
            "Egy számlasoron ugyanaz a projekt csak egyszer szerepelhet.",
          );
          return;
        }
        usedProjectIds.add(allocation.projectId);
        if (!Number.isFinite(allocation.quantity) || allocation.quantity <= 0) {
          setError(
            "A projektfoglalás mennyiségének nullánál nagyobbnak kell lennie.",
          );
          return;
        }
      }
      if (allocatedQuantity(line) > line.actualQuantity) {
        setError(
          "A projektekhez rendelt összmennyiség nem lehet több a ténylegesen bevételezett mennyiségnél.",
        );
        return;
      }
    }
    setSubmitting(true);
    setLastResult(null);
    try {
      const result = await purchasingApi.create(token, {
        source,
        supplierId: selectedSupplier.id,
        supplierInvoiceNumber: supplierInvoiceNumber.trim(),
        currency: effectiveCurrency,
        exchangeRate:
          !isDomestic && exchangeRate !== "" ? Number(exchangeRate) : undefined,
        vatRate: isDomestic && vatRate !== "" ? Number(vatRate) : undefined,
        invoiceDate: new Date(invoiceDate).toISOString(),
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        isPaid,
        paidAt: isPaid && paidAt ? new Date(paidAt).toISOString() : undefined,
        note: note.trim() || undefined,
        navIncomingInvoiceId: navInvoiceId,
        expectedArrivalId: arrivalId,
        lines: lines.map((line) => ({
          variantId: line.variantId ?? undefined,
          createLocalProduct: line.createLocalProduct
            ? {
                name: line.createLocalProduct.name.trim(),
                primaryCategoryId:
                  line.createLocalProduct.primaryCategoryId || undefined,
                brandId: line.createLocalProduct.brandId || undefined,
                vatRate:
                  line.createLocalProduct.vatRate === ""
                    ? undefined
                    : line.createLocalProduct.vatRate,
                ean: line.createLocalProduct.ean.trim() || undefined,
                supplierSku:
                  line.createLocalProduct.supplierSku.trim() || undefined,
                webshopDraft: line.createLocalProduct.webshopDraft,
              }
            : undefined,
          sourceDescription: line.sourceDescription.trim() || undefined,
          navLineNumber: line.navLineNumber ?? undefined,
          decisionRunId: line.decisionRunId ?? undefined,
          // the supplier's code of a line linked to one of our products:
          // saved, it becomes the mapping the next invoice finds first
          supplierSku:
            line.variantId && line.supplierSku ? line.supplierSku : undefined,
          orderedQuantity: line.orderedQuantity,
          actualQuantity: line.actualQuantity,
          unit: line.unit,
          unitNet: line.unitNet,
          discountPercent:
            line.discountPercent === ""
              ? undefined
              : Number(line.discountPercent),
          projectAllocations: line.projectAllocations.map((allocation) => ({
            projectId: allocation.projectId,
            quantity: allocation.quantity,
          })),
        })),
      });
      // Nem navigálunk el azonnal: meg kell mutatni, hány tétel készlete
      // lett helyileg lekönyvelve. A tényleges UNAS-push mostantól mindig
      // a háttérben, ettől a hívástól függetlenül fut (lásd
      // purchase-invoice.repository.ts create()) - itt már nincs
      // szinkron siker/hiba, amit meg kellene jeleníteni.
      setLastResult(result);
      setLines([]);
      setImportSummary(null);
      setProductSearchTargetKey(null);
      setProductSearch("");
      setProductResults([]);
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

  /** A projektfoglalás sávjának szövege: szabad készlet és a foglalások. */
  const allocationSummary = (line: InvoiceLineState) => {
    const free = Math.max(0, line.actualQuantity - allocatedQuantity(line));
    const reserved = line.projectAllocations
      .filter(
        (allocation) => allocation.projectId && Number(allocation.quantity) > 0,
      )
      .map(
        (allocation) =>
          `${
            projects.find((project) => project.id === allocation.projectId)
              ?.projectNumber ?? "Projekt"
          }: ${allocation.quantity} ${line.unit} foglalva`,
      );
    return reserved.length
      ? `Szabad raktárkészlet ebből a sorból: ${free} ${line.unit} · ${reserved.join(" · ")}`
      : `Nincs projektfoglalás · szabad készlet: ${free} ${line.unit}`;
  };

  const pageTitle = navInvoiceId
    ? "Belföldi számla bevételezése (NAV)"
    : isDomestic
      ? "Új belföldi beszerzési számla"
      : "Új EU-s beszerzési számla";
  const pageDescription = navInvoiceId
    ? "A NAV Online Számla rendszerből lekérdezett belföldi számla bevételezése."
    : isDomestic
      ? "Belföldi beszállítói számla kézi rögzítése, tételes bevételezéssel."
      : "Beérkezett EU-n belüli beszállítói számla rögzítése, tételes bevételezéssel.";

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <PilotPageHeader
        title={pageTitle}
        description={pageDescription}
        actions={
          <PilotButton
            size="regular"
            variant="secondary"
            onClick={() =>
              router.push(
                navInvoiceId
                  ? `/beszerzes/nav-szamlak/${navInvoiceId}`
                  : "/beszerzes",
              )
            }
          >
            <span aria-hidden="true">←</span>
            {navInvoiceId ? "Vissza a NAV számlához" : "Vissza a listához"}
          </PilotButton>
        }
      />

      {/*
        A FORRÁS VÁLASZTÓJA (Direction F, a Beszerzés-brief 7. pontja): nem
        dísz, a meglévő `changeSource` állítja a devizát, az MNB-t és a
        belföldi ÁFA-logikát, ahogy eddig.
      */}
      {!navInvoiceId ? (
        <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-pilot-grey-200 bg-white p-4">
          <div className="flex flex-wrap gap-2">
            <PilotButton
              size="regular"
              variant={source === "EU" ? "primary" : "secondary"}
              onClick={() => changeSource("EU")}
            >
              EU-s beszerzés
            </PilotButton>
            <PilotButton
              size="regular"
              variant={source === "HU_MANUAL" ? "primary" : "secondary"}
              onClick={() => changeSource("HU_MANUAL")}
            >
              Belföldi (kézi)
            </PilotButton>
          </div>
          <p className="min-w-0 flex-1 text-xs leading-5 text-pilot-grey-500">
            A forrás határozza meg a devizát, az MNB-árfolyamot és a belföldi
            ÁFA-logikát.
          </p>
          <PilotBadge variant={source === "EU" ? "blue" : "grey"}>
            {source === "EU" ? "EU" : "Belföldi"}
          </PilotBadge>
        </section>
      ) : null}

      {!navInvoiceId && !arrivalId && source === "EU" ? (
        <PilotCallout
          tone="warm"
          title="Beszállítói számla betöltése fájlból"
          description={
            lines.length > 0
              ? "Betölteni csak üres tétellistára lehet: előbb távolítsd el a meglévő sorokat."
              : "XML vagy ismert PDF. Kitölti a fejlécet, a szállító adatait és a sorokat; semmi nem rögzül, amíg nem mentesz."
          }
          action={
            /*
              A FÁJLVÁLASZTÓ EGY GOMBNAK LÁTSZÓ CÍMKE, a mező maga láthatatlan,
              de a neve ("Beszállítói számla fájl") és a letiltása a régi.
            */
            <label
              className={`inline-flex h-10 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-md bg-white px-4 text-sm font-semibold leading-none text-pilot-grey-900 ring-1 ring-pilot-grey-200 hover:bg-pilot-grey-50 focus-within:ring-2 focus-within:ring-pilot-aqua-500 ${
                importing || lines.length > 0
                  ? "cursor-not-allowed opacity-40"
                  : ""
              }`}
            >
              <input
                type="file"
                accept=".xml,.pdf,application/pdf,application/xml,text/xml"
                aria-label="Beszállítói számla fájl"
                disabled={importing || lines.length > 0}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void importSupplierFile(file);
                }}
                className="sr-only"
              />
              {importing ? "Betöltés…" : "Fájl kiválasztása"}
            </label>
          }
        />
      ) : null}

      {importError ? (
        <Alert
          variant="danger"
          title="A számla nem tölthető be"
          description={importError}
        />
      ) : null}

      {importSummary ? (
        <Alert
          variant="info"
          title={
            importSummary.format === "PDF"
              ? "PDF-ből olvasva, ellenőrizendő"
              : "Számla betöltve XML-ből"
          }
          description={[
            `${importSummary.lineCount} sor betöltve. Kösd a sorokat a saját termékeidhez, vagy hozd létre őket újként.`,
            ...importSummary.warnings,
          ].join(" ")}
        />
      ) : null}

      {arrivalPrefillLoading ? (
        <Card className="p-5">
          <Skeleton className="h-4 w-1/3" />
        </Card>
      ) : null}

      {arrivalPrefillError ? (
        <Alert
          variant="danger"
          title="A várható beérkezés nem tölthető be"
          description={arrivalPrefillError}
        />
      ) : null}

      {arrivalPrefill && !arrivalPrefillLoading ? (
        <Alert
          variant="info"
          title="Várható beérkezésből előtöltve"
          description={`A levélből érkezett számla: ${arrivalPrefill.fileName}${
            arrivalPrefill.orderReference
              ? `, rendelés: ${arrivalPrefill.orderReference}`
              : ""
          }. Kösd a sorokat a saját termékeidhez, és add meg a ténylegesen beérkezett mennyiséget. Mentés után a tétel lekerül a Várható beérkezések listájáról.`}
        />
      ) : null}

      {navPrefillLoading ? (
        <Card className="p-5">
          <Skeleton className="h-4 w-1/3" />
        </Card>
      ) : null}

      {navPrefillError ? (
        <Alert
          variant="danger"
          title="A NAV számla nem tölthető be"
          description={navPrefillError}
        />
      ) : null}

      {navPrefillNumber && !navPrefillLoading ? (
        <Alert
          variant="info"
          title="NAV számla alapján előtöltve"
          description={`Számlaszám: ${navPrefillNumber}. Ellenőrizd/írd át a tételek megnevezését a saját termékneveidre, és add meg a ténylegesen beérkezett mennyiséget.`}
        />
      ) : null}

      {error ? (
        <Alert
          variant="danger"
          title="A művelet nem sikerült"
          description={error}
        />
      ) : null}

      {lastResult ? (
        <Alert
          variant="info"
          title={`Számla rögzítve: ${lastResult.detail.documentNumber}`}
          description={`Készlet helyileg lekönyvelve ${lastResult.successCount} tételnél. Létrejött ${lastResult.localProductCreatedCount} helyi termék és ${lastResult.projectReservationCount} projektfoglalás; ${lastResult.unasQueuedCount} UNAS-termék szabad készletének szinkronja került sorba.${
            lastResult.supplierCodesLearned > 0
              ? ` ${lastResult.supplierCodesLearned} szállítói cikkszám a termékéhez kötve ennél a szállítónál.`
              : ""
          }`}
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
      {lastResult && lastResult.supplierCodeConflicts.length > 0 ? (
        <Alert
          variant="danger"
          title="Szállítói cikkszám, amit a rendszer nem kötött a termékhez"
          description={lastResult.supplierCodeConflicts
            .map((conflict) =>
              conflict.reason === "CODE_ON_OTHER_PRODUCT"
                ? `${conflict.supplierSku}: ennél a szállítónál már egy másik termékhez tartozik (${conflict.otherProductName ?? "?"}), nem ehhez (${conflict.productName}).`
                : `${conflict.supplierSku}: a(z) ${conflict.productName} termékhez ennél a szállítónál már a(z) ${conflict.otherSupplierSku ?? "?"} kód tartozik.`,
            )
            .join("\n")}
        />
      ) : null}

      <form className="space-y-6" onSubmit={submit}>
        {/*
          A BESZÁLLÍTÓ ÉS A SZÁMLA ADATAI EGYMÁS MELLETT (Figma 302:64), közös
          kezdőponttal; szűkebb képernyőn egymás alá törnek.
        */}
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <PilotSection
            title="Beszállító"
            subtitle={
              isDomestic
                ? "Belföldi beszerzésnél csak magyarországi partnerek jelennek meg."
                : "EU-s beszerzésnél csak nem-HU partnerek jelennek meg."
            }
          >
            {selectedSupplier ? (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-pilot-grey-100 p-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-pilot-grey-900">
                    {selectedSupplier.name}
                  </p>
                  <p className="text-xs text-pilot-grey-500">
                    {selectedSupplier.code}
                    {selectedSupplier.taxNumber
                      ? ` · ${selectedSupplier.taxNumber}`
                      : ""}{" "}
                    · {selectedSupplier.country}
                  </p>
                </div>
                <PilotButton
                  size="action"
                  variant="secondary"
                  onClick={() => setSelectedSupplier(null)}
                >
                  Módosítás
                </PilotButton>
              </div>
            ) : (
              <div className="space-y-3">
                <Input
                  aria-label="Beszállító keresése"
                  value={supplierSearch}
                  onChange={(event) => setSupplierSearch(event.target.value)}
                  placeholder="Beszállító neve, adószáma…"
                  leadingIcon={<Icon name="search" size={17} />}
                />
                {supplierResults.length > 0 ? (
                  <Card className="divide-y divide-dusk-100 overflow-hidden">
                    {supplierResults.map((supplier) => (
                      <button
                        key={supplier.id}
                        type="button"
                        onClick={() => {
                          setSelectedSupplier(supplier);
                          setSupplierResults([]);
                        }}
                        className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-dusk-50"
                      >
                        <span className="font-medium text-dusk-900">
                          {supplier.name}
                        </span>
                        <span className="text-xs text-dusk-500">
                          {supplier.country}
                        </span>
                      </button>
                    ))}
                  </Card>
                ) : null}
                {!showNewSupplier ? (
                  <PilotButton
                    size="regular"
                    variant="secondary"
                    onClick={() => setShowNewSupplier(true)}
                  >
                    Új beszállító létrehozása
                  </PilotButton>
                ) : (
                  <div className="space-y-3 rounded-lg border border-dusk-200 p-3">
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
                      <FormField
                        label={isDomestic ? "Adószám" : "Közösségi adószám"}
                      >
                        <div className="flex gap-2">
                          <Input
                            aria-label="Adószám"
                            value={newSupplierTaxNumber}
                            onChange={(event) => {
                              const value = event.target.value;
                              setNewSupplierTaxNumber(value);
                              setViesResult(null);
                              setViesConflicts([]);
                              if (!isDomestic) {
                                const inferred =
                                  inferCountryFromTaxNumber(value);
                                setNewSupplierCountry(
                                  inferred && inferred !== "HU" ? inferred : "",
                                );
                              }
                            }}
                            placeholder={
                              isDomestic ? "12345678-2-13" : "DE123456789"
                            }
                          />
                          {!isDomestic ? (
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={
                                !newSupplierTaxNumber.trim() || viesBusy
                              }
                              onClick={() => void checkVies()}
                            >
                              {viesBusy ? "Ellenőrzés…" : "VIES"}
                            </Button>
                          ) : null}
                        </div>
                        {!isDomestic && viesResult ? (
                          viesResult.valid === undefined ? (
                            <p className="mt-1 text-xs text-amber-600">
                              {viesResult.message}
                            </p>
                          ) : (
                            <div className="mt-1 flex items-center gap-2">
                              <Badge
                                variant={
                                  viesResult.valid ? "success" : "danger"
                                }
                              >
                                {viesResult.valid ? "Érvényes" : "Érvénytelen"}
                              </Badge>
                              {viesResult.valid &&
                              (viesResult.name || viesResult.address) ? (
                                <span className="text-xs text-dusk-500">
                                  {[viesResult.name, viesResult.address]
                                    .filter(Boolean)
                                    .join(" - ")}
                                </span>
                              ) : null}
                            </div>
                          )
                        ) : null}
                        {!isDomestic ? (
                          <ViesMissingDetails
                            taxNumber={newSupplierTaxNumber}
                            result={viesResult}
                          />
                        ) : null}
                        <ViesConflicts
                          conflicts={viesConflicts}
                          onApply={(taken) => {
                            const name = taken.find((c) => c.field === "name");
                            if (name) setNewSupplierName(name.vies);
                            setViesConflicts((all) =>
                              all.filter((c) => !taken.includes(c)),
                            );
                          }}
                        />
                      </FormField>
                      <FormField label="Ország (ISO kód)">
                        <Input
                          aria-label="Ország"
                          value={newSupplierCountry}
                          maxLength={2}
                          disabled
                          placeholder={isDomestic ? "HU" : "Adószámból"}
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
                        disabled={
                          !newSupplierName.trim() ||
                          (!isDomestic && !newSupplierCountry) ||
                          creatingSupplier
                        }
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
          </PilotSection>

          <PilotSection
            title="Számla adatai"
            subtitle="A rögzített adatok a beszerzés és a készletmozgás alapjai."
          >
            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              <FormField
                label="Számlaszám"
                error={
                  supplierInvoiceNumberError
                    ? "A számlaszám megadása kötelező."
                    : undefined
                }
              >
                <div ref={supplierInvoiceNumberFieldRef}>
                  <Input
                    aria-label="Számlaszám"
                    aria-invalid={supplierInvoiceNumberError}
                    value={supplierInvoiceNumber}
                    placeholder={
                      supplierInvoiceNumberError
                        ? "A számlaszám megadása kötelező."
                        : undefined
                    }
                    className={
                      supplierInvoiceNumberError
                        ? "border-rose-500 focus:border-rose-500 focus:ring-rose-500/15"
                        : undefined
                    }
                    onChange={(event) => {
                      setSupplierInvoiceNumber(event.target.value);
                      if (event.target.value.trim())
                        setSupplierInvoiceNumberError(false);
                    }}
                  />
                </div>
              </FormField>
              <FormField label="Pénznem">
                <Input
                  aria-label="Pénznem"
                  value={effectiveCurrency}
                  maxLength={3}
                  disabled={isDomestic}
                  onChange={(event) =>
                    setCurrency(event.target.value.toUpperCase())
                  }
                />
              </FormField>
              {isDomestic ? (
                <FormField label="ÁFA-kulcs (%)">
                  <Input
                    aria-label="ÁFA-kulcs"
                    type="number"
                    step="any"
                    min={0}
                    max={100}
                    value={vatRate}
                    onChange={(event) =>
                      setVatRate(
                        event.target.value === ""
                          ? ""
                          : Number(event.target.value),
                      )
                    }
                  />
                </FormField>
              ) : (
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
                        event.target.value === ""
                          ? ""
                          : Number(event.target.value),
                      )
                    }
                  />
                  {rateLoading ? (
                    <p className="mt-1 text-xs text-dusk-500">
                      Árfolyam lekérdezése…
                    </p>
                  ) : rateNotice ? (
                    <p className="mt-1 text-xs text-dusk-500">{rateNotice}</p>
                  ) : null}
                </FormField>
              )}
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
          </PilotSection>
        </div>

        <PilotSection
          title="Tételek"
          subtitle="A számlasorokat meglévő termékhez kötheted, új helyi termékként létrehozhatod, vagy terméktörzs nélkül rögzítheted."
          bodyClassName="space-y-4 px-5 py-5"
        >
          {/*
            A PROJEKTKÉSZLET (a brief 11. pontja): a színt a callout adja, a
            szöveg-tartó átlátszó; a mező és a gomb jobb oldalon marad, a
            szöveg rugalmas és tördel.
          */}
          <PilotCallout
            tone="aqua"
            title="Projektkészlet"
            description="A projekthez rendelt mennyiség készleten marad, de azonnal foglalt; nem számít eladható készletnek, és nem kerül az UNAS szabad készletébe."
            action={
              <>
                <div className="w-56">
                  <PilotInput
                    aria-label="Új projekt neve"
                    value={newProjectName}
                    onChange={setNewProjectName}
                    placeholder="Új projekt neve…"
                    className="h-10"
                  />
                </div>
                <PilotButton
                  size="regular"
                  variant="secondary"
                  disabled={newProjectName.trim().length < 2 || creatingProject}
                  onClick={() => void createProject()}
                >
                  {creatingProject ? "Létrehozás…" : "Projekt létrehozása"}
                </PilotButton>
              </>
            }
          />
          <div>
            <p className="mb-2 text-xs text-pilot-grey-500">
              Termék kapcsolása a számlasorhoz
            </p>
            {productSearchTargetKey ? (
              <div className="mb-2 flex items-center justify-between rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">
                <span>A kiválasztott számlasorhoz keresel terméket.</span>
                <button
                  type="button"
                  className="font-semibold hover:underline"
                  onClick={() => {
                    setProductSearchTargetKey(null);
                    setProductSearch("");
                    setProductResults([]);
                  }}
                >
                  Mégse
                </button>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-[240px] flex-1">
                <PilotInput
                  aria-label="Termék keresése"
                  value={productSearch}
                  onChange={setProductSearch}
                  placeholder="Cikkszám vagy terméknév…"
                  leadingIcon={<Icon name="search" size={17} />}
                  className="h-10"
                />
              </div>
              <PilotButton
                size="regular"
                variant="secondary"
                title="Olyan tétel, ami nincs a terméktörzsben."
                onClick={addManualLine}
              >
                Kézi tétel felvétele
              </PilotButton>
            </div>
            {searchingProducts ? <Skeleton className="mt-2 h-4 w-1/3" /> : null}
            {productResults.length > 0 ? (
              <Card className="mt-2 divide-y divide-dusk-100 overflow-hidden">
                {productResults.map((product) => (
                  <button
                    key={product.variantId}
                    type="button"
                    onClick={() => addLine(product)}
                    className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-dusk-50"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-dusk-900">
                          {product.productName}
                        </p>
                        <Badge
                          variant={
                            product.origin === "UNAS" ? "info" : "neutral"
                          }
                        >
                          {product.origin === "UNAS"
                            ? "UNAS-termék"
                            : product.origin === "LOCAL"
                              ? "Helyi termék"
                              : "Ismeretlen eredet"}
                        </Badge>
                      </div>
                      <p className="font-mono text-xs text-dusk-500">
                        {product.sku}
                      </p>
                    </div>
                    <p className="text-xs text-dusk-500">
                      Készlet: {product.currentStock} {product.unit}
                    </p>
                  </button>
                ))}
              </Card>
            ) : null}
          </div>

          {lines.length === 0 ? (
            <p className="text-sm text-pilot-grey-500">
              Még nincs felvett tétel. Keress rá egy termékre, vagy vegyél fel
              egy kézi tételt.
            </p>
          ) : (
            <div className="space-y-3">
              {/*
                A FEJLÉC ÉS A SOR UGYANAZT AZ OSZLOPRÁCSOT HASZNÁLJA (a brief 13.
                pontja): a `LINE_GRID`-et. Nagy képernyőn a fejléc adja a mezők
                nevét (a mezők címkéje ilyenkor csak a képernyőolvasónak szól),
                kisebben a mezők saját címkéje.
              */}
              <div
                aria-hidden="true"
                className={`hidden rounded-lg border border-transparent bg-pilot-grey-100 px-4 py-2.5 text-[11px] font-semibold uppercase leading-4 tracking-[0.05em] text-pilot-grey-500 lg:grid ${LINE_GRID}`}
              >
                <span>Termék / számlasor</span>
                <span>Rendelt</span>
                <span>Tényleges</span>
                <span>Egység</span>
                <span>Egységár</span>
                <span>Kedv.</span>
                <span className="text-right">Sorösszeg</span>
              </div>
              {lines.map((line) => {
                const state = lineState(line, lineSuggestions[line.key]);
                return (
                  <div
                    key={line.key}
                    data-line-state={state}
                    className={`rounded-xl border p-4 ${
                      state === "suggested"
                        ? "border-pilot-accent-warm bg-pilot-accent-warm-soft"
                        : "border-pilot-grey-200 bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        {line.createLocalProduct ? (
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-pilot-grey-900">
                              {line.createLocalProduct.name ||
                                line.sourceDescription ||
                                "Új helyi termék"}
                            </p>
                            <PilotBadge variant="grey">
                              Új helyi Acropora OS-termék
                            </PilotBadge>
                          </div>
                        ) : line.variantId ? (
                          <>
                            <p className="text-sm font-semibold text-pilot-grey-900">
                              {line.productName}
                            </p>
                            <p className="text-xs text-pilot-grey-500">
                              {line.sku}
                            </p>
                          </>
                        ) : (
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-pilot-grey-900">
                              {line.sourceDescription ||
                                (line.isCharge
                                  ? "Kézi tétel"
                                  : "Kézi tétel: a nevét lent, a „Megnevezés a számlán” mezőben add meg")}
                            </p>
                            {/*
                              A DÍJSOR (fuvar, csomagolás, kerekítés) nem
                              termék: nem hiányzik a törzsből, ezért nem is ezt
                              a jelvényt kapja (acrobot 25066, a Marine Aquatics
                              32600405 DPD, RABEN és kerekítés sora).
                            */}
                            {line.isCharge ? (
                              <PilotBadge variant="grey">Díjsor</PilotBadge>
                            ) : (
                              <PilotBadge variant="amber">
                                Nincs terméktörzsben
                              </PilotBadge>
                            )}
                          </div>
                        )}
                        {line.supplierSku ? (
                          <p className="text-xs text-pilot-grey-500">
                            Beszállítói cikkszám: {line.supplierSku}
                          </p>
                        ) : null}
                        {!line.variantId && !line.createLocalProduct ? (
                          <LineSuggestionNotice
                            result={lineSuggestions[line.key]}
                            onAccept={() => acceptSuggestion(line.key)}
                            onDismiss={() => dismissSuggestion(line.key)}
                          />
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {/*
                        A SOR ÁLLAPOTA (a brief 14. pontja): a kötött sor
                        semleges, a javaslat meleg (operátori ellenőrzés, nem
                        hiba), az új helyi termék és a törzsön kívüli sor a
                        saját jelvényét a név mellett viseli.
                      */}
                        {state === "matched" ? (
                          <PilotBadge variant="blue">
                            Termékhez kötve
                          </PilotBadge>
                        ) : state === "suggested" ? (
                          <span className="rounded px-2 py-0.5 text-xs font-medium text-pilot-accent-warm-text ring-1 ring-pilot-accent-warm">
                            Javaslat ellenőrzendő
                          </span>
                        ) : null}
                        <PilotButton
                          size="action"
                          variant="secondary"
                          onClick={() => removeLine(line.key)}
                        >
                          Eltávolítás
                        </PilotButton>
                      </div>
                    </div>
                    {!line.variantId &&
                    !line.createLocalProduct &&
                    line.isCharge ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {/*
                          a díjsor-jelzés a szövegből jön, tehát tévedhet: egy
                          kattintás termék-sorrá teszi, és visszaadja a két
                          termék-gombot
                        */}
                        <PilotButton
                          size="action"
                          variant="secondary"
                          onClick={() =>
                            updateLine(line.key, { isCharge: false })
                          }
                        >
                          Mégis termék
                        </PilotButton>
                      </div>
                    ) : !line.variantId && !line.createLocalProduct ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <PilotButton
                          size="action"
                          variant="secondary"
                          onClick={() => beginExistingProductLink(line)}
                        >
                          Kapcsolás meglévő termékhez
                        </PilotButton>
                        <PilotButton
                          size="action"
                          variant="secondary"
                          onClick={() => beginLocalProductCreation(line)}
                        >
                          Új helyi termék létrehozása
                        </PilotButton>
                      </div>
                    ) : null}
                    {line.createLocalProduct ? (
                      <div className="mt-3 rounded-lg bg-pilot-grey-50 p-3 ring-1 ring-pilot-grey-200">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="text-xs text-dusk-600">
                            Terméknév
                            <input
                              aria-label="Új helyi termék neve"
                              value={line.createLocalProduct.name}
                              onChange={(event) =>
                                updateLine(line.key, {
                                  createLocalProduct: {
                                    ...line.createLocalProduct!,
                                    name: event.target.value,
                                  },
                                })
                              }
                              className="mt-1 h-9 w-full rounded-lg border border-dusk-200 px-2 text-sm"
                            />
                          </label>
                          <label className="text-xs text-dusk-600">
                            Kategória (opcionális)
                            <select
                              aria-label="Új helyi termék kategóriája"
                              value={line.createLocalProduct.primaryCategoryId}
                              onChange={(event) =>
                                updateLine(line.key, {
                                  createLocalProduct: {
                                    ...line.createLocalProduct!,
                                    primaryCategoryId: event.target.value,
                                  },
                                })
                              }
                              className="mt-1 h-9 w-full rounded-lg border border-dusk-200 bg-white px-2 text-sm"
                            >
                              <option value="">Nincs kategória</option>
                              {categoryOptions.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <label className="text-xs text-dusk-600">
                            Márka (opcionális)
                            <select
                              aria-label="Új helyi termék márkája"
                              value={line.createLocalProduct.brandId}
                              onChange={(event) =>
                                updateLine(line.key, {
                                  createLocalProduct: {
                                    ...line.createLocalProduct!,
                                    brandId: event.target.value,
                                  },
                                })
                              }
                              className="mt-1 h-9 w-full rounded-lg border border-dusk-200 bg-white px-2 text-sm"
                            >
                              <option value="">Nincs márka</option>
                              {brandOptions.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="text-xs text-dusk-600">
                            ÁFA-kulcs (%)
                            <input
                              aria-label="Új helyi termék ÁFA-kulcsa"
                              type="number"
                              min={0}
                              max={100}
                              value={line.createLocalProduct.vatRate}
                              onChange={(event) =>
                                updateLine(line.key, {
                                  createLocalProduct: {
                                    ...line.createLocalProduct!,
                                    vatRate:
                                      event.target.value === ""
                                        ? ""
                                        : Number(event.target.value),
                                  },
                                })
                              }
                              className="mt-1 h-9 w-full rounded-lg border border-dusk-200 px-2 text-sm"
                            />
                          </label>
                          <label className="text-xs text-dusk-600">
                            EAN (opcionális)
                            <input
                              aria-label="Új helyi termék EAN-je"
                              value={line.createLocalProduct.ean}
                              onChange={(event) =>
                                updateLine(line.key, {
                                  createLocalProduct: {
                                    ...line.createLocalProduct!,
                                    ean: event.target.value,
                                  },
                                })
                              }
                              onBlur={() =>
                                void checkProductConflicts(
                                  line.key,
                                  line.createLocalProduct!,
                                )
                              }
                              className="mt-1 h-9 w-full rounded-lg border border-dusk-200 px-2 font-mono text-sm"
                            />
                          </label>
                          <label className="text-xs text-dusk-600">
                            Beszállítói cikkszám (opcionális)
                            <input
                              aria-label="Új helyi termék beszállítói cikkszáma"
                              value={line.createLocalProduct.supplierSku}
                              onChange={(event) =>
                                updateLine(line.key, {
                                  createLocalProduct: {
                                    ...line.createLocalProduct!,
                                    supplierSku: event.target.value,
                                  },
                                })
                              }
                              onBlur={() =>
                                void checkProductConflicts(
                                  line.key,
                                  line.createLocalProduct!,
                                )
                              }
                              className="mt-1 h-9 w-full rounded-lg border border-dusk-200 px-2 font-mono text-sm"
                            />
                          </label>
                        </div>
                        <label className="mt-2 flex items-start gap-2 text-xs text-dusk-700">
                          <input
                            type="checkbox"
                            aria-label="Új helyi termék a webshopba is, piszkozatként"
                            checked={line.createLocalProduct.webshopDraft}
                            onChange={(event) =>
                              updateLine(line.key, {
                                createLocalProduct: {
                                  ...line.createLocalProduct!,
                                  webshopDraft: event.target.checked,
                                },
                              })
                            }
                            className="mt-0.5"
                          />
                          <span>
                            A webshopba is, piszkozatként. Nem jelenik meg a
                            boltban: a terméklapot utána kell kitölteni és
                            közzétenni. Bejelölés nélkül a termék csak az
                            Acropora OS-ben jön létre.
                          </span>
                        </label>
                        {[
                          ["EAN", productConflicts[line.key]?.byEan] as const,
                          [
                            "beszállítói cikkszám",
                            productConflicts[line.key]?.bySupplierSku,
                          ] as const,
                        ].map(([what, owner]) =>
                          owner ? (
                            <div
                              key={what}
                              role="alert"
                              className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900"
                            >
                              <span>
                                Ez az {what} már a „{owner.productName}” (
                                {owner.sku}) termékhez tartozik: a termék nem
                                új.
                              </span>
                              <button
                                type="button"
                                className="font-semibold hover:underline"
                                onClick={() => linkToExisting(line.key, owner)}
                              >
                                Kötés a meglévő termékhez
                              </button>
                            </div>
                          ) : null,
                        )}
                        <p className="mt-2 text-xs text-dusk-500">
                          A belső cikkszámot az Acropora OS automatikusan
                          generálja mentéskor.
                        </p>
                        <p className="mt-1 text-xs text-dusk-500">
                          A beszállítói cikkszám a számla szállítójához köti a
                          terméket (beszállítói leképezés).
                        </p>
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <p className="text-xs text-sky-800">
                            Készletezett fizikai termék lesz, UNAS-szinkron
                            nélkül.
                          </p>
                          <button
                            type="button"
                            className="text-xs font-semibold text-dusk-600 hover:underline"
                            onClick={() =>
                              updateLine(line.key, {
                                createLocalProduct: null,
                              })
                            }
                          >
                            Mégse
                          </button>
                        </div>
                      </div>
                    ) : null}
                    <div className={`mt-3 ${LINE_GRID}`}>
                      <label className="col-span-2 text-xs text-pilot-grey-500 sm:col-span-3 lg:col-span-1">
                        <span className="lg:sr-only">
                          Megnevezés a számlán
                          {line.variantId || line.createLocalProduct
                            ? " (opcionális)"
                            : " (kötelező)"}
                        </span>
                        <input
                          value={line.sourceDescription}
                          placeholder="Megnevezés a számlán"
                          // a new manual line starts here: its name is the
                          // one thing it needs (Luca, 2026-10-08)
                          autoFocus={line.key === focusKey}
                          onChange={(event) =>
                            updateLine(line.key, {
                              sourceDescription: event.target.value,
                            })
                          }
                          className="mt-1 h-9 w-full rounded-md bg-white px-2 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
                        />
                      </label>
                      <label className="text-xs text-pilot-grey-500">
                        <span className="lg:sr-only">
                          Rendelt ({line.unit})
                        </span>
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
                          className="mt-1 h-9 w-full rounded-md bg-white px-2 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
                        />
                      </label>
                      <label className="text-xs text-pilot-grey-500">
                        <span className="lg:sr-only">
                          Tényleges ({line.unit})
                        </span>
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
                          className="mt-1 h-9 w-full rounded-md bg-white px-2 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
                        />
                      </label>
                      <label className="text-xs text-pilot-grey-500">
                        <span className="lg:sr-only">Egység</span>
                        <input
                          value={line.unit}
                          onChange={(event) =>
                            updateLine(line.key, { unit: event.target.value })
                          }
                          className="mt-1 h-9 w-full rounded-md bg-white px-2 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
                        />
                      </label>
                      <label className="text-xs text-pilot-grey-500">
                        <span className="lg:sr-only">
                          Egységár ({effectiveCurrency || "—"})
                        </span>
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
                          className="mt-1 h-9 w-full rounded-md bg-white px-2 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
                        />
                      </label>
                      <label className="text-xs text-pilot-grey-500">
                        <span className="lg:sr-only">Kedvezmény (%)</span>
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
                          className="mt-1 h-9 w-full rounded-md bg-white px-2 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
                        />
                      </label>
                      {/*
                      A SORÖSSZEG SZÁMÍTOTT ÉRTÉK, NEM MEZŐ (a brief 13.
                      pontja): a meglévő `lineNet` számolja, itt csak áll.
                    */}
                      <p className="col-span-2 self-end pb-2 text-right text-sm font-semibold text-pilot-grey-900 sm:col-span-1">
                        <span className="text-xs font-normal text-pilot-grey-500 lg:sr-only">
                          Sorösszeg:{" "}
                        </span>
                        {formatMoney(lineNet(line), effectiveCurrency)}
                      </p>
                    </div>
                    {line.variantId || line.createLocalProduct ? (
                      <div className="mt-3 rounded-lg bg-pilot-aqua-50 px-3 py-2">
                        {/*
                        A PROJEKTFOGLALÁS SÁVJA (a brief 15. pontja): a szöveg
                        balra és rugalmas, a "Projekt hozzáadása" mindig a sáv
                        jobb szélén, nem a változó hosszú szöveg után, és nem
                        zsugorodik.
                      */}
                        <div className="flex items-center justify-between gap-3">
                          <p className="min-w-0 flex-1 text-xs leading-5 text-pilot-aqua-700">
                            {allocationSummary(line)}
                          </p>
                          <PilotButton
                            size="action"
                            variant="secondary"
                            disabled={
                              projects.length === 0 ||
                              line.projectAllocations.length >= projects.length
                            }
                            onClick={() => addProjectAllocation(line)}
                          >
                            Projekt hozzáadása
                          </PilotButton>
                        </div>
                        {projects.length === 0 ? (
                          <p className="mt-1 text-xs text-pilot-amber-700">
                            Előbb hozz létre egy projektet a fenti mezővel.
                          </p>
                        ) : null}
                        {line.projectAllocations.length > 0 ? (
                          <div className="mt-3 space-y-2">
                            {line.projectAllocations.map((allocation) => (
                              <div
                                key={allocation.key}
                                className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto]"
                              >
                                <select
                                  aria-label="Projekt"
                                  value={allocation.projectId}
                                  onChange={(event) =>
                                    updateProjectAllocation(
                                      line,
                                      allocation.key,
                                      { projectId: event.target.value },
                                    )
                                  }
                                  className="h-9 rounded-md bg-white px-2 text-sm ring-1 ring-pilot-grey-200"
                                >
                                  <option value="">Válassz projektet</option>
                                  {projects.map((project) => (
                                    <option
                                      key={project.id}
                                      value={project.id}
                                      disabled={line.projectAllocations.some(
                                        (other) =>
                                          other.key !== allocation.key &&
                                          other.projectId === project.id,
                                      )}
                                    >
                                      {project.projectNumber} · {project.name}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  aria-label="Projekthez rendelt mennyiség"
                                  type="number"
                                  min={0}
                                  max={line.actualQuantity}
                                  step="any"
                                  value={allocation.quantity}
                                  onChange={(event) =>
                                    updateProjectAllocation(
                                      line,
                                      allocation.key,
                                      { quantity: Number(event.target.value) },
                                    )
                                  }
                                  className="h-9 rounded-md bg-white px-2 text-sm ring-1 ring-pilot-grey-200"
                                />
                                <button
                                  type="button"
                                  className="px-2 text-xs font-semibold text-pilot-red-700 hover:underline"
                                  onClick={() =>
                                    removeProjectAllocation(
                                      line,
                                      allocation.key,
                                    )
                                  }
                                >
                                  Törlés
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex justify-end border-t border-pilot-grey-200 pt-4">
            <div className="text-right">
              <p className="text-xs text-pilot-grey-500">Nettó összeg</p>
              <p className="text-[28px] font-semibold leading-[34px] tracking-[-0.3px] text-pilot-grey-900">
                {formatMoney(totalNet, effectiveCurrency)}
              </p>
            </div>
          </div>
        </PilotSection>

        {/*
          AZ ALSÓ ÖSSZEGZŐ ÉS A VÉGLEGESÍTÉS (a brief 18. pontja): a számok a
          valós sorokból jönnek; a mentés a meglévő úton megy (bevételezés,
          készletmozgás, projektfoglalás, UNAS-szinkron a háttérben).
        */}
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-pilot-grey-200 bg-white p-5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-pilot-grey-900">
              {submitSummary(lines)}
            </p>
            <p className="mt-1 text-xs text-pilot-grey-500">
              Mentéskor készletre vétel és projektfoglalás; az UNAS
              készletszinkron háttérfolyamatból megy.
            </p>
          </div>
          <PilotButton type="submit" size="regular" disabled={submitting}>
            {submitting ? "Mentés…" : "Számla rögzítése és készlet frissítése"}
          </PilotButton>
        </section>
      </form>
    </PilotThemeRoot>
  );
}

const SUGGESTION_SOURCE_LABEL: Record<SupplierLineSuggestionSource, string> = {
  MAPPING: "beszállítói leképezés",
  EAN: "EAN-egyezés",
  CODE: "a szállító kódja a mi cikkszámunk",
  JEV: "Jev",
};

/**
 * #1199 P-026: a sor javaslata, forrással. Magától nem köt: az „Elfogadom”
 * tölti ki a sor termékét, a mentés a szokásos úton megy.
 */
function LineSuggestionNotice({
  result,
  onAccept,
  onDismiss,
}: {
  result: (SupplierLineSuggestionResult & { dismissed?: boolean }) | undefined;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  if (!result) return null;
  if (result.conflict)
    return (
      <p role="alert" className="mt-1 text-xs text-amber-800">
        Ütközés: a beszállítói leképezés és az EAN két különböző termékre mutat.
        Válaszd ki kézzel a helyes terméket.
      </p>
    );
  if (result.blocked)
    return (
      <p className="mt-1 text-xs text-dusk-500">
        Ehhez a sorhoz nincs javaslat: a sor szövege fennakadt a védelmi szűrőn.
      </p>
    );
  const suggestion = result.suggestion;
  if (!suggestion || result.dismissed) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-white p-2 text-xs text-pilot-grey-900 ring-1 ring-pilot-accent-warm">
      <span>
        Javaslat ({SUGGESTION_SOURCE_LABEL[suggestion.source]}):{" "}
        <strong>{suggestion.productName}</strong> ({suggestion.sku})
        {suggestion.confidence !== null
          ? `, ${Math.round(suggestion.confidence * 100)}%`
          : ""}
      </span>
      <button
        type="button"
        className="font-semibold hover:underline"
        onClick={onAccept}
      >
        Elfogadom
      </button>
      <button
        type="button"
        className="text-dusk-600 hover:underline"
        onClick={onDismiss}
      >
        Nem ez
      </button>
    </div>
  );
}
