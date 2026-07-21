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
  type PosPaymentMethod,
  type PosSaleDetail,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { posApi } from "@/lib/api/pos";

const PAYMENT_METHOD_LABEL: Record<PosPaymentMethod, string> = {
  CASH: "Készpénz",
  CARD: "Kártya",
  TRANSFER: "Utalás",
};

function formatHuf(value: string): string {
  return `${Number(value).toLocaleString("hu-HU", { maximumFractionDigits: 2 })} Ft`;
}

export function PosSaleDetailPage({ saleId }: { saleId: string }) {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.ORDERS_VIEW),
  );

  const [detail, setDetail] = useState<PosSaleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView || !token) return;
    setLoading(true);
    setError(null);
    void posApi
      .getSale(token, saleId)
      .then(setDetail)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Az eladás betöltése nem sikerült.",
        ),
      )
      .finally(() => setLoading(false));
  }, [canView, saleId, token]);

  if (!canView) {
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed ehhez az eladáshoz"
        description="A megnyitáshoz orders.view jogosultság szükséges."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={detail ? detail.orderNumber : "Eladás"}
        description="POS eladás részletei"
        actions={
          <Button variant="secondary" onClick={() => router.push("/pos")}>
            Vissza a pénztárhoz
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
              <Badge variant="success">{detail.status}</Badge>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-slate-400">Fizetési mód</dt>
                  <dd className="mt-1 text-slate-700">
                    {detail.paymentMethod
                      ? PAYMENT_METHOD_LABEL[detail.paymentMethod]
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">Vevő</dt>
                  <dd className="mt-1 text-slate-700">
                    {detail.customerName ?? "Anonim vásárló"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">Pénztáros</dt>
                  <dd className="mt-1 text-slate-700">
                    {detail.soldByName ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">Időpont</dt>
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
                    <th className="px-5 py-3">UNAS szinkron</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {detail.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="px-5 py-3 font-mono text-xs text-slate-700">
                        {line.sku}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {line.productName}
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
                        <Badge
                          variant={
                            line.syncStatus === "OK"
                              ? "success"
                              : line.syncStatus === "FAILED"
                                ? "danger"
                                : "neutral"
                          }
                        >
                          {line.syncStatus === "OK"
                            ? "OK"
                            : line.syncStatus === "FAILED"
                              ? "Hiba"
                              : "Függőben"}
                        </Badge>
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
