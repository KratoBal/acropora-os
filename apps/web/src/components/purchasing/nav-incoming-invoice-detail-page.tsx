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
  type NavIncomingInvoiceDetail,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { navIncomingInvoicesApi } from "@/lib/api/nav-incoming-invoices";

function formatAmount(value: string | undefined, currency: string): string {
  if (!value) return "—";
  return `${Number(value).toLocaleString("hu-HU", { maximumFractionDigits: 2 })} ${currency}`;
}

export function NavIncomingInvoiceDetailPage({
  navInvoiceId,
}: {
  navInvoiceId: string;
}) {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PURCHASING_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PURCHASING_MANAGE),
  );

  const [detail, setDetail] = useState<NavIncomingInvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView || !token) return;
    setLoading(true);
    setError(null);
    void navIncomingInvoicesApi
      .detail(token, navInvoiceId)
      .then(setDetail)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "A NAV számla adatai nem tölthetők be.",
        ),
      )
      .finally(() => setLoading(false));
  }, [canView, navInvoiceId, token]);

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed ehhez a számlához"
        description="A megnyitáshoz purchasing.view jogosultság szükséges."
      />
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title={detail ? detail.navInvoiceNumber : "NAV számla"}
        description="A NAV Online Számla rendszerből letöltött belföldi bejövő számla"
        actions={
          <Button
            variant="secondary"
            onClick={() => router.push("/beszerzes/nav-szamlak")}
          >
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
                  detail.status === "RECEIVED"
                    ? "success"
                    : detail.status === "ERROR"
                      ? "danger"
                      : "neutral"
                }
              >
                {detail.status === "RECEIVED"
                  ? "Bevételezve"
                  : detail.status === "ERROR"
                    ? "Hiba"
                    : detail.status === "DATA_FETCHED"
                      ? "Betöltve"
                      : "Új"}
              </Badge>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-slate-400">Beszállító</dt>
                  <dd className="mt-1 text-slate-700">{detail.supplierName}</dd>
                </div>
                <div>
                  <dt className="text-slate-400">Adószám</dt>
                  <dd className="mt-1 text-slate-700">
                    {detail.supplierTaxNumber}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">Számla kelte</dt>
                  <dd className="mt-1 text-slate-700">
                    {new Date(detail.invoiceIssueDate).toLocaleDateString(
                      "hu-HU",
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">Teljesítés</dt>
                  <dd className="mt-1 text-slate-700">
                    {detail.invoiceDeliveryDate
                      ? new Date(detail.invoiceDeliveryDate).toLocaleDateString(
                          "hu-HU",
                        )
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">Fizetési határidő</dt>
                  <dd className="mt-1 text-slate-700">
                    {detail.paymentDate
                      ? new Date(detail.paymentDate).toLocaleDateString("hu-HU")
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">Nettó összeg</dt>
                  <dd className="mt-1 text-slate-700">
                    {formatAmount(detail.invoiceNetAmount, detail.currency)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">ÁFA</dt>
                  <dd className="mt-1 text-slate-700">
                    {formatAmount(detail.invoiceVatAmount, detail.currency)}
                  </dd>
                </div>
                {detail.supplierAddress ? (
                  <div>
                    <dt className="text-slate-400">Cím</dt>
                    <dd className="mt-1 text-slate-700">
                      {detail.supplierAddress.postalCode}{" "}
                      {detail.supplierAddress.city},{" "}
                      {detail.supplierAddress.line1}
                    </dd>
                  </div>
                ) : null}
              </dl>
              {detail.errorCode ? (
                <p className="mt-4 border-t border-slate-100 pt-3 text-sm text-rose-600">
                  A teljes számlaadat lekérdezése nem sikerült (
                  {detail.errorCode}
                  ). Próbáld újra a lap frissítésével.
                </p>
              ) : null}
              {canManage && detail.status !== "RECEIVED" ? (
                <div className="mt-4 flex justify-end border-t border-slate-100 pt-4">
                  <Button
                    disabled={detail.lines.length === 0}
                    onClick={() =>
                      router.push(
                        `/beszerzes/uj?navInvoiceId=${encodeURIComponent(detail.id)}`,
                      )
                    }
                  >
                    Bevételezés
                  </Button>
                </div>
              ) : null}
              {detail.status === "RECEIVED" && detail.purchaseInvoiceId ? (
                <div className="mt-4 flex justify-end border-t border-slate-100 pt-4">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      router.push(`/beszerzes/${detail.purchaseInvoiceId}`)
                    }
                  >
                    Ugrás a beszerzési számlához
                  </Button>
                </div>
              ) : null}
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
              <table className="w-full min-w-[720px] border-collapse text-left">
                <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Megnevezés</th>
                    <th className="px-4 py-3 text-right">Mennyiség</th>
                    <th className="px-4 py-3 text-right">Egységár</th>
                    <th className="px-4 py-3 text-right">Nettó összeg</th>
                    <th className="px-5 py-3 text-right">ÁFA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {detail.lines.map((line) => (
                    <tr key={line.lineNumber}>
                      <td className="px-5 py-3 text-sm text-slate-600">
                        {line.description}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-slate-600">
                        {line.quantity} {line.unit}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-slate-600">
                        {line.unitPrice
                          ? formatAmount(line.unitPrice, detail.currency)
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-slate-900">
                        {formatAmount(line.lineNetAmount, detail.currency)}
                      </td>
                      <td className="px-5 py-3 text-right text-sm text-slate-600">
                        {line.vatRatePercent ? `${line.vatRatePercent}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {detail.lines.length === 0 ? (
                <p className="p-5 text-sm text-slate-500">
                  A tételek még nincsenek betöltve vagy a lekérdezés sikertelen
                  volt.
                </p>
              ) : null}
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
