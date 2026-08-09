"use client";

import {
  Alert,
  Badge,
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
  type CatalogOption,
  type ProjectOption,
  type PurchaseInvoiceResult,
  type PurchaseInvoiceSource,
  type PurchaseProductSearchResult,
  type SupplierSummary,
  type ViesVatLookupResult,
} from "@acropora/types";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { inferCountryFromTaxNumber } from "@/components/customers/country-options";
import { navIncomingInvoicesApi } from "@/lib/api/nav-incoming-invoices";
import { productApi } from "@/lib/api/products";
import { purchasingApi } from "@/lib/api/purchasing";
import { suppliersApi } from "@/lib/api/suppliers";
import { viesVatApi } from "@/lib/api/vies-vat";
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
  } | null;
  sku: string;
  productName: string;
  unit: string;
  sourceDescription: string;
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
  const [viesBusy, setViesBusy] = useState(false);
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
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [newProjectName, setNewProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [lines, setLines] = useState<InvoiceLineState[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<PurchaseInvoiceResult | null>(
    null,
  );

  const changeSource = (next: PurchaseInvoiceSource) => {
    setSource(next);
    setCurrency(next === "EU" ? "EUR" : "HUF");
  };

  // NAV-alapú bevételezés előtöltése: a beszállító nevét/adószámát a
  // keresőmezőbe és a soron kívüli gyorslétrehozás mezőibe is betöltjük
  // (a felhasználó választja ki a találatot vagy hozza létre egy
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
      .then((detail) => {
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
              orderedQuantity: quantity,
              actualQuantity: quantity,
              unitNet: Number.isFinite(unitPrice) ? unitPrice : 0,
              discountPercent: "",
              projectAllocations: [],
            };
          }),
        );
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
        .search(token, value)
        .then((response) => setSupplierResults(response.items))
        .catch(() => setSupplierResults([]));
    }, 300);
    debouncer.schedule(supplierSearch);
    return () => debouncer.cancel();
  }, [supplierSearch, token]);

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
    setLines((previous) => [
      ...previous,
      {
        key: `manual-${previous.length}-${Date.now()}`,
        variantId: null,
        createLocalProduct: null,
        sku: "",
        productName: "",
        unit: "",
        sourceDescription: "",
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

  const beginLocalProductCreation = (line: InvoiceLineState) => {
    if (productSearchTargetKey === line.key) {
      setProductSearchTargetKey(null);
      setProductSearch("");
      setProductResults([]);
    }
    updateLine(line.key, {
      variantId: null,
      sku: "",
      productName: "",
      createLocalProduct: {
        name: line.sourceDescription,
        primaryCategoryId: "",
      },
    });
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

  const checkVies = async () => {
    if (!newSupplierTaxNumber.trim() || viesBusy) return;
    setViesBusy(true);
    setViesResult(null);
    try {
      setViesResult(await viesVatApi.check(token, newSupplierTaxNumber.trim()));
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
        lines: lines.map((line) => ({
          variantId: line.variantId ?? undefined,
          createLocalProduct: line.createLocalProduct
            ? {
                name: line.createLocalProduct.name.trim(),
                primaryCategoryId:
                  line.createLocalProduct.primaryCategoryId || undefined,
              }
            : undefined,
          sourceDescription: line.sourceDescription.trim() || undefined,
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
    <div className="space-y-6">
      <PageHeader
        title={pageTitle}
        description={pageDescription}
        actions={
          <Button
            variant="secondary"
            onClick={() =>
              router.push(
                navInvoiceId
                  ? `/beszerzes/nav-szamlak/${navInvoiceId}`
                  : "/beszerzes",
              )
            }
          >
            {navInvoiceId ? "Vissza a NAV számlához" : "Vissza a listához"}
          </Button>
        }
      />

      {!navInvoiceId ? (
        <Card className="flex gap-2 p-4">
          <Button
            type="button"
            variant={source === "EU" ? "primary" : "secondary"}
            onClick={() => changeSource("EU")}
          >
            EU-s beszerzés
          </Button>
          <Button
            type="button"
            variant={source === "HU_MANUAL" ? "primary" : "secondary"}
            onClick={() => changeSource("HU_MANUAL")}
          >
            Belföldi (kézi)
          </Button>
        </Card>
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
          description={`Készlet helyileg lekönyvelve ${lastResult.successCount} tételnél. Létrejött ${lastResult.localProductCreatedCount} helyi termék és ${lastResult.projectReservationCount} projektfoglalás; ${lastResult.unasQueuedCount} UNAS-termék szabad készletének szinkronja került sorba.`}
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
                            if (!isDomestic) {
                              const inferred = inferCountryFromTaxNumber(value);
                              if (inferred) setNewSupplierCountry(inferred);
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
                            disabled={!newSupplierTaxNumber.trim() || viesBusy}
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
                              variant={viesResult.valid ? "success" : "danger"}
                            >
                              {viesResult.valid ? "Érvényes" : "Érvénytelen"}
                            </Badge>
                            {viesResult.valid &&
                            (viesResult.name || viesResult.address) ? (
                              <span className="text-xs text-slate-500">
                                {[viesResult.name, viesResult.address]
                                  .filter(Boolean)
                                  .join(" - ")}
                              </span>
                            ) : null}
                          </div>
                        )
                      ) : null}
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
                        placeholder={isDomestic ? "HU" : "DE"}
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
                  <p className="mt-1 text-xs text-slate-500">
                    Árfolyam lekérdezése…
                  </p>
                ) : rateNotice ? (
                  <p className="mt-1 text-xs text-slate-500">{rateNotice}</p>
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
        </Card>

        <Card className="p-6">
          <h2 className="font-semibold">Tételek</h2>
          <p className="mt-1 text-sm text-slate-500">
            Keresd meg a saját termékedet a számlán szereplő tétel alapján
            (cikkszám vagy terméknév). Egy ismeretlen sor meglévő termékhez
            kapcsolható, vagy készletezett helyi Acropora OS-termékként
            létrehozható.
          </p>
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-semibold text-slate-900">
              Projektkészlet
            </p>
            <p className="mt-1 text-xs text-slate-500">
              A projekthez rendelt mennyiség fizikailag készleten marad, de
              azonnal foglalt lesz: nem számít eladható készletnek, és az UNAS
              felé sem jelenik meg szabad mennyiségként.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label="Új projekt neve"
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                placeholder="Új projekt neve…"
              />
              <Button
                type="button"
                variant="secondary"
                disabled={newProjectName.trim().length < 2 || creatingProject}
                onClick={() => void createProject()}
              >
                {creatingProject ? "Létrehozás…" : "Projekt létrehozása"}
              </Button>
            </div>
          </div>
          <div className="mt-4">
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
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-slate-900">
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
            <Button
              type="button"
              variant="secondary"
              className="mt-2"
              onClick={addManualLine}
            >
              Kézi tétel felvétele (nincs a terméktörzsben)
            </Button>
          </div>

          {lines.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">
              Még nincs felvett tétel. Keress rá egy termékre, vagy vegyél fel
              egy kézi tételt.
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
                      {line.createLocalProduct ? (
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900">
                            {line.createLocalProduct.name ||
                              line.sourceDescription ||
                              "Új helyi termék"}
                          </p>
                          <Badge variant="info">
                            Új helyi Acropora OS-termék
                          </Badge>
                        </div>
                      ) : line.variantId ? (
                        <>
                          <p className="text-sm font-semibold text-slate-900">
                            {line.productName}
                          </p>
                          <p className="font-mono text-xs text-slate-500">
                            {line.sku}
                          </p>
                        </>
                      ) : (
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900">
                            {line.sourceDescription || "Kézi tétel"}
                          </p>
                          <Badge variant="warning">Nincs terméktörzsben</Badge>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLine(line.key)}
                      className="shrink-0 text-xs text-rose-600 hover:underline"
                    >
                      Eltávolítás
                    </button>
                  </div>
                  {!line.variantId && !line.createLocalProduct ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => beginExistingProductLink(line)}
                      >
                        Kapcsolás meglévő termékhez
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => beginLocalProductCreation(line)}
                      >
                        Új helyi termék létrehozása
                      </Button>
                    </div>
                  ) : null}
                  {line.createLocalProduct ? (
                    <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-xs text-slate-600">
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
                            className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
                          />
                        </label>
                        <label className="text-xs text-slate-600">
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
                            className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"
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
                      <p className="mt-2 text-xs text-slate-500">
                        A belső cikkszámot az Acropora OS automatikusan
                        generálja mentéskor.
                      </p>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <p className="text-xs text-sky-800">
                          Készletezett fizikai termék lesz, UNAS-szinkron
                          nélkül.
                        </p>
                        <button
                          type="button"
                          className="text-xs font-semibold text-slate-600 hover:underline"
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
                  {line.variantId || line.createLocalProduct ? (
                    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-emerald-900">
                            Projekt-hozzárendelés
                          </p>
                          <p className="text-xs text-emerald-800">
                            Szabad raktárkészlet ebből a sorból:{" "}
                            {Math.max(
                              0,
                              line.actualQuantity - allocatedQuantity(line),
                            )}{" "}
                            {line.unit}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={
                            projects.length === 0 ||
                            line.projectAllocations.length >= projects.length
                          }
                          onClick={() => addProjectAllocation(line)}
                        >
                          Projekt hozzáadása
                        </Button>
                      </div>
                      {projects.length === 0 ? (
                        <p className="mt-2 text-xs text-amber-700">
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
                                className="h-9 rounded-lg border border-emerald-200 bg-white px-2 text-sm"
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
                                className="h-9 rounded-lg border border-emerald-200 bg-white px-2 text-sm"
                              />
                              <button
                                type="button"
                                className="px-2 text-xs font-semibold text-rose-600 hover:underline"
                                onClick={() =>
                                  removeProjectAllocation(line, allocation.key)
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
                  <div className="mt-2">
                    <label className="text-xs text-slate-500">
                      Megnevezés a számlán
                      {line.variantId || line.createLocalProduct
                        ? " (opcionális)"
                        : " (kötelező)"}
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
                      Egységár ({effectiveCurrency || "—"})
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
                    {formatMoney(lineNet(line), effectiveCurrency)}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex justify-end border-t border-slate-100 pt-4 text-sm">
            <div className="text-right">
              <p className="text-slate-400">Nettó összeg</p>
              <p className="text-lg font-bold text-slate-900">
                {formatMoney(totalNet, effectiveCurrency)}
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
