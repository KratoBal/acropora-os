"use client";

import {
  MISSING_INVOICE_PACKAGE_PDF_LACKING,
  type MissingInvoicePackageCheck,
  type MissingInvoicePackagePdf,
  type MissingInvoicePackageUnpaidInvoice,
} from "@acropora/types";
import { PilotBadge, PilotButton, PilotDataTable } from "@acropora/ui";
import type { PilotBadgeVariant } from "@acropora/ui";
import { useRef } from "react";

import { formatAmount, formatDay } from "./missing-invoices-model";

/** A csomag-döntés felirata a lapon (ugyanaz a döntés, mint a csomag borítóján). */
export const PACKAGE_PDF_LABELS: Record<MissingInvoicePackagePdf, string> = {
  ATTACHED: "PDF a csomagban",
  PAPER: "Papíron megvan",
  NOT_PDF: "Nem PDF",
  NO_FILE: "Nincs tárolt fájl",
  PDF_MISSING: "PDF hiányzik",
};

const PACKAGE_PDF_BADGES: Record<MissingInvoicePackagePdf, PilotBadgeVariant> =
  {
    ATTACHED: "success",
    PAPER: "grey",
    NOT_PDF: "danger",
    NO_FILE: "danger",
    PDF_MISSING: "danger",
  };

export function isPdfLacking(pdf: MissingInvoicePackagePdf): boolean {
  return MISSING_INVOICE_PACKAGE_PDF_LACKING.has(pdf);
}

/**
 * Csak a `PDF_MISSING` sorhoz csatolható PDF: a szerver a PDF-es sorra 409-et
 * ad, és a „nem PDF” vagy „nincs tárolt fájl” sornál már van (rossz) fájl.
 */
export function canAttachPdf(pdf: MissingInvoicePackagePdf): boolean {
  return pdf === "PDF_MISSING";
}

export function PackagePdfBadge({ pdf }: { pdf: MissingInvoicePackagePdf }) {
  return (
    <PilotBadge variant={PACKAGE_PDF_BADGES[pdf]}>
      {PACKAGE_PDF_LABELS[pdf]}
    </PilotBadge>
  );
}

/** Egy rejtett fájlválasztó gomb: a kiválasztott PDF-et átadja. */
export function AttachPdfButton({
  label,
  busy,
  onFile,
}: {
  label: string;
  busy: boolean;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <PilotButton
        variant="secondary"
        size="action"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? "Feltöltés…" : "PDF csatolása"}
      </PilotButton>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        aria-label={label}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
    </>
  );
}

/**
 * A CSOMAGBÓL HIÁNYZÓ PDF-EK SÁVJA a hónap lapja tetején (Balázs, 2026-11-02
 * 22:37 UTC: a könyvelői csomag borítóján „nem PDF”, a Hiányzó számlák lapon
 * pedig ez nem látszott). A szám ugyanabból a döntésből jön, mint a csomag
 * borítója. A lap csak a fájl fejlécét nézi, ezért a sérült, nem olvasható PDF-et
 * nem látja: azt a csomag építése jelzi, és a sáv ezt kimondja.
 */
export function PackageCheckBanner({
  check,
  filtered,
  onFilter,
}: {
  check: MissingInvoicePackageCheck;
  filtered: boolean;
  onFilter: (on: boolean) => void;
}) {
  const unpaidLacking = check.unpaid.filter((invoice) =>
    isPdfLacking(invoice.pdf),
  ).length;
  if (check.lackingCount === 0)
    return (
      <p
        role="status"
        className="rounded-xl bg-pilot-green-50 px-5 py-3 text-sm text-pilot-green-700 ring-1 ring-pilot-grey-200"
      >
        A könyvelői csomagban minden számlának megvan a PDF-je vagy papíron
        megvan. (Az ellenőrzés a fájl fejlécét nézi: a sérült, nem olvasható
        PDF-et csak a csomag építése jelzi.)
      </p>
    );
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-pilot-amber-50 px-5 py-3 text-sm ring-1 ring-pilot-grey-200"
    >
      <p className="text-pilot-grey-800">
        <span className="font-semibold">
          A könyvelői csomagból hiányzik {check.lackingCount} számla PDF-je
        </span>
        {unpaidLacking > 0
          ? ` (ebből ${unpaidLacking} még ki nem fizetett számla)`
          : ""}
        . Az ellenőrzés a fájl fejlécét nézi: a sérült, nem olvasható PDF-et
        csak a csomag építése jelzi.
      </p>
      <PilotButton
        variant="secondary"
        size="action"
        onClick={() => onFilter(!filtered)}
      >
        {filtered ? "Minden Megvan tétel" : "Csak a PDF nélküliek"}
      </PilotButton>
    </div>
  );
}

