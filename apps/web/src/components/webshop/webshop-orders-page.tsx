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
  type UnasOrderListItem,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

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

function statusVariant(status: string): "success" | "danger" | "neutral" {
  if (status === "CANCELLED") return "danger";
  if (status === "COMPLETED") return "success";
  return "neutral";
}

function statusLabel(order: UnasOrderListItem): string {
  return order.unasStatusLabel ?? STATUS_LABEL[order.status] ?? order.status;
}

function formatOrderDate(order: UnasOrderListItem): string {
  const value = order.orderedAt ?? order.createdAt;
  return new Date(value).toLocaleString("hu-HU", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function WebshopOrdersPage() {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.ORDERS_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.ORDERS_MANAGE),
  );

  const [orders, setOrders] = useState<UnasOrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const loadOrders = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    void unasOrdersApi
      .list(token, { page: 1, pageSize: 50 })
      .then((response) => setOrders(response.items))
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "A rendelések betöltése nem sikerült.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (!canView || !token) return;
    loadOrders();
  }, [canView, token, loadOrders]);

  const runSync = () => {
    if (!token || syncing) return;
    setSyncing(true);
    setSyncMessage(null);
    void unasOrdersApi
      .triggerSync(token)
      .then((summary) => {
        setSyncMessage(
          `Szinkron kész: ${summary.createdCount} új, ${summary.updatedCount} frissített, ${summary.reversedCount} sztornózott rendelés.`,
        );
        loadOrders();
      })
      .catch((cause: unknown) =>
        setSyncMessage(
          cause instanceof Error
            ? cause.message
            : "A szinkron indítása nem sikerült.",
        ),
      )
      .finally(() => setSyncing(false));
  };

  if (!canView) {
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a webshop rendelésekhez"
        description="A megnyitáshoz orders.view jogosultság szükséges."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Webshop rendelések"
        description="A UNAS-ból automatikusan (5 percenként) szinkronizált rendelések"
        actions={
          canManage ? (
            <Button onClick={runSync} disabled={syncing}>
              {syncing ? "Szinkronizálás…" : "Szinkronizálás most"}
            </Button>
          ) : undefined
        }
      />

      {syncMessage ? (
        <Alert variant="info" title="Szinkron" description={syncMessage} />
      ) : null}

      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-900">Rendelések</h2>
          <span className="text-xs text-slate-500">
            {orders.length.toLocaleString("hu-HU")} rendelés
          </span>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? <Skeleton className="h-4 w-1/3" /> : null}
          {!loading && orders.length === 0 ? (
            <p className="text-sm text-slate-500">
              Még nincs szinkronizált webshop rendelés.
            </p>
          ) : null}
          {orders.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left">
                <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Azonosító</th>
                    <th className="px-4 py-3">Dátum</th>
                    <th className="px-4 py-3">Vevő</th>
                    <th className="px-4 py-3">Fizetés / szállítás</th>
                    <th className="px-4 py-3 text-right">Összeg</th>
                    <th className="px-5 py-3">Státusz</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {orders.map((order) => (
                    <tr
                      key={order.id}
                      onClick={() => router.push(`/webshop/${order.id}`)}
                      className="cursor-pointer transition hover:bg-slate-50"
                    >
                      <td className="px-5 py-3 text-sm font-medium text-slate-900">
                        {order.orderNumber}
                        <p className="mt-0.5 text-xs font-normal text-slate-400">
                          {order.lineCount} tétel
                        </p>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {formatOrderDate(order)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {order.buyerName ?? "Ismeretlen vevő"}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {order.paymentName ?? "—"}
                        {order.shippingName ? ` · ${order.shippingName}` : ""}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-slate-900">
                        {formatHuf(order.totalGross)}
                      </td>
                      <td className="px-5 py-3">
                        <Badge variant={statusVariant(order.status)}>
                          {statusLabel(order)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
