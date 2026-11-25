"use client";

import {
  Icon,
  PilotDataTable,
  type PilotTableColumn,
  type PilotTableSort,
} from "@acropora/ui";
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
  /** A TIG-számla piszkozata a szerviz munka vagy a megrendelés lapjára visz, nem a számlázás szerkesztőjébe. */
  maintenanceDraft?: BillingDocumentListItem["maintenanceDraft"];
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
export const BILLING_TABLE_MIN_WIDTH = 1120;
export const BILLING_CUSTOMER_MIN_WIDTH = 130;

/**
 * A SOR CÉLJA RÖVID FELIRATTAL (acrobot 61971): a sor végi nyíl mellett áll, hogy a sor megmondja, HOVA visz. A vázlat a szerkesztőbe
 * nyílik, minden más (a TIG-piszkozat a karbantartási lapra, hibajegyre vagy megrendelésre, a kiállított és a külső bizonylat az
 * adatlapra) az adatlapnak számít. Az útvonalat a közös szabály adja (`billingDocumentHref`), a felirat abból következik.
 */
export function billingDocumentTargetLabel(
  item: Parameters<typeof billingDocumentHref>[0],
): "Szerkesztő" | "Adatlap" {
  return billingDocumentHref(item).endsWith("/szerkesztes")
    ? "Szerkesztő"
    : "Adatlap";
}

/**
 * AZ OSZLOP-DEFINÍCIÓ EGY HELYEN (brief 6. pont): a fejléc és a sorok UGYANEBBŐL
 * rajzolnak (`PilotDataTable`), ugyanúgy, mint a Termékeknél és a
 * Beszerzésnél. A vevő oszlopa vág, nem tol: egy hosszú név nem csúsztatja el
 * az összeget az állapotba.
 *
 * PICASSO 3.12 (acrobot 61971), AMI ITT VÁLTOZOTT: a Dokumentum és a Bizonylatszám egy oszlop (a típus és a formátum a szám alatt),
 * a Deviza oszlop megszűnt (a pénznem az összeg mellett áll), az Összegek három sora egy sor (bruttó; a nettó és az ÁFA a
 * megjegyzésben), a vázlat "Piszkozat" szava helyett a szám helyén halvány "nincs még szám" áll (az állapot az Állapot oszlopban
 * van). Így a tábla 1440 px-en elfér, és az Állapot oszlop látszik. Telefonon a kártya a számot, a vevőt, a kiállítást, az összeget és
 * az állapotot mutatja.
 */
export const BILLING_DOCUMENT_COLUMNS: readonly PilotTableColumn<BillingDocumentListItem>[] =
  [
    {
      id: "number",
      header: "Bizonylat",
      width: "200px",
      phone: "title",
      cell: (item) => (
        <span className="flex flex-col items-start gap-0.5">
          {item.documentNumber ? (
            <span className="font-semibold text-pilot-grey-900">
              {item.documentNumber}
            </span>
          ) : (
            <span className="text-pilot-grey-400">nincs még szám</span>
          )}
          <span className="text-xs text-pilot-grey-600">
            {item.externalKindLabel ??
              getDocumentCapabilities(item.documentType).label}
            {item.invoiceFormat ? (
              <>
                <span aria-hidden="true"> · </span>
                <span className="text-pilot-aqua-700">
                  {INVOICE_FORMAT_LABELS[item.invoiceFormat]}
                </span>
              </>
            ) : null}
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
    // The customer column takes what the fixed ones leave (at least ~130 px at the table's
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
      sortable: true,
      nowrap: true,
      width: "105px",
      cell: (item) => formatDay(item.issueDate),
    },
    {
      id: "dueDate",
      header: "Határidő",
      sortable: true,
      nowrap: true,
      width: "105px",
      phone: "hide",
      cell: (item) => formatDay(item.dueDate),
    },
    {
      // egy sorban a bruttó, a pénznem-jellel; a nettó és az ÁFA a megjegyzésben és a felolvasónak (acrobot 61971)
      id: "totals",
      header: "Összeg",
      sortable: true,
      width: "130px",
      align: "right",
      nowrap: true,
      cell: (item) => {
        const breakdown = `Nettó ${listAmount(item.netAmount, item.currency)}, ÁFA ${listAmount(item.vatAmount, item.currency)}, bruttó ${listAmount(item.grossAmount, item.currency)} ${currencyLabel(item.currency)}`;
        return (
          <span
            title={breakdown}
            className="whitespace-nowrap font-semibold tabular-nums text-pilot-grey-900"
          >
            {item.grossAmount === null
              ? "—"
              : `${listAmount(item.grossAmount, item.currency)} ${currencyLabel(item.currency)}`}
            <span className="sr-only">. {breakdown}</span>
          </span>
        );
      },
    },
    {
      // a fizetési mód és alatta a kifizetés jelzése, ahogy a bejövő listán
      id: "payment",
      header: "Fizetés",
      width: "130px",
      phone: "hide",
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
      // megvan-e a PDF, és ha nincs, miért (Balázs, 2026-10-21); ugyanaz, amit a havi csomag llát
      id: "pdf",
      header: "PDF",
      width: "90px",
      phone: "hide",
      cell: (item) => <PdfStateBadge item={item} />,
    },
    {
      id: "status",
      header: "Állapot",
      width: "120px",
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
      width: "110px",
      align: "right",
      phone: "hide",
      // CSAK VIZUÁLIS JEL: a sor maga nyílik (brief 7. pont); a felirat megmondja, hova (Szerkesztő vagy Adatlap).
      cell: (item) => (
        <span
          aria-hidden="true"
          className="inline-flex items-center gap-1 text-xs font-medium text-pilot-aqua-700"
        >
          {billingDocumentTargetLabel(item)}
          <Icon name="chevron-left" size={14} className="rotate-180" />
        </span>
      ),
    },
  ];

/**
 * A RENDEZHETŐ OSZLOPOK (Balázs kérése, kártya 2f6369a4): a tábla oszlop-azonosítója -> a szerver mezője. A lista két forrásból áll
 * össze, ezért csak a mindkettőben közös számszerű/nap-értékű oszlopok rendezhetők: a kiállítás napja, a határidő és az összeg (bruttó).
 * A szöveges oszlopok (vevő, bizonylatszám, fizetési mód) egy egységes lekérdezést kérnek, külön munka.
 */
export const BILLING_SORT_COLUMNS = {
  issueDate: "issueDate",
  dueDate: "dueDate",
  totals: "grossAmount",
} as const;

export function BillingDocumentTable({
  items,
  onOpen,
  sort,
  onSort,
}: {
  items: readonly BillingDocumentListItem[];
  onOpen: (item: BillingDocumentListItem) => void;
  sort?: PilotTableSort | null;
  onSort?: (columnId: string) => void;
}) {
  return (
    <PilotDataTable
      columns={BILLING_DOCUMENT_COLUMNS}
      rows={items}
      rowKey={(item) => item.id}
      onRowActivate={onOpen}
      sort={sort}
      onSort={onSort}
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
