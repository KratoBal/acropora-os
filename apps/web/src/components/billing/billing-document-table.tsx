"use client";

import { Icon, PilotDataTable, type PilotTableColumn } from "@acropora/ui";
import {
  BILLING_LIST_PATH as SHARED_BILLING_LIST_PATH,
  billingDocumentPath,
  currencyLabel,
  getDocumentCapabilities,
  INVOICE_FORMAT_LABELS,
  type BillingDocumentListItem,
} from "@acropora/types";

import { listAmount } from "./billing-amount-format";
import { BillingDocumentStatus } from "./billing-document-status";
import { ExternalBadge } from "./billing-external-document-page";
import { PaymentBadge } from "./billing-payment";
import { PdfStateBadge } from "./billing-pdf-state";

export const BILLING_LIST_PATH = SHARED_BILLING_LIST_PATH;

/**
 * A SOR CÉLJA (brief 24. pont): a vázlat a szerkesztőbe nyílik (ott folytatható),
 * minden más a részletekre. A szerver mondja meg (`opens`), nem a felület
 * következteti ki az állapotból: ha egy új állapot jön, egy helyen dől el.
 */
export function billingDocumentHref(item: {
  id: string;
  opens: BillingDocumentListItem["opens"];
}): string {
  // egy szabály a listának és a globális keresésnek (`@acropora/types`, T2.2)
  return billingDocumentPath(item);
}

/** `YYYY-MM-DD` -> "2026. 09. 30.", hiányzó dátumnál "—" (a Figma jele). */
export function formatDay(value: string | null | undefined): string {
  if (!value) return "—";
  return `${value.replaceAll("-", ". ")}.`;
}

/** The table's minimum width, and the least the flexible customer column may get of it. */
export const BILLING_TABLE_MIN_WIDTH = 1330;
export const BILLING_CUSTOMER_MIN_WIDTH = 150;

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
      width: "120px",
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
      width: "150px",
      cell: (item) => (
        <span className="flex flex-col items-start gap-1">
          <span className="font-semibold text-pilot-grey-900">
            {item.documentNumber ?? "Piszkozat"}
          </span>
          {item.origin === "EXTERNAL" ? (
            <ExternalBadge source={item.externalSource} />
          ) : null}
          {/* a sztornózott saját számla, az OS-ben vagy a Számlázz.hu-n
              (számlázási brief, 1. pont) */}
          {item.cancelled ? (
            <span className="inline-flex items-center rounded-full bg-pilot-red-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-pilot-red-700">
              Sztornózott
            </span>
          ) : null}
        </span>
      ),
    },
    // The customer column takes what the fixed ones leave (at least ~150 px at the table's
    // minimum width): with their old widths summing to more than the card, it collapsed to
    // nothing and its header ran into "Kiállítás" (stage photo, 2026-11-03).
    {
      id: "customer",
      header: "Vevő",
      cell: (item) => (
        <span className="block truncate" title={item.customerName}>
          {item.customerName}
          {/* a magánszemély neve a webshop-rendelésből (acrobot 26096) */}
          {item.customerNameFromOrder ? (
            <span className="block text-xs text-pilot-grey-500">
              a rendelésből
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "issueDate",
      header: "Kiállítás",
      nowrap: true,
      width: "120px",
      cell: (item) => formatDay(item.issueDate),
    },
    {
      id: "dueDate",
      header: "Határidő",
      nowrap: true,
      width: "120px",
      cell: (item) => formatDay(item.dueDate),
    },
    {
      // a bejövő lista oszlopa és számformátuma (Luca, 2026-11-04): a pénznem-jelet a Deviza oszlop adja
      id: "currency",
      header: "Deviza",
      width: "80px",
      cell: (item) => (
        <span className="font-semibold text-pilot-grey-900">
          {currencyLabel(item.currency)}
        </span>
      ),
    },
    {
      // együtt látszik a nettó, az ÁFA és a bruttó, ugyanabban a sorrendben és formában, mint a bejövőn
      id: "totals",
      header: "Összegek",
      width: "170px",
      align: "right",
      cell: (item) => (
        <span className="flex flex-col items-end gap-0.5 whitespace-nowrap tabular-nums">
          <span className="text-xs text-pilot-grey-600">
            Nettó {listAmount(item.netAmount, item.currency)}
          </span>
          <span className="text-xs text-pilot-grey-600">
            ÁFA {listAmount(item.vatAmount, item.currency)}
          </span>
          <span className="font-semibold text-pilot-grey-900">
            Bruttó {listAmount(item.grossAmount, item.currency)}
          </span>
        </span>
      ),
    },
    {
      // a fizetési mód és alatta a kifizetés jelzése, ahogy a bejövő listán
      id: "payment",
      header: "Fizetés",
      width: "130px",
      cell: (item) => (
        <span className="flex flex-col gap-0.5">
          <span className="text-pilot-grey-900">
            {item.paymentMethod ?? "—"}
          </span>
          <PaymentBadge
            paymentState={item.paymentState}
            paidAmount={item.paidAmount}
            lastPaymentDate={item.lastPaymentDate}
            paymentSource={item.paymentSource}
            currency={item.currency}
          />
        </span>
      ),
    },
    {
      // megvan-e a PDF, és ha nincs, miért (Balázs, 2026-10-21); ugyanaz, amit a havi csomag lát
      id: "pdf",
      header: "PDF",
      width: "110px",
      cell: (item) => <PdfStateBadge item={item} />,
    },
    {
      id: "status",
      header: "Állapot",
      width: "130px",
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
        } ${item.documentNumber ?? "piszkozat"}${
          item.cancelled ? " (sztornózott)" : ""
        }, ${item.customerName} megnyitása`
      }
      minWidth={BILLING_TABLE_MIN_WIDTH}
    />
  );
}
