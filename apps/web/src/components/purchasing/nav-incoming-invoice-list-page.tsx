"use client";
import {
  Alert,
  Button,
  EmptyState,
  PilotDataTable,
  PilotPageHeader,
  Skeleton,
  type PilotTableColumn,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type NavIncomingInvoiceListResponse,
  type NavIncomingInvoiceStatus,
  type NavIncomingInvoiceSummary,
} from "@acropora/types";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  PilotBadge,
  PilotButton,
  PilotSelect,
  PilotThemeRoot,
  type PilotBadgeVariant,
} from "@/components/pilot/pilot-ui";
import { navIncomingInvoicesApi } from "@/lib/api/nav-incoming-invoices";

import {
  PilotFilterCard,
  PilotListCard,
  PurchasingTabs,
} from "./purchasing-pilot-shell";

function formatAmount(value: string | undefined, currency: string): string {
  if (!value) return "—";
  return `${Number(value).toLocaleString("hu-HU", { maximumFractionDigits: 2 })} ${currency}`;
}

/** A bruttó a nettó és az ÁFA összege; ÁFA nélkül nincs bruttó. */
export function navGross(
  item: Pick<
    NavIncomingInvoiceSummary,
    "invoiceNetAmount" | "invoiceVatAmount"
  >,
): string | undefined {
  if (!item.invoiceNetAmount || !item.invoiceVatAmount) return undefined;
  return (
    Number(item.invoiceNetAmount) + Number(item.invoiceVatAmount)
  ).toFixed(2);
}

const STATUS: Record<
  NavIncomingInvoiceStatus,
  { label: string; variant: PilotBadgeVariant }
> = {
  NEW: { label: "Új", variant: "blue" },
  DATA_FETCHED: { label: "Betöltve", variant: "teal" },
  RECEIVED: { label: "Bevételezve", variant: "grey" },
  ERROR: { label: "Hiba", variant: "danger" },
};

const OPERATION: Record<
  NavIncomingInvoiceSummary["invoiceOperation"],
  { label: string; variant: PilotBadgeVariant }
> = {
  CREATE: { label: "Normál", variant: "grey" },
  MODIFY: { label: "Módosító", variant: "amber" },
  STORNO: { label: "Sztornó", variant: "amber" },
};

const day = (value: string | undefined) =>
  value ? new Date(value).toLocaleDateString("hu-HU") : "—";

