"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  PageHeader,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type UnasOrderDetail,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { unasOrdersApi } from "@/lib/api/unas-orders";

function formatHuf(value: string): string {
  return `${Number(value).toLocaleString("hu-HU", { maximumFractionDigits: 2 })} Ft`;
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Piszkozat",
  PENDING: "Függőben",
  CONFIRMED: "Visszaigazolva",
  PICKING: "Szedés alatt",
  PACKED: "Csomagolva",
  SHIPPED: "Kiszállítva",
  COMPLETED: "Lezárva",
  CANCELLED: "Törölve",
  ON_HOLD: "Felfüggesztve",
};

// Literal-union-keyed (not Record<string, ...>, unlike STATUS_LABEL above)
// so a future addition to UnasOrderDetail's unasInvoiceStatus/invoices
// syncStatus union that's missed here is a compile error, not a silently
// undefined badge/label at runtime.
type UnasInvoiceStatus = NonNullable<UnasOrderDetail["unasInvoiceStatus"]>;
type UnasInvoiceSyncStatus = UnasOrderDetail["invoices"][number]["syncStatus"];
type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "info";

const INVOICE_STATUS_LABEL: Record<UnasInvoiceStatus, string> = {
  NOT_BILLABLE: "Nem számlázható",
  BILLABLE: "Számlázható",
  BILLED: "Számlázva",
};

const INVOICE_STATUS_BADGE_VARIANT: Record<UnasInvoiceStatus, BadgeVariant> = {
  NOT_BILLABLE: "neutral",
  BILLABLE: "warning",
  BILLED: "success",
};

const INVOICE_SYNC_STATUS_LABEL: Record<UnasInvoiceSyncStatus, string> = {
  PENDING: "Feldolgozás alatt",
  RECEIVED: "Fogadva",
  ERROR: "Hiba",
};

const INVOICE_SYNC_STATUS_BADGE_VARIANT: Record<
  UnasInvoiceSyncStatus,
  BadgeVariant
> = {
  PENDING: "warning",
  RECEIVED: "success",
  ERROR: "danger",
};