/**
 * A HÓNAP KI NEM FIZETETT BEJÖVŐ SZÁMLÁI: a csomagban szerepelnek (a teljesítés
 * napja szerint), de a banki terhelésük még nincs, ezért a Terhelések listán
 * nem látszanak. A PDF-státuszuk a csomagé; a hiányzó PDF innen csatolható.
 */
export function PackageUnpaidBlock({
  invoices,
  canManage,
  busyId,
  onAttach,
}: {
  invoices: readonly MissingInvoicePackageUnpaidInvoice[];
  canManage: boolean;
  busyId: string | null;
  onAttach: (invoice: MissingInvoicePackageUnpaidInvoice, file: File) => void;
}) {
  if (invoices.length === 0) return null;
  return (
    <section
      aria-label="Ki nem fizetett bejövő számlák"
      className="overflow-hidden rounded-xl bg-white ring-1 ring-pilot-grey-200"
    >
      <div className="px-5 py-4">
        <h2 className="text-base font-semibold text-pilot-grey-900">
          Ki nem fizetett bejövő számlák
        </h2>
        <p className="mt-1 text-xs text-pilot-grey-500">
          A hónap számlái, amelyekhez még nincs banki terhelés. A könyvelői
          csomagban a teljesítés napja szerint szerepelnek.
        </p>
      </div>
      <PilotDataTable
        columns={[
          {
            id: "number",
            header: "Számla",
            width: "170px",
            cell: (invoice: MissingInvoicePackageUnpaidInvoice) => (
              <span className="block truncate" title={invoice.number}>
                {invoice.number}
              </span>
            ),
          },
          {
            id: "supplier",
            header: "Szállító",
            cell: (invoice: MissingInvoicePackageUnpaidInvoice) => (
              <span
                className="block truncate font-semibold text-pilot-grey-900"
                title={invoice.supplier}
              >
                {invoice.supplier}
              </span>
            ),
          },
          {
            id: "date",
            header: "Teljesítés",
            width: "108px",
            cell: (invoice: MissingInvoicePackageUnpaidInvoice) => (
              <span className="whitespace-nowrap tabular-nums">
                {formatDay(invoice.date)}
              </span>
            ),
          },
          {
            id: "amount",
            header: "Összeg",
            width: "118px",
            align: "right",
            cell: (invoice: MissingInvoicePackageUnpaidInvoice) => (
              <span className="whitespace-nowrap font-semibold tabular-nums">
                {formatAmount(invoice.amount, invoice.currency)}
              </span>
            ),
          },
          {
            id: "pdf",
            header: "PDF",
            width: "150px",
            cell: (invoice: MissingInvoicePackageUnpaidInvoice) => (
              <PackagePdfBadge pdf={invoice.pdf} />
            ),
          },
          {
            id: "attach",
            header: <span className="sr-only">Csatolás</span>,
            width: "150px",
            align: "right",
            cell: (invoice: MissingInvoicePackageUnpaidInvoice) =>
              canManage && canAttachPdf(invoice.pdf) ? (
                <AttachPdfButton
                  label={`${invoice.number} PDF-je`}
                  busy={busyId === invoice.id}
                  onFile={(file) => onAttach(invoice, file)}
                />
              ) : null,
          },
        ]}
        rows={[...invoices]}
        rowKey={(invoice) => invoice.id}
        rowLabel={(invoice) => `${invoice.supplier}, ${invoice.number}`}
        minWidth={900}
      />
    </section>
  );
}
