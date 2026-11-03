"use client";
import { useAssistantEntity } from "../assistant/page-context";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  PageHeader,
  PilotDataTable,
  Skeleton,
  type PilotTableColumn,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type PurchaseInvoiceDetail,
} from "@acropora/types";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useReturnTo } from "@/components/navigation-history";
import { purchasingApi } from "@/lib/api/purchasing";
import { currencyLabel } from "@/lib/format/currency";

import { PurchaseInvoiceScans } from "./purchase-invoice-scans";
import { PurchaseInvoiceEditForm } from "./purchase-invoice-edit-form";
import { PurchaseInvoiceCancelForm } from "./purchase-invoice-cancel-form";

function formatMoney(value: string, currency: string): string {
  return `${Number(value).toLocaleString("hu-HU", { maximumFractionDigits: 2 })} ${currencyLabel(currency)}`;
}

type PurchaseLine = PurchaseInvoiceDetail["lines"][number];

export const PURCHASE_LINE_TABLE_MIN_WIDTH = 1120;

/** The UNAS sync badge text of a line. */
export function purchaseSyncLabel(status: PurchaseLine["syncStatus"]): string {
  if (status === "OK") return "OK";
  if (status === "FAILED") return "Hiba";
  if (status === "NOT_LINKED") return "Nincs szinkronizálva";
  if (status === "NOT_APPLICABLE") return "Nem UNAS-termék";
  return "Függőben";
}

