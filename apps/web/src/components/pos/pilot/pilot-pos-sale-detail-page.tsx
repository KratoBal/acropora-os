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

/**
 * A FIGMA MAKE TERV ÁTÜLTETÉSE -- POS ELADÁS ADATLAPJA, 11. KÖR.
 *
 * Lásd `pilot-pos-terminal-page.tsx` fejlécét: a régi `../pos-sale-detail-
 * page.tsx` VÁLTOZATLAN marad, csak a route áll át erre a fájlra. Az
 * állapot- és hívás-logika szó szerint onnan jön.
 *
 * === KÜLÖNBSÉGEK A TERVHEZ KÉPEST, KIMONDVA ===
 *
 * A terv saját demo-adatot rajzol (fix "Tóth Gábor" pénztáros, fix
 * összegek) -- a mai kód a `posApi.getSale()` valódi válaszát mutatja,
 * `detail.soldByName`/`detail.totalGross` stb., nem talál ki adatot.
 *
 * A "Vissza a pénztárhoz" a tervben is szöveges link (nem gomb), tehát ez
 * nem tér el -- de a terv KÜLÖN hiba-ágat rajzol (`SaleDetailProps.error`,
 * teljes képernyős üzenet, saját "Vissza" gombbal), a mai kód viszont a
 * hibát a fejléc ALATT, a lista helyén mutatja (lásd a régi
 * `pos-sale-detail-page.tsx` VÁLTOZATLAN viselkedését) -- a fejléc, és
 * benne a "Vissza" link, hiba esetén is látszik, tehát nem hiányzik semmi,
 * csak máshol áll.
 */

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
  if (status === "OK") return "teal";
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
      <PilotThemeRoot className="-m-6 flex min-h-screen flex-col bg-pilot-grey-50">
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

  return (
    <PilotThemeRoot className="-m-6 flex min-h-screen flex-col bg-pilot-grey-50">
      <div className="border-b border-pilot-grey-200 bg-white px-8 py-5">
        <button
          type="button"
          onClick={backTo.goBack}
          className="mb-3 flex items-center gap-1.5 text-xs text-pilot-grey-400 transition-colors hover:text-pilot-grey-700"
        >
          <Icon name="chevron-left" size={12} />
          {backTo.fromWithinApp ? "Vissza" : "Vissza a pénztárhoz"}
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-mono text-xl font-semibold text-pilot-grey-900">
              {detail ? detail.orderNumber : "Eladás"}
            </h1>
            <p className="mt-0.5 text-sm text-pilot-grey-400">
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

      <div className="flex max-w-5xl flex-col gap-5 px-8 py-6">
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
              <div className="grid grid-cols-1 gap-6 px-5 py-5 sm:grid-cols-[1fr_auto]">
                <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                  <div>
                    <p className="mb-1 text-xs text-pilot-grey-400">
                      Fizetési mód
                    </p>
                    <PilotBadge variant="grey">
                      {detail.paymentMethod
                        ? PAYMENT_METHOD_LABEL[detail.paymentMethod]
                        : "—"}
                    </PilotBadge>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-pilot-grey-400">Vevő</p>
                    <p className="text-sm italic text-pilot-grey-500">
                      {detail.customerName ?? "Anonim vásárló"}
                    </p>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-pilot-grey-400">
                      Pénztáros
                    </p>
                    <p className="text-sm text-pilot-grey-800">
                      {detail.soldByName ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-pilot-grey-400">Időpont</p>
                    <p className="text-sm text-pilot-grey-800">
                      {new Date(detail.createdAt).toLocaleString("hu-HU")}
                    </p>
                  </div>
                </div>
                <div className="flex min-w-[160px] flex-col gap-2 sm:border-l sm:border-pilot-grey-100 sm:pl-6 sm:text-right">
                  {detail.discountPercent ? (
                    <div>
                      <p className="text-xs text-pilot-grey-400">
                        Végösszeg kedvezmény
                      </p>
                      <p className="font-mono text-sm text-pilot-grey-700">
                        {detail.discountPercent}%
                      </p>
                    </div>
                  ) : null}
                  <div>
                    <p className="text-xs text-pilot-grey-400">Nettó</p>
                    <p className="font-mono text-sm text-pilot-grey-700">
                      {formatHuf(detail.totalNet)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-pilot-grey-400">ÁFA</p>
                    <p className="font-mono text-sm text-pilot-grey-700">
                      {formatHuf(detail.totalTax)}
                    </p>
                  </div>
                  <div className="border-t border-pilot-grey-100 pt-2">
                    <p className="text-xs text-pilot-grey-400">Bruttó</p>
                    <p className="font-mono text-2xl font-bold leading-tight text-pilot-grey-900">
                      {formatHuf(detail.totalGross)}
                    </p>
                  </div>
                </div>
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
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-pilot-grey-100">
                      <th className="whitespace-nowrap bg-white px-5 py-3 text-xs font-medium uppercase tracking-wide text-pilot-grey-400">
                        Cikkszám
                      </th>
                      <th className="whitespace-nowrap bg-white px-4 py-3 text-xs font-medium uppercase tracking-wide text-pilot-grey-400">
                        Termék
                      </th>
                      <th className="whitespace-nowrap bg-white px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-pilot-grey-400">
                        Menny.
                      </th>
                      <th className="whitespace-nowrap bg-white px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-pilot-grey-400">
                        Nettó egységár
                      </th>
                      <th className="whitespace-nowrap bg-white px-4 py-3 text-xs font-medium uppercase tracking-wide text-pilot-grey-400">
                        ÁFA
                      </th>
                      <th className="whitespace-nowrap bg-white px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-pilot-grey-400">
                        Kedvezmény
                      </th>
                      <th className="whitespace-nowrap bg-white px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-pilot-grey-400">
                        Bruttó
                      </th>
                      <th className="whitespace-nowrap bg-white px-5 py-3 text-xs font-medium uppercase tracking-wide text-pilot-grey-400">
                        UNAS szinkron
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((line, index) => (
                      <tr
                        key={line.id}
                        className={`border-b border-pilot-grey-50 last:border-0 ${
                          index % 2 === 0 ? "bg-white" : "bg-pilot-grey-50/40"
                        }`}
                      >
                        <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-pilot-grey-500">
                          {line.sku}
                        </td>
                        <td className="px-4 py-3 font-medium text-pilot-grey-800">
                          {line.productName}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-pilot-grey-700">
                          {line.quantity} {line.unit}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-pilot-grey-700">
                          {formatHuf(line.unitNet)}
                        </td>
                        <td className="px-4 py-3 text-pilot-grey-500">
                          {line.taxRate}%
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-pilot-grey-700">
                          {line.discountPercent
                            ? `${line.discountPercent}%`
                            : "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-mono font-semibold text-pilot-grey-900">
                          {formatHuf(line.lineGross)}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex flex-col gap-1">
                            <PilotBadge
                              variant={syncBadgeVariant(line.syncStatus)}
                            >
                              {syncBadgeLabel(line.syncStatus)}
                            </PilotBadge>
                            {line.syncError ? (
                              <p className="max-w-[180px] text-[10px] leading-tight text-red-500">
                                {line.syncError}
                              </p>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </PilotCard>
          </>
        ) : null}
      </div>
    </PilotThemeRoot>
  );
}
