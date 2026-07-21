"use client";

import {
  Alert,
  Card,
  CardContent,
  CardHeader,
  PageHeader,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type StockReconciliationReport,
} from "@acropora/types";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { unasOrdersApi } from "@/lib/api/unas-orders";

export function StockReconciliationPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.INVENTORY_VIEW),
  );

  const [report, setReport] = useState<StockReconciliationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView || !token) return;
    setLoading(true);
    setError(null);
    void unasOrdersApi
      .checkStockReconciliation(token)
      .then(setReport)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "A készlet-egyeztetés betöltése nem sikerült.",
        ),
      )
      .finally(() => setLoading(false));
  }, [canView, token]);

  if (!canView) {
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a készlet-egyeztetéshez"
        description="A megnyitáshoz inventory.view jogosultság szükséges."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Készlet-egyeztetés"
        description="Azok a termékek, ahol eltér a helyi és a UNAS-on jelentett készlet. Csak azokat mutatja, amiket már érintett legalább egy leltár vagy eladás."
      />

      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-900">Eltérések</h2>
          <span className="text-xs text-slate-500">
            {report
              ? `${report.mismatches.length} eltérés / ${report.checkedCount} ellenőrzött termék`
              : ""}
          </span>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? <Skeleton className="h-4 w-1/3" /> : null}
          {!loading && report && report.mismatches.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nincs eltérés a helyi és a UNAS-os készlet között.
            </p>
          ) : null}
          {report && report.mismatches.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-left">
                <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Cikkszám</th>
                    <th className="px-4 py-3">Termék</th>
                    <th className="px-4 py-3 text-right">Helyi készlet</th>
                    <th className="px-4 py-3 text-right">UNAS készlet</th>
                    <th className="px-4 py-3 text-right">Eltérés</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {report.mismatches.map((mismatch) => (
                    <tr key={mismatch.variantId}>
                      <td className="px-5 py-3 font-mono text-xs text-slate-700">
                        {mismatch.sku}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {mismatch.productName}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-slate-600">
                        {mismatch.localOnHand}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-slate-600">
                        {mismatch.unasReportedStock}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-rose-600">
                        {mismatch.difference}
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
