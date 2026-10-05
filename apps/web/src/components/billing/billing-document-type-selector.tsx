"use client";

import { PilotRadioGroup } from "@acropora/ui";
import {
  BILLING_DOCUMENT_TYPES,
  getDocumentCapabilities,
  INVOICE_FORMAT_LABELS,
  type BillingDocumentType,
  type InvoiceFormat,
} from "@acropora/types";

const SOURCE_LABELS: Record<string, string> = {
  PROJECT: "Projekt",
  SALES_ORDER: "Webshop rendelés",
  POS_TRANSACTION: "POS tranzakció",
  WEBSHOP_ORDER: "Webshop rendelés",
  SERVICE_JOB: "Szerviz munka",
  MANUAL: "Manuális",
};

/**
 * A SZÁMLÁZZ.HU CALLOUT A KÉT VÁLASZTÓVAL (brief 4-5. és 29. pont): a meleg
 * narancs mezőben a Dokumentum és a Formátum rádiócsoport, egy sorban.
 *
 * A FORMÁTUM A TÍPUS KÉPESSÉGÉT KÖVETI: ahol a típusnak nincs formátuma
 * (díjbekérő, szállítólevél), a csoport nem jelenik meg, helyette egy mondat
 * mondja meg, miért. Egy tiltott rádiócsoport azt sugallná, hogy valaki majd
 * engedélyezi; itt a választás nem értelmezett.
 */
export function BillingDocumentTypeSelector({
  documentType,
  format,
  onTypeChange,
  onFormatChange,
  source,
  hiddenNote,
}: {
  documentType: BillingDocumentType;
  format: InvoiceFormat | null;
  onTypeChange: (type: BillingDocumentType) => void;
  onFormatChange: (format: InvoiceFormat) => void;
  source: { type: string; id: string | null } | null;
  /** Mit rejtett el a típusváltás a kitöltött mezők közül; `null`: semmit. */
  hiddenNote: string | null;
}) {
  const capabilities = getDocumentCapabilities(documentType);
  return (
    <section
      aria-label="Számlázz.hu bizonylat"
      className="rounded-xl border border-pilot-accent-warm bg-pilot-accent-warm-soft px-5 py-4"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-pilot-accent-warm-text">
            Számlázz.hu
          </h2>
          <p className="mt-1 text-xs leading-5 text-pilot-grey-700">
            Válaszd ki a kiállítandó dokumentum típusát és, ahol értelmezett, a
            számla formátumát.
          </p>
        </div>
        {source ? (
          <span className="shrink-0 rounded-md bg-white/70 px-2 py-1 text-xs text-pilot-grey-600">
            Forrás: {SOURCE_LABELS[source.type] ?? source.type}
            {source.id ? ` · ${source.id}` : ""}
          </span>
        ) : null}
      </div>
      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <PilotRadioGroup
          name="billing-document-type"
          label="Dokumentum"
          value={documentType}
          onChange={onTypeChange}
          options={BILLING_DOCUMENT_TYPES.map((type) => ({
            value: type,
            label: getDocumentCapabilities(type).label,
          }))}
        />
        {capabilities.formats.length > 0 ? (
          <PilotRadioGroup
            name="billing-document-format"
            label="Formátum"
            value={format}
            onChange={onFormatChange}
            options={capabilities.formats.map((value) => ({
              value,
              label: INVOICE_FORMAT_LABELS[value],
            }))}
          />
        ) : (
          <p className="text-xs text-pilot-grey-600">
            A {capabilities.label.toLowerCase()} formátuma nem választható.
          </p>
        )}
      </div>
      {hiddenNote ? (
        <p className="mt-3 text-xs text-pilot-accent-warm-text" role="status">
          {hiddenNote}
        </p>
      ) : null}
    </section>
  );
}
