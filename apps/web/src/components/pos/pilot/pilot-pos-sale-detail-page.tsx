"use client";

import { Alert, Icon, Skeleton } from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type PosPaymentMethod,
  type PosSaleDetail,
} from "@acropora/types";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useReturnTo } from "@/components/navigation-history";
import { posApi } from "@/lib/api/pos";
import {
  PilotBadge,
  PilotCard,
  PilotCardHeader,
  PilotThemeRoot,
  type PilotBadgeVariant,
} from "@/components/pilot/pilot-ui";

/** Canonical Figma sale detail 434:797; API and sync state semantics retained. */

const PAYMENT_METHOD_LABEL: Record<PosPaymentMethod, string> = {
  CASH: "Készpénz",
  CARD: "Kártya",
  TRANSFER: "Utalás",
};

function formatHuf(value: string): string {
  return `${Number(value).toLocaleString("hu-HU", { maximumFractionDigits: 2 })} Ft`;
}

function syncBadgeVariant(
  status: "OK" | "FAILED" | "PENDING",
): PilotBadgeVariant {
  if (status === "OK") return "success";
  if (status === "FAILED") return "danger";
  return "amber";
}

function syncBadgeLabel(status: "OK" | "FAILED" | "PENDING"): string {
  if (status === "OK") return "OK";
  if (status === "FAILED") return "Hiba";
  return "Függőben";
}