/*
  A SZÁMLA TÉTELEI A KÖZÖS TÁBLÁN (UI-áttekintés, 3. csomag, 2026-11-03). Telefonon a tábla
  kártyalistává alakul: a cikkszám a kártya címe, a többi oszlop a felirata mellett áll. A
  pénznem a számláról jön, ezért az oszlopok függvényből épülnek. A "Termék" az egyetlen
  rugalmas oszlop, a minimum a többi összege + 200 px.
*/
export function purchaseLineColumns(
  currency: string,
): PilotTableColumn<PurchaseLine>[] {
  return [
    {
      id: "sku",
      header: "Cikkszám",
      width: "110px",
      cell: (line) => (
        <span className="font-mono text-xs text-dusk-700">
          {line.sku ?? "—"}
        </span>
      ),
    },
    {
      id: "product",
      header: "Termék",
      cell: (line) =>
        line.variantId ? (
          <span className="break-words text-sm text-dusk-600">
            {line.productName}
            {line.sourceDescription ? (
              <span className="block text-xs text-dusk-400">
                Számlán: {line.sourceDescription}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-2 text-sm text-dusk-600">
            <span>{line.sourceDescription ?? "—"}</span>
            <Badge variant="warning">Nincs terméktörzsben</Badge>
          </span>
        ),
    },
    {
      id: "ordered",
      header: "Rendelt",
      width: "90px",
      align: "right",
      cell: (line) => `${line.orderedQuantity} ${line.unit}`,
    },
    {
      id: "actual",
      header: "Tényleges",
      width: "90px",
      align: "right",
      cell: (line) => `${line.actualQuantity} ${line.unit}`,
    },
    {
      id: "allocations",
      header: "Projektkészlet",
      width: "190px",
      cell: (line) =>
        line.projectAllocations.length > 0 ? (
          <div className="space-y-1 text-sm text-dusk-600">
            {line.projectAllocations.map((allocation) => (
              <div key={allocation.id}>
                <span className="font-medium text-dusk-800">
                  {allocation.projectNumber} · {allocation.projectName}
                </span>
                <span className="ml-1 text-xs text-dusk-500">
                  {allocation.quantity} {line.unit}
                </span>
              </div>
            ))}
            <p className="text-xs text-dusk-400">
              Raktári: {line.warehouseQuantity} {line.unit}
            </p>
          </div>
        ) : (
          <span className="text-dusk-400">
            Raktári: {line.warehouseQuantity} {line.unit}
          </span>
        ),
    },
    {
      id: "unitNet",
      header: "Egységár",
      width: "100px",
      align: "right",
      nowrap: true,
      cell: (line) => formatMoney(line.unitNet, currency),
    },
    {
      id: "discount",
      header: "Kedvezmény",
      width: "90px",
      align: "right",
      cell: (line) => (line.discountPercent ? `${line.discountPercent}%` : "—"),
    },
    {
      id: "lineNet",
      header: "Nettó sorérték",
      width: "110px",
      align: "right",
      nowrap: true,
      cell: (line) => (
        <span className="font-semibold text-dusk-900">
          {formatMoney(line.lineNet, currency)}
        </span>
      ),
    },
    {
      id: "sync",
      header: "UNAS szinkron",
      width: "140px",
      cell: (line) => (
        <div>
          <Badge
            variant={
              line.syncStatus === "OK"
                ? "success"
                : line.syncStatus === "FAILED"
                  ? "danger"
                  : "neutral"
            }
          >
            {purchaseSyncLabel(line.syncStatus)}
          </Badge>
          {line.syncError ? (
            <p className="mt-1 text-xs text-rose-600">{line.syncError}</p>
          ) : null}
        </div>
      ),
    },
  ];
}

export function PurchaseInvoiceDetailPage({
  invoiceId,
}: {
  invoiceId: string;
}) {
  const { session } = useAuth();
  const backToList = useReturnTo("/beszerzes");
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PURCHASING_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PURCHASING_MANAGE),
  );
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const [detail, setDetail] = useState<PurchaseInvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  useAssistantEntity("Beszerzési számla", detail?.id, detail?.documentNumber);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;
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
          <div className="flex gap-2">
            {detail && canManage && detail.status !== "CANCELLED" ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setCancelling(false);
                    setEditing(true);
                  }}
                >
                  Adatok javítása
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditing(false);
                    setCancelling(true);
                  }}
                >
                  Sztornó
                </Button>
              </>
            ) : null}
            <Button variant="secondary" onClick={backToList.goBack}>
              {backToList.fromWithinApp ? "Vissza" : "Vissza a listához"}
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

      {detail && cancelling ? (
        <PurchaseInvoiceCancelForm
          token={token}
          detail={detail}
          onCancelled={(next) => {
            setDetail(next);
            setCancelling(false);
          }}
          onClose={() => setCancelling(false)}
        />
      ) : null}

      {detail?.status === "CANCELLED" ? (
        <Alert
          variant="info"
          title="Sztornózott számla"
          description={cancelledNote(detail)}
        />
      ) : null}

      {detail && editing ? (
        <PurchaseInvoiceEditForm
          token={token}
          detail={detail}
          onSaved={(next) => {
            setDetail(next);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}

      {detail ? (
        <>
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-dusk-900">
                Áttekintés
              </h2>
              <Badge variant={detail.source === "EU" ? "info" : "neutral"}>
                {detail.source === "EU" ? "EU-s beszerzés" : "Belföldi"}
              </Badge>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-dusk-400">Beszállító</dt>
                  <dd className="mt-1 text-dusk-700">{detail.supplierName}</dd>
                </div>
                <div>
                  <dt className="text-dusk-400">Számlaszám</dt>
                  <dd className="mt-1 text-dusk-700">
                    {detail.supplierInvoiceNumber}
                  </dd>
                </div>
                <div>
                  <dt className="text-dusk-400">Számla kelte</dt>
                  <dd className="mt-1 text-dusk-700">
                    {new Date(detail.invoiceDate).toLocaleDateString("hu-HU")}
                  </dd>
                </div>
                <div>
                  <dt className="text-dusk-400">Fizetési határidő</dt>
                  <dd className="mt-1 text-dusk-700">
                    {detail.dueDate
                      ? new Date(detail.dueDate).toLocaleDateString("hu-HU")
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-dusk-400">Pénznem</dt>
                  <dd className="mt-1 text-dusk-700">{detail.currency}</dd>
                </div>
                <div>
                  <dt className="text-dusk-400">MNB árfolyam</dt>
                  <dd className="mt-1 text-dusk-700">
                    {detail.exchangeRate ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-dusk-400">Fizetve</dt>
                  <dd className="mt-1 text-dusk-700">
                    <Badge variant={detail.isPaid ? "success" : "neutral"}>
                      {detail.isPaid
                        ? `Igen (${
                            detail.paidAt
                              ? new Date(detail.paidAt).toLocaleDateString(
                                  "hu-HU",
                                )
                              : "—"
                          })`
                        : "Nyitott"}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-dusk-400">Rögzítve</dt>
                  <dd className="mt-1 text-dusk-700">
                    {new Date(detail.createdAt).toLocaleString("hu-HU")}
                  </dd>
                </div>
              </dl>
              {detail.note ? (
                <p className="mt-4 border-t border-dusk-100 pt-3 text-sm text-dusk-600">
                  {detail.note}
                </p>
              ) : null}
              <div className="mt-4 flex justify-end border-t border-dusk-100 pt-4 text-sm">
                <div className="text-right">
                  <p className="text-dusk-400">Nettó összeg</p>
                  <p className="text-lg font-bold text-dusk-900">
                    {formatMoney(detail.totalNet, detail.currency)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader>
              <h2 className="text-sm font-semibold text-dusk-900">Tételek</h2>
              <span className="text-xs text-dusk-500">
                {detail.lines.length.toLocaleString("hu-HU")} tétel
              </span>
            </CardHeader>
            <PilotDataTable
              columns={purchaseLineColumns(detail.currency)}
              rows={detail.lines}
              rowKey={(line) => line.id}
              rowTestId="purchase-line-row"
              minWidth={PURCHASE_LINE_TABLE_MIN_WIDTH}
            />
          </Card>
          <PurchaseInvoiceScans
            token={token}
            invoiceId={detail.id}
            scans={detail.scans ?? []}
            canManage={canManage}
            onChange={(scans) => setDetail({ ...detail, scans })}
          />
        </>
      ) : null}
    </div>
  );
}

/**
 * A SZTORNÓZOTT SZÁMLA SZÖVEGE. Ha volt számlaképe, az ezen a számlán marad
 * (2408d6ad, acrobot 28406): a sztornó a bejövő számla jóváhagyását is
 * visszavonja, és az újrarögzített számla kép nélkül nem hagyható jóvá.
 */
export function cancelledNote(
  detail: Pick<PurchaseInvoiceDetail, "cancelledAt" | "cancelReason" | "scans">,
): string {
  const when = detail.cancelledAt
    ? `${new Date(detail.cancelledAt).toLocaleString("hu-HU")}: `
    : "";
  const scan = detail.scans?.length
    ? " A számlaképe ezen a számlán maradt: ha újra rögzíted, ott is csatold, különben bejövő számlaként nem hagyható jóvá."
    : "";
  return `${when}${detail.cancelReason ?? "a rögzítés vissza lett vonva"}. A készlete kiment, a száma újra rögzíthető.${scan}`;
}
