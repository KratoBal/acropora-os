"use client";
import {
  Alert,
  Button,
  EmptyState,
  Icon,
  Pagination,
  PilotDataTable,
  PilotLinkTabs,
  PilotPageHeader,
  Skeleton,
  type PilotTableColumn,
} from "@acropora/ui";
import {
  hasPermission,
  isNavigationEntryVisible,
  PERMISSIONS,
  type PurchaseInvoiceListResponse,
  type PurchaseInvoiceSummary,
} from "@acropora/types";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { allNavigationPages } from "@/components/navigation";
import {
  PilotBadge,
  PilotButton,
  PilotInput,
  PilotSelect,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";
import { purchasingApi } from "@/lib/api/purchasing";

function formatMoney(value: string, currency: string): string {
  return `${Number(value).toLocaleString("hu-HU", { maximumFractionDigits: 2 })} ${currency}`;
}

/**
 * A BESZERZÉS TESTVÉR-OLDALAI FÜLKÉNT (Direction F, Figma 302:63): a
 * navigáció ugyanazon bejegyzései, ugyanazzal a szerep szerinti
 * láthatósággal, mint a menüben. A fül felirata a terv szerinti.
 */
const PURCHASING_TABS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/beszerzes", label: "Beszerzések" },
  { href: "/beszerzes/varhato", label: "Várható beérkezések" },
  { href: "/beszerzes/nav-szamlak", label: "NAV számla lekérés" },
];

const SOURCE_LABEL: Record<PurchaseInvoiceSummary["source"], string> = {
  EU: "EU",
  HU_NAV: "Belföldi",
  HU_MANUAL: "Belföldi",
};

function pageRange(pagination: PurchaseInvoiceListResponse["pagination"]) {
  const total = pagination.totalItems;
  if (total === 0) return "0 / 0";
  const from = (pagination.page - 1) * pagination.pageSize + 1;
  const to = Math.min(pagination.page * pagination.pageSize, total);
  return `${from.toLocaleString("hu-HU")}–${to.toLocaleString("hu-HU")} / ${total.toLocaleString("hu-HU")}`;
}

/**
 * AZ OLDAL URL-JÉBŐL A LISTA-KÉRÉS, CSAK AZ ISMERT MEZŐKKEL.
 *
 * Mérve a stage-en (2026-09-30, acrobot): a lap az URL minden paraméterét
 * továbbadta az API-nak, és a kézzel írt `/beszerzes?q=hertlein` 400-at
 * kapott ("property q should not exist"). Egy régi könyvjelző vagy egy
 * idegen paraméter így az egész listát eltörte. A `q` a keresés másik neve
 * (a Termékek listája azt használja), a `search` az elsődleges.
 */
export function purchaseInvoiceListQuery(
  params: URLSearchParams,
): URLSearchParams {
  const query = new URLSearchParams();
  query.set("page", params.get("page") || "1");
  query.set("pageSize", params.get("pageSize") || "25");
  const search = params.get("search") || params.get("q");
  if (search) query.set("search", search);
  for (const name of ["supplierId", "source", "payment"]) {
    const value = params.get(name);
    if (value) query.set(name, value);
  }
  return query;
}

/** A keresőmező értéke az URL-ből: a `search`, vagy a `q`. */
function searchFromUrl(params: URLSearchParams): string {
  return params.get("search") ?? params.get("q") ?? "";
}