export function WebshopOrderDetailPage({ orderId }: { orderId: string }) {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.ORDERS_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.ORDERS_MANAGE),
  );

  const [detail, setDetail] = useState<UnasOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshSuccessAt, setRefreshSuccessAt] = useState<Date | null>(null);

  const handleRefresh = () => {
    setRefreshing(true);
    setRefreshError(null);
    setRefreshSuccessAt(null);
    void unasOrdersApi
      .refreshOrder(token, orderId)
      .then((refreshed) => {
        // Replaces the on-screen order and invoice data with what the
        // targeted UNAS refresh just returned - see
        // UnasOrderSyncService.refreshOrder(), which re-reads via
        // repository.findById() after applying the fetched order, so this
        // is exactly the same detail shape as the initial GET above.
        // unasDeletedAt non-null means this exact call just confirmed (or
        // had already confirmed) a physical UNAS deletion - see
        // UnasOrderSyncService.refreshOrder()'s NOT_FOUND branch - which
        // gets its own distinct message below instead of the generic
        // "adatai frissültek" one, per business rule 3's explicit
        // requirement for an understandable result either way.
        setDetail(refreshed);
        setRefreshSuccessAt(new Date());
      })
      .catch((cause: unknown) =>
        setRefreshError(
          cause instanceof Error
            ? cause.message
            : "A rendelés frissítése nem sikerült.",
        ),
      )
      .finally(() => setRefreshing(false));
  };

  useEffect(() => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    void unasOrdersApi
      .getOne(token, orderId)
      .then(setDetail)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "A rendelés betöltése nem sikerült.",
        ),
      )
      .finally(() => setLoading(false));
  }, [canView, orderId, token]);

  if (!canView) {
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed ehhez a rendeléshez"
        description="A megnyitáshoz orders.view jogosultság szükséges."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={detail ? detail.orderNumber : "Rendelés"}
        description="Webshop (UNAS) rendelés részletei"
        actions={
          <div className="flex gap-2">
            {canManage && detail ? (
              <Button
                variant="primary"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                {refreshing ? "Frissítés…" : "Rendelés frissítése"}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => router.push("/webshop")}>
              Vissza a listához
            </Button>
          </div>
        }
      />

      {loading ? (
        <Card className="p-5">
          <Skeleton className="h-4 w-1/3" />
        </Card>
      ) : null}

      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}

      {refreshError ? (
        <Alert
          variant="danger"
          title="A rendelés frissítése nem sikerült"
          description={refreshError}
        />
      ) : null}

      {refreshSuccessAt && !refreshError && detail?.unasDeletedAt ? (
        <Alert
          variant="danger"
          title="A rendelést törölték a UNAS-ban"
          description={`A rendelés a UNAS-ban fizikailag törölve lett - a még ki nem forgatott készlet visszakönyvelésre került. A rendelés és korábbi mozgásai a rendszerben megmaradnak. Felismerve: ${new Date(detail.unasDeletedAt).toLocaleString("hu-HU")}`}
        />
      ) : refreshSuccessAt && !refreshError ? (
        <Alert
          variant="info"
          title="A rendelés adatai frissültek"
          description={`Utolsó UNAS-frissítés: ${refreshSuccessAt.toLocaleString("hu-HU")}`}
        />
      ) : null}

      {detail ? (
        <>
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-900">
                Áttekintés
              </h2>
              <div className="flex items-center gap-2">
                {detail.unasDeletedAt ? (
                  <Badge variant="danger">
                    Törölve a UNAS-ban (
                    {new Date(detail.unasDeletedAt).toLocaleDateString(
                      "hu-HU",
                    )}
                    )
                  </Badge>
                ) : null}
                <Badge
                  variant={
                    detail.status === "CANCELLED"
                      ? "danger"
                      : detail.status === "COMPLETED"
                        ? "success"
                        : "neutral"
                  }
                >
                  {detail.unasStatusLabel ??
                    STATUS_LABEL[detail.status] ??
                    detail.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-xs sm:grid-cols-3 lg:grid-cols-6">
                <div>
                  <dt className="text-slate-400">Vevő</dt>
                  <dd className="mt-1 text-slate-700">
                    {detail.buyerName ?? "Ismeretlen vevő"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">E-mail</dt>
                  <dd className="mt-1 text-slate-700">
                    {detail.buyerEmail ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">Fizetés</dt>
                  <dd className="mt-1 text-slate-700">
                    {detail.paymentName ?? "—"}
                    {detail.paymentStatus ? ` (${detail.paymentStatus})` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">Szállítás</dt>
                  <dd className="mt-1 text-slate-700">
                    {detail.shippingName ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">Rendelés időpontja</dt>
                  <dd className="mt-1 text-slate-700">
                    {detail.orderedAt
                      ? new Date(detail.orderedAt).toLocaleString("hu-HU")
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">Rögzítve</dt>
                  <dd className="mt-1 text-slate-700">
                    {new Date(detail.createdAt).toLocaleString("hu-HU")}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 flex justify-end gap-6 border-t border-slate-100 pt-4 text-sm">
                <div className="text-right">
                  <p className="text-slate-400">Nettó</p>
                  <p className="font-semibold text-slate-700">
                    {formatHuf(detail.totalNet)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-slate-400">ÁFA</p>
                  <p className="font-semibold text-slate-700">
                    {formatHuf(detail.totalTax)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-slate-400">Bruttó</p>
                  <p className="text-lg font-bold text-slate-900">
                    {formatHuf(detail.totalGross)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-900">Számla</h2>
              <Badge
                variant={
                  detail.unasInvoiceStatus
                    ? INVOICE_STATUS_BADGE_VARIANT[detail.unasInvoiceStatus]
                    : "neutral"
                }
              >
                {detail.unasInvoiceStatus
                  ? INVOICE_STATUS_LABEL[detail.unasInvoiceStatus]
                  : "Nincs adat"}
              </Badge>
            </CardHeader>
            <CardContent>
              {detail.invoices.length > 0 ? (
                <ul className="divide-y divide-slate-100">
                  {detail.invoices.map((invoice) => (
                    <li
                      key={invoice.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <div>
                        <p className="text-slate-400">Számlaszám</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">
                          {invoice.invoiceNumber}
                        </p>
                      </div>
                      <Badge
                        variant={
                          INVOICE_SYNC_STATUS_BADGE_VARIANT[invoice.syncStatus]
                        }
                      >
                        {INVOICE_SYNC_STATUS_LABEL[invoice.syncStatus]}
                      </Badge>
                      {invoice.externalUrl ? (
                        <a
                          href={invoice.externalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-sky-600 hover:text-sky-700"
                        >
                          Számla megnyitása ↗
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">
                  Ehhez a rendeléshez a UNAS egyelőre nem jelentett kiállított
                  számlát.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-900">Tételek</h2>
              <span className="text-xs text-slate-500">
                {detail.lines.length.toLocaleString("hu-HU")} tétel
              </span>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left">
                <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Cikkszám</th>
                    <th className="px-4 py-3">Termék</th>
                    <th className="px-4 py-3 text-right">Menny.</th>
                    <th className="px-4 py-3 text-right">Nettó egységár</th>
                    <th className="px-4 py-3 text-right">ÁFA</th>
                    <th className="px-4 py-3 text-right">Bruttó</th>
                    <th className="px-5 py-3">Készletszinkron</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {detail.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="px-5 py-3 font-mono text-xs text-slate-700">
                        {line.sku}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {line.description}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-slate-600">
                        {line.quantity} {line.unit}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-slate-600">
                        {formatHuf(line.unitNet)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-slate-600">
                        {line.taxRate}%
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-slate-900">
                        {formatHuf(line.lineGross)}
                      </td>
                      <td className="px-5 py-3">
                        {line.variantId === null && line.syncStatus === "OK" ? (
                          <Badge variant="neutral">Nem raktárkészlet</Badge>
                        ) : (
                          <Badge
                            variant={
                              line.syncStatus === "OK" ? "success" : "danger"
                            }
                          >
                            {line.syncStatus === "OK" ? "OK" : "Hiba"}
                          </Badge>
                        )}
                        {line.syncError ? (
                          <p className="mt-1 text-xs text-rose-600">
                            {line.syncError}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