export function NavIncomingInvoiceListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [data, setData] = useState<NavIncomingInvoiceListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PURCHASING_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PURCHASING_MANAGE),
  );
  const token = session?.token ?? "";
  const query = useMemo(() => {
    const q = new URLSearchParams(params.toString());
    if (!q.has("page")) q.set("page", "1");
    if (!q.has("pageSize")) q.set("pageSize", "25");
    return q;
  }, [params]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setData(await navIncomingInvoicesApi.list(token, query, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A NAV számlák nem tölthetők be.",
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

  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    value ? next.set(key, value) : next.delete(key);
    if (key !== "page") next.set("page", "1");
    router.replace(`${pathname}?${next}`);
  };

  /**
   * Paging has to bypass `filter`: that helper ends by resetting the page
   * to 1 (correct for a filter change - page 4 of a different filter
   * usually does not exist), so paging through it sent every click back to
   * the first page and nothing past the first page was reachable at all.
   */
  const goToPage = (page: number) => {
    const next = new URLSearchParams(params.toString());
    next.set("page", String(page));
    router.replace(`${pathname}?${next}`);
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncNotice(null);
    setError(null);
    try {
      const result = await navIncomingInvoicesApi.sync(token);
      setSyncNotice(
        result.createdCount > 0
          ? `${result.createdCount} új számla letöltve.`
          : "Nincs új számla.",
      );
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A NAV szinkron nem sikerült.",
      );
    } finally {
      setSyncing(false);
    }
  };

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed ehhez a listához"
        description="A megtekintéshez purchasing.view jogosultság szükséges."
      />
    );

  const status = params.get("status") ?? "";
  const columns: PilotTableColumn<NavIncomingInvoiceSummary>[] = [
    {
      id: "number",
      header: "Számlaszám",
      width: "17%",
      cell: (item) => (
        <div className="min-w-0">
          <p className="truncate text-xs text-pilot-grey-600">
            {item.navInvoiceNumber}
          </p>
          {item.originalInvoiceNumber ? (
            <p className="truncate text-[11px] text-pilot-grey-500">
              eredeti: {item.originalInvoiceNumber}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: "supplier",
      header: "Szállító",
      width: "23%",
      cell: (item) => (
        <span className="font-semibold text-pilot-grey-900">
          {item.supplierName}
        </span>
      ),
    },
    {
      id: "issued",
      header: "Kelte",
      width: "12%",
      cell: (item) => (
        <span className="text-pilot-grey-600">
          {day(item.invoiceIssueDate)}
        </span>
      ),
    },
    {
      id: "delivered",
      header: "Teljesítés",
      width: "12%",
      cell: (item) => (
        <span className="text-pilot-grey-600">
          {day(item.invoiceDeliveryDate)}
        </span>
      ),
    },
    {
      id: "gross",
      header: "Bruttó",
      align: "right",
      width: "14%",
      cell: (item) => (
        <span className="font-semibold text-pilot-grey-900">
          {formatAmount(navGross(item), item.currency)}
        </span>
      ),
    },
    {
      id: "operation",
      header: "NAV",
      width: "11%",
      cell: (item) => (
        <PilotBadge variant={OPERATION[item.invoiceOperation].variant}>
          {OPERATION[item.invoiceOperation].label}
        </PilotBadge>
      ),
    },
    {
      id: "status",
      header: "OS",
      align: "right",
      width: "11%",
      cell: (item) => (
        <PilotBadge variant={STATUS[item.status].variant}>
          {STATUS[item.status].label}
        </PilotBadge>
      ),
    },
  ];

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        title="NAV számlák"
        description="A NAV Online Számla rendszerből lekért bejövő számlák és OS-feldolgozási állapotuk. Válassz egyet a bevételezéshez."
        actions={
          canManage ? (
            <PilotButton
              size="regular"
              onClick={() => void handleSync()}
              disabled={syncing}
            >
              {syncing ? "Lekérés..." : "NAV lekérés"}
            </PilotButton>
          ) : undefined
        }
      />
      <PurchasingTabs active="/beszerzes/nav-szamlak" />
      {syncNotice ? (
        <Alert variant="info" title="Szinkron kész" description={syncNotice} />
      ) : null}
      {error ? (
        <Alert
          variant="danger"
          title="Hiba történt"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Újrapróbálás
            </Button>
          }
        />
      ) : null}
      <PilotFilterCard
        onClear={status ? () => filter("status", "") : undefined}
      >
        <PilotSelect
          chevron
          aria-label="OS állapot"
          value={status}
          onChange={(value) => filter("status", value)}
          className="min-w-[200px] flex-[0_1_260px] [&_select]:h-10"
        >
          <option value="">Minden OS állapot</option>
          <option value="NEW">Új</option>
          <option value="DATA_FETCHED">Betöltve</option>
          <option value="RECEIVED">Bevételezve</option>
          <option value="ERROR">Hiba</option>
        </PilotSelect>
      </PilotFilterCard>
      {loading && !data ? (
        <div aria-label="NAV számlák betöltése" className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : null}
      {data ? (
        data.items.length ? (
          <PilotListCard
            count={`${data.pagination.totalItems.toLocaleString("hu-HU")} NAV számla`}
            pagination={data.pagination}
            onPageChange={goToPage}
          >
            <PilotDataTable
              columns={columns}
              rows={data.items}
              rowKey={(item) => item.id}
              onRowActivate={(item) =>
                router.push(`/beszerzes/nav-szamlak/${item.id}`)
              }
              rowLabel={(item) => `${item.navInvoiceNumber} megnyitása`}
              minWidth={900}
            />
          </PilotListCard>
        ) : (
          <EmptyState
            title={status ? "Nincs találat" : "Nincs letöltött NAV számla"}
            description={
              status
                ? "Válassz másik állapotot."
                : "Nyomd meg a NAV lekérés gombot az új belföldi bejövő számlák lekéréséhez."
            }
          />
        )
      ) : null}
    </PilotThemeRoot>
  );
}