export function PurchaseInvoiceListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [data, setData] = useState<PurchaseInvoiceListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(searchFromUrl(params));
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PURCHASING_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PURCHASING_MANAGE),
  );
  const token = session?.token ?? "";
  const query = useMemo(() => purchaseInvoiceListQuery(params), [params]);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setData(await purchasingApi.list(token, query, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A beszerzési számlák nem tölthetők be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canView, query, token],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (search === searchFromUrl(params)) return;
      const next = new URLSearchParams(params.toString());
      next.delete("q");
      search ? next.set("search", search) : next.delete("search");
      next.set("page", "1");
      router.replace(`${pathname}?${next}`);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [params, pathname, router, search]);
  /**
   * Paging must NOT reset the page number, and that is the whole reason this
   * writes the query string itself instead of going through a shared helper.
   * The search box above resets `page` to 1 on purpose - page 4 of a different
   * search usually does not exist - but doing the same on a paging click sent
   * every click back to the first page, and nothing past the first page was
   * reachable at all.
   */
  const goToPage = (page: number) => {
    const next = new URLSearchParams(params.toString());
    next.set("page", String(page));
    router.replace(`${pathname}?${next}`);
  };
  /** A forrás és a fizetési állapot szűrője: a változás az 1. oldalra visz. */
  const setFilter = (name: "source" | "payment", value: string) => {
    const next = new URLSearchParams(params.toString());
    value ? next.set(name, value) : next.delete(name);
    next.set("page", "1");
    router.replace(`${pathname}?${next}`);
  };
  const clearFilters = () => {
    setSearch("");
    const next = new URLSearchParams(params.toString());
    for (const name of ["search", "q", "source", "payment"]) next.delete(name);
    next.set("page", "1");
    router.replace(`${pathname}?${next}`);
  };
  const source = params.get("source") ?? "";
  const payment = params.get("payment") ?? "";
  const hasFilters = Boolean(searchFromUrl(params) || source || payment);
  const tabs = PURCHASING_TABS.filter((tab) => {
    const entry = allNavigationPages.find((page) => page.href === tab.href);
    return Boolean(
      entry && session && isNavigationEntryVisible(entry.entryId, session.user),
    );
  }).map((tab) => ({ ...tab, active: tab.href === "/beszerzes" }));
  const openInvoice = (item: PurchaseInvoiceSummary) =>
    router.push(`/beszerzes/${item.id}`);

  /* A közös oszloprács: a fejléc és a sor ugyanebből épül (a brief 5. pontja). */
  const columns: PilotTableColumn<PurchaseInvoiceSummary>[] = [
    {
      id: "document",
      header: "Bizonylatszám",
      width: "150px",
      cell: (item) => (
        <span className="text-[13px] text-pilot-grey-600">
          {item.documentNumber}
        </span>
      ),
    },
    {
      id: "supplier",
      header: "Beszállító",
      cell: (item) => (
        <span
          title={item.supplierName}
          className="line-clamp-2 font-semibold text-pilot-grey-900"
        >
          {item.supplierName}
        </span>
      ),
    },
    {
      id: "invoice",
      header: "Számlaszám",
      width: "160px",
      cell: (item) => (
        <span className="block truncate text-pilot-grey-600">
          {item.supplierInvoiceNumber}
        </span>
      ),
    },
    {
      id: "date",
      header: "Kelte",
      width: "120px",
      cell: (item) => (
        <span className="text-pilot-grey-600">
          {new Date(item.invoiceDate).toLocaleDateString("hu-HU")}
        </span>
      ),
    },
    {
      id: "total",
      header: "Összeg",
      width: "150px",
      align: "right",
      cell: (item) => (
        <span className="font-semibold text-pilot-grey-900">
          {formatMoney(item.totalNet, item.currency)}
        </span>
      ),
    },
    {
      id: "paid",
      header: "Fizetve",
      width: "112px",
      cell: (item) => (
        <PilotBadge variant={item.isPaid ? "success" : "grey"}>
          {item.isPaid ? "Fizetve" : "Nyitott"}
        </PilotBadge>
      ),
    },
    {
      id: "source",
      header: "Forrás",
      width: "96px",
      align: "right",
      cell: (item) => (
        <PilotBadge variant={item.source === "EU" ? "blue" : "grey"}>
          {SOURCE_LABEL[item.source]}
        </PilotBadge>
      ),
    },
  ];

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a beszerzéshez"
        description="A megtekintéshez purchasing.view jogosultság szükséges."
      />
    );

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <PilotPageHeader
        title="Beszerzés"
        description="Beérkezett beszállítói számlák: EU-s és belföldi bevételezés."
        actions={
          canManage ? (
            <PilotButton
              size="regular"
              onClick={() => router.push("/beszerzes/uj")}
            >
              Új beszerzés
            </PilotButton>
          ) : undefined
        }
      />
      {tabs.length > 1 ? (
        <PilotLinkTabs
          label="Beszerzés oldalai"
          tabs={tabs}
          renderLink={({ href, className, children, ...rest }) => (
            <Link href={href} className={className} {...rest}>
              {children}
            </Link>
          )}
        />
      ) : null}
      {error ? (
        <Alert
          variant="danger"
          title="Betöltési hiba"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Újrapróbálás
            </Button>
          }
        />
      ) : null}
      {loading && !data ? (
        <div aria-label="Beszerzési számlák betöltése" className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : null}
      {data ? (
        <>
          {/*
            A SZŰRŐSOR TÖRIK, NEM CSÚSZIK (a Termékeknél a stage-en mérve):
            rugalmas elemek alsó határral.
          */}
          <section className="rounded-2xl border border-pilot-grey-200 bg-white p-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-[240px] flex-[2_1_360px]">
                <PilotInput
                  aria-label="Számla keresése"
                  value={search}
                  onChange={setSearch}
                  leadingIcon={<Icon name="search" size={17} />}
                  placeholder="Bizonylatszám, számlaszám, beszállító neve…"
                  className="h-10"
                />
              </div>
              <PilotSelect
                chevron
                aria-label="Forrás"
                value={source}
                onChange={(value) => setFilter("source", value)}
                className="min-w-[180px] flex-[1_1_200px] [&_select]:h-10"
              >
                <option value="">Minden forrás</option>
                <option value="EU">EU</option>
                <option value="HU_NAV">Belföldi (NAV)</option>
                <option value="HU_MANUAL">Belföldi (kézi)</option>
              </PilotSelect>
              <PilotSelect
                chevron
                aria-label="Fizetési állapot"
                value={payment}
                onChange={(value) => setFilter("payment", value)}
                className="min-w-[200px] flex-[1_1_220px] [&_select]:h-10"
              >
                <option value="">Minden fizetési állapot</option>
                <option value="paid">Fizetve</option>
                <option value="open">Nyitott</option>
              </PilotSelect>
              {hasFilters ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="ml-auto whitespace-nowrap text-xs text-pilot-accent-warm-text hover:underline"
                >
                  Szűrők törlése
                </button>
              ) : null}
            </div>
          </section>
          {data.items.length ? (
            <section className="relative overflow-hidden rounded-2xl border border-pilot-grey-200 bg-white">
              <span
                aria-hidden="true"
                className="absolute inset-x-4 top-0 h-0.5 bg-pilot-accent-warm"
              />
              <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-pilot-accent-warm-text">
                  {data.pagination.totalItems.toLocaleString("hu-HU")}{" "}
                  beszerzési számla
                </p>
                <Pagination
                  variant="directionF"
                  position="top"
                  page={data.pagination.page}
                  totalPages={data.pagination.totalPages}
                  onPageChange={goToPage}
                />
              </div>
              <PilotDataTable
                columns={columns}
                rows={data.items}
                rowKey={(item) => item.id}
                onRowActivate={openInvoice}
                minWidth={900}
              />
              <div className="flex flex-col gap-3 border-t border-pilot-grey-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-pilot-grey-500">
                  {pageRange(data.pagination)}
                </p>
                <Pagination
                  variant="directionF"
                  position="bottom"
                  page={data.pagination.page}
                  totalPages={data.pagination.totalPages}
                  onPageChange={goToPage}
                />
              </div>
            </section>
          ) : (
            <EmptyState
              title={
                data.pagination.totalItems || hasFilters
                  ? "Nincs találat"
                  : "Még nincs rögzített beszerzési számla"
              }
              description="Módosítsd a keresést vagy rögzíts új beszerzést."
              action={
                canManage && !data.pagination.totalItems && !hasFilters ? (
                  <PilotButton
                    size="regular"
                    variant="secondary"
                    onClick={() => router.push("/beszerzes/uj")}
                  >
                    Új beszerzés
                  </PilotButton>
                ) : undefined
              }
            />
          )}
        </>
      ) : null}
    </PilotThemeRoot>
  );
}
