"use client";

import { Icon, PilotDataTable, type PilotTableColumn } from "@acropora/ui";
import {
  getDocumentCapabilities,
  INVOICE_FORMAT_LABELS,
  type BillingDocumentListItem,
} from "@acropora/types";

import { formatMoney } from "./billing-editor-state";
import { BillingDocumentStatus } from "./billing-document-status";
import { ExternalBadge } from "./billing-external-document-page";
import { PaymentBadge } from "./billing-payment";

export const BILLING_LIST_PATH = "/penzugy/szamlazas";

/**
 * A SOR CÉLJA (brief 24. pont): a vázlat a szerkesztőbe nyílik (ott folytatható),
 * minden más a részletekre. A szerver mondja meg (`opens`), nem a felület
 * következteti ki az állapotból: ha egy új állapot jön, egy helyen dől el.
 */
export function billingDocumentHref(item: {
  id: string;
  opens: BillingDocumentListItem["opens"];
}): string {
  if (item.opens === "EDITOR")
    return `${BILLING_LIST_PATH}/${item.id}/szerkesztes`;
  // a Számlázz.hu-ból kapott külső bizonylat: csak olvasható adatlap (acrobot 25812)
  if (item.opens === "EXTERNAL_DETAIL")
    return `${BILLING_LIST_PATH}/kulso/${item.id}`;
  return `${BILLING_LIST_PATH}/${item.id}`;
}

/** `YYYY-MM-DD` -> "2026. 09. 30.", hiányzó dátumnál "—" (a Figma jele). */
export function formatDay(value: string | null | undefined): string {
  if (!value) return "—";
  return `${value.replaceAll("-", ". ")}.`;
}

/**
 * AZ OSZLOP-DEFINÍCIÓ EGY HELYEN (brief 6. pont): a fejléc és a sorok UGYANEBBŐL
 * rajzolnak (`PilotDataTable`), ugyanúgy, mint a Termékeknél és a
 * Beszerzésnél. A vevő oszlopa vág, nem tol: egy hosszú név nem csúsztatja el
 * az összeget az állapotba.
 */
export const BILLING_DOCUMENT_COLUMNS: readonly PilotTableColumn<BillingDocumentListItem>[] =
  [
    {
      id: "document",
      header: "Dokumentum",
      width: "140px",
      cell: (item) => (
        <span className="flex flex-col">
          <span className="font-semibold text-pilot-grey-900">
            {item.externalKindLabel ??
              getDocumentCapabilities(item.documentType).label}
          </span>
          <span className="text-xs text-pilot-aqua-700">
            {item.invoiceFormat
              ? INVOICE_FORMAT_LABELS[item.invoiceFormat]
              : "—"}
          </span>
        </span>
      ),
    },
    {
      id: "number",
      header: "Bizonylatszám",
      width: "160px",
      cell: (item) => (
        <span className="flex flex-col items-start gap-1">
          <span className="font-semibold text-pilot-grey-900">
            {item.documentNumber ?? "Piszkozat"}
          </span>
          {item.origin === "EXTERNAL" ? <ExternalBadge /> : null}
        </span>
      ),
    },
    {
      id: "customer",
      header: "Vevő",
      cell: (item) => (
        <span className="block truncate" title={item.customerName}>
          {item.customerName}
        </span>
      ),
    },
    {
      id: "issueDate",
      header: "Kiállítás",
      width: "120px",
      cell: (item) => formatDay(item.issueDate),
    },
    {
      id: "dueDate",
      header: "Határidő",
      width: "120px",
      cell: (item) => formatDay(item.dueDate),
    },
    {
      id: "gross",
      header: "Bruttó",
      width: "140px",
      align: "right",
      cell: (item) => (
        <span className="whitespace-nowrap font-semibold tabular-nums text-pilot-grey-900">
          {formatMoney(item.grossAmount, item.currency)}
        </span>
      ),
    },
    {
      id: "payment",
      header: "Kifizetés",
      width: "120px",
      cell: (item) => (
        <PaymentBadge
          paymentState={item.paymentState}
          paidAmount={item.paidAmount}
          lastPaymentDate={item.lastPaymentDate}
          paymentSource={item.paymentSource}
          currency={item.currency}
        />
      ),
    },
    {
      id: "status",
      header: "Állapot",
      width: "170px",
      cell: (item) => (
        <BillingDocumentStatus
          status={item.status}
          emailStatus={item.emailStatus}
        />
      ),
    },
    {
      id: "open",
      header: <span className="sr-only">Megnyitás</span>,
      width: "48px",
      align: "right",
      // CSAK VIZUÁLIS JEL: a sor maga nyílik (brief 7. pont).
      cell: () => (
        <span aria-hidden="true" className="text-pilot-aqua-700">
          <Icon name="chevron-left" size={14} className="rotate-180" />
        </span>
      ),
    },
  ];

export function BillingDocumentTable({
  items,
  onOpen,
}: {
  items: readonly BillingDocumentListItem[];
  onOpen: (item: BillingDocumentListItem) => void;
}) {
  return (
    <PilotDataTable
      columns={BILLING_DOCUMENT_COLUMNS}
      rows={items}
      rowKey={(item) => item.id}
      onRowActivate={onOpen}
      rowLabel={(item) =>
        `${item.origin === "EXTERNAL" ? "Külső " : ""}${
          item.externalKindLabel ??
          getDocumentCapabilities(item.documentType).label
        } ${item.documentNumber ?? "piszkozat"}, ${item.customerName} megnyitása`
      }
      minWidth={960}
    />
  );
}
