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

export function WebshopOrderDetailPage({ orderId }: { orderId: string }) {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.ORDERS_VIEW),
  );

  const [detail, setDetail] = useState<UnasOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView || !token) return;
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
          <Button variant="secondary" onClick={() => router.push("/webshop")}>
            Vissza a listához
          </Button>
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

      {detail ? (
        <>
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-900">
                Áttekintés
              </h2>
              <Badge
                variant={
                  detail.status === "CANCELLED"
                    ? "danger"
                    : detail.status === "COMPLETED"
                      ? "success"
                      : "neutral"
                }
              >
                {detail.status}
              </Badge>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-xs sm:grid-cols-4">
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