export function PilotPosSaleDetailPage({ saleId }: { saleId: string }) {
  const { session } = useAuth();
  const backTo = useReturnTo("/pos");
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.ORDERS_VIEW),
  );

  const [detail, setDetail] = useState<PosSaleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;
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
      <PilotThemeRoot className="-m-6 flex min-h-screen flex-col bg-pilot-grey-50 lg:-m-8 [&_h1]:![font-family:inherit] [&_h2]:![font-family:inherit] [&_h3]:![font-family:inherit]">
        <div className="p-8">
          <Alert
            variant="danger"
            title="Nincs hozzáférésed ehhez az eladáshoz"
            description="A megnyitáshoz orders.view jogosultság szükséges."
          />
        </div>
      </PilotThemeRoot>
    );
  }

  const syncCounts = detail?.lines.reduce(
    (counts, line) => {
      counts[line.syncStatus] += 1;
      return counts;
    },
    { OK: 0, PENDING: 0, FAILED: 0 },
  );

  return (
    <PilotThemeRoot className="-m-6 flex min-h-screen flex-col bg-pilot-grey-50 lg:-m-8 [&_h1]:![font-family:inherit] [&_h2]:![font-family:inherit] [&_h3]:![font-family:inherit]">
      <div className="px-8 pb-5 pt-6">
        <button
          type="button"
          onClick={backTo.goBack}
          className="mb-3 flex items-center gap-1.5 text-[11px] text-pilot-aqua-700 hover:underline"
        >
          <Icon name="chevron-left" size={12} />
          {backTo.fromWithinApp ? "Vissza" : "Vissza a pénztárhoz"}
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold leading-tight text-pilot-grey-900">
              {detail ? detail.orderNumber : "Eladás"}
            </h1>
            <p className="mt-1.5 text-xs text-pilot-grey-600">
              POS eladás részletei
            </p>
          </div>
          {detail?.paymentMethod ? (
            <PilotBadge variant="teal">
              {PAYMENT_METHOD_LABEL[detail.paymentMethod]}
            </PilotBadge>
          ) : null}
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-5 px-8 pb-8">
        {loading ? (
          <PilotCard className="p-5">
            <Skeleton className="h-4 w-1/3" />
          </PilotCard>
        ) : null}
        {error ? (
          <Alert variant="danger" title="Hiba történt" description={error} />
        ) : null}
        {detail ? (
          <>
            <PilotCard>
              <PilotCardHeader title="Áttekintés" />
              <div className="grid grid-cols-[minmax(0,1fr)_280px] gap-8 p-4">
                <dl className="grid grid-cols-2 gap-x-8 gap-y-6 text-xs">
                  <div>
                    <dt className="mb-2 text-[10px] text-pilot-grey-500">
                      Fizetési mód
                    </dt>
                    <dd className="text-pilot-grey-900">
                      {detail.paymentMethod
                        ? PAYMENT_METHOD_LABEL[detail.paymentMethod]
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="mb-2 text-[10px] text-pilot-grey-500">
                      Vevő
                    </dt>
                    <dd className="text-pilot-grey-900">
                      {detail.customerName ?? "Anonim vásárló"}
                    </dd>
                  </div>
                  <div>
                    <dt className="mb-2 text-[10px] text-pilot-grey-500">
                      Pénztáros
                    </dt>
                    <dd className="text-pilot-grey-900">
                      {detail.soldByName ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="mb-2 text-[10px] text-pilot-grey-500">
                      Időpont
                    </dt>
                    <dd className="text-pilot-grey-900">
                      {new Date(detail.createdAt).toLocaleString("hu-HU")}
                    </dd>
                  </div>
                </dl>
                <dl className="flex flex-col gap-4 text-xs tabular-nums">
                  <div className="flex justify-between gap-3">
                    <dt className="text-pilot-grey-500">
                      Végösszeg kedvezmény
                    </dt>
                    <dd className="text-pilot-grey-900">
                      {detail.discountPercent ?? "0"}%
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-pilot-grey-500">Nettó</dt>
                    <dd className="text-pilot-grey-900">
                      {formatHuf(detail.totalNet)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-pilot-grey-500">ÁFA</dt>
                    <dd className="text-pilot-grey-900">
                      {formatHuf(detail.totalTax)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-pilot-grey-200 pt-3">
                    <dt className="text-pilot-grey-600">Bruttó</dt>
                    <dd className="text-[22px] font-semibold text-pilot-grey-900">
                      {formatHuf(detail.totalGross)}
                    </dd>
                  </div>
                </dl>
              </div>
            </PilotCard>
            <PilotCard>
              <PilotCardHeader
                title="Tételek"
                action={
                  <PilotBadge variant="grey">
                    {detail.lines.length} tétel
                  </PilotBadge>
                }
              />
              <div className="overflow-x-auto px-4">
                <table className="w-full table-fixed border-collapse text-left text-xs">
                  <colgroup>
                    <col className="w-[14%]" />
                    <col className="w-[27%]" />
                    <col className="w-[7%]" />
                    <col className="w-[13%]" />
                    <col className="w-[5%]" />
                    <col className="w-[10%]" />
                    <col className="w-[12%]" />
                    <col className="w-[12%]" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-pilot-grey-200 text-[10px] font-medium uppercase text-pilot-grey-600">
                      <th scope="col" className="py-4 pr-2 font-medium">
                        Cikkszám
                      </th>
                      <th scope="col" className="px-2 py-4 font-medium">
                        Termék
                      </th>
                      <th
                        scope="col"
                        className="px-2 py-4 text-right font-medium"
                      >
                        Menny.
                      </th>
                      <th
                        scope="col"
                        className="px-2 py-4 text-right font-medium"
                      >
                        Nettó egységár
                      </th>
                      <th scope="col" className="px-2 py-4 font-medium">
                        ÁFA
                      </th>
                      <th
                        scope="col"
                        className="px-2 py-4 text-right font-medium"
                      >
                        Kedvezmény
                      </th>
                      <th
                        scope="col"
                        className="px-2 py-4 text-right font-medium"
                      >
                        Bruttó
                      </th>
                      <th scope="col" className="py-4 pl-2 font-medium">
                        UNAS szinkron
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((line) => (
                      <tr
                        key={line.id}
                        className="border-b border-pilot-grey-100 text-pilot-grey-900"
                      >
                        <td className="break-all py-7 pr-2 text-[10px] text-pilot-grey-500">
                          {line.sku}
                        </td>
                        <td className="break-words px-2 py-7 font-medium">
                          {line.productName}
                        </td>
                        <td className="px-2 py-7 text-right tabular-nums">
                          {line.quantity} {line.unit}
                        </td>
                        <td className="px-2 py-7 text-right tabular-nums">
                          {formatHuf(line.unitNet)}
                        </td>
                        <td className="px-2 py-7 text-pilot-grey-600">
                          {line.taxRate}%
                        </td>
                        <td className="px-2 py-7 text-right text-pilot-grey-600">
                          {line.discountPercent
                            ? `${line.discountPercent}%`
                            : "—"}
                        </td>
                        <td className="px-2 py-7 text-right font-semibold tabular-nums">
                          {formatHuf(line.lineGross)}
                        </td>
                        <td className="py-7 pl-2">
                          <PilotBadge
                            variant={syncBadgeVariant(line.syncStatus)}
                          >
                            {syncBadgeLabel(line.syncStatus)}
                          </PilotBadge>
                          {line.syncError ? (
                            <p className="mt-1 break-words text-[10px] text-red-500">
                              {line.syncError}
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-4">
                <div className="rounded-[10px] bg-pilot-grey-100 p-3">
                  <p className="text-xs font-semibold text-pilot-grey-900">
                    Készletszinkron
                  </p>
                  <p className="mt-1 text-[10px] text-pilot-grey-600">
                    {syncCounts?.OK ?? 0} tétel szinkronizálva ·{" "}
                    {syncCounts?.PENDING ?? 0} függőben ·{" "}
                    {syncCounts?.FAILED ?? 0} hiba. A POS eladás ettől
                    függetlenül érvényes.
                  </p>
                </div>
              </div>
            </PilotCard>
          </>
        ) : null}
      </div>
    </PilotThemeRoot>
  );
}
