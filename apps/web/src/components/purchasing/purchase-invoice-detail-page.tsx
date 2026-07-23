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
  type PurchaseInvoiceDetail,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { purchasingApi } from "@/lib/api/purchasing";

function formatMoney(value: string, currency: string): string {
  return `${Number(value).toLocaleString("hu-HU", { maximumFractionDigits: 2 })} ${currency}`;
}

export function PurchaseInvoiceDetailPage({ invoiceId }: { invoiceId: string }) {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PURCHASING_VIEW),
  );

  const [detail, setDetail] = useState<PurchaseInvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView || !token) return;
    setLoading(true);
    setError(null);
    void purchasingApi
      .detail(token, invoiceId)
      .then(setDetail)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "A számla betöltése nem sikerült.",
        ),
      )
      .finally(() => setLoading(false));
  }, [canView, invoiceId, token]);

  if (!canView) {
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed ehhez a számlához"
        description="A megnyitáshoz purchasing.view jogosultság szükséges."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={detail ? detail.documentNumber : "Beszerzési számla"}
        description="Beérkezett beszállítói számla részletei"
        actions={
          <Button variant="secondary" onClick={() => router.push("/beszerzes")}>
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
              <Badge variant={detail.source === "EU" ? "info" : "neutral"}>
                {detail.source === "EU" ? "EU-s beszerzés" : "Belföldi"}
              </Badge>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-slate-400">Beszállító</dt>
                  <dd className="mt-1 text-slate-700">{detail.supplierName}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">Számlaszám</dt>
                  <dd className="mt-1 text-slate-700">
                    {detail.supplierInvoiceNumber}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">Számla kelte</dt>
                  <dd className="mt-1 text-slate-700">
                    {new Date(detail.invoiceDate).toLocaleDateString("hu-HU")}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">Fizetési határidő</dt>
                  <dd className="mt-1 text-slate-700">
                    {detail.dueDate
                      ? new Date(detail.dueDate).toLocaleDateString("hu-HU")
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">Pénznem</dt>
                  <dd className="mt-1 text-slate-700">{detail.currency}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">MNB árfolyam</dt>
                  <dd className="mt-1 text-slate-700">
                    {detail.exchangeRate ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">Fizetve</dt>
                  <dd className="mt-1 text-slate-700">
                    <Badge variant={detail.isPaid ? "success" : "neutral"}>
                      {detail.isPaid
                        ? `Igen (${
                            detail.paidAt
                              ? new Date(detail.paidAt).toLocaleDateString("hu-HU")
                              : "—"
                          })`
                        : "Nyitott"}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">Rögzítve</dt>
                  <dd className="mt-1 text-slate-700">
                    {new Date(detail.createdAt).toLocaleString("hu-HU")}
                  </dd>
                </div>
              </dl>
              {detail.note ? (
                <p className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-600">
                  {detail.note}
                </p>
              ) : null}
              <div className="mt-4 flex justify-end border-t border-slate-100 pt-4 text-sm">
                <div className="text-right">
                  <p className="text-slate-400">Nettó összeg</p>
                  <p className="text-lg font-bold text-slate-900">
                    {formatMoney(detail.totalNet, detail.currency)}
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
              <table className="w-full min-w-[860px] border-collapse text-left">
                <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Cikkszám</th>
                    <th className="px-4 py-3">Termék</th>
                    <th className="px-4 py-3 text-right">Rendelt</th>
                    <th className="px-4 py-3 text-right">Tényleges</th>
                    <th className="px-4 py-3 text-right">Egységár</th>
                    <th className="px-4 py-3 text-right">Kedvezmény</th>
                    <th className="px-4 py-3 text-right">Nettó sorérték</th>
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
                        {line.sourceDescription ? (
                          <div className="text-xs text-slate-400">
                            Számlán: {line.sourceDescription}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-slate-600">
                        {line.orderedQuantity} {line.unit}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-slate-600">
                        {line.actualQuantity} {line.unit}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-slate-600">
                        {formatMoney(line.unitNet, detail.currency)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-slate-600">
                        {line.discountPercent ? `${line.discountPercent}%` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-slate-900">
                        {formatMoney(line.lineNet, detail.currency)}
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
