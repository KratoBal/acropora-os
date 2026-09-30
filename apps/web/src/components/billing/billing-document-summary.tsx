"use client";

import {
  PilotBadge,
  PilotButton,
  PilotSection,
  PilotTotals,
} from "@acropora/ui";
import {
  billingIssueCta,
  getDocumentCapabilities,
  INVOICE_FORMAT_LABELS,
  type BillingDocumentType,
  type InvoiceFormat,
} from "@acropora/types";

import {
  formatMoney,
  trimDecimal,
  type BillingPreview,
} from "./billing-editor-state";

/**
 * AZ ÖSSZESÍTŐ KÁRTYA (brief 25-26. pont): a címe, a jelvényei és a fő gombja
 * a típust és a formátumot követi, és a kettő külön jelvény: a "Számla" és az
 * "E-számla" nem mosódik egybe.
 *
 * A KIÁLLÍTÁS GOMBJA TILTOTT, amíg a Számlázz.hu kiállítás nincs bekötve
 * (nautilus, az adapterrel). A felirat már a végleges, a `title` megmondja,
 * miért nem nyomható. A mentés viszont működik: az a saját adatbázisunkba ír.
 */
export function BillingDocumentSummary({
  documentType,
  format,
  currency,
  paymentMethod,
  preview,
  onSave,
  saving,
  saveDisabledReason,
  savedLabel,
}: {
  documentType: BillingDocumentType;
  format: InvoiceFormat | null;
  currency: string;
  paymentMethod: string | null;
  /** Az összeg, ahogy a számlán állni fog (`billingPreview`); `null`: hibás bemenet. */
  preview: BillingPreview | null;
  onSave: () => void;
  saving: boolean;
  /** Miért nem menthető még; `null`: menthető. */
  saveDisabledReason: string | null;
  /** "Mentve 16:42" vagy `null`, ha még nincs mentve. */
  savedLabel: string | null;
}) {
  const capabilities = getDocumentCapabilities(documentType);
  const rows = preview
    ? [
        {
          label: "Nettó",
          value: formatMoney(preview.totals.netAmount, currency),
        },
        ...preview.byVatRate.map((rate) => ({
          label: `ÁFA (${trimDecimal(rate.vatRatePercent)}%)`,
          value: formatMoney(rate.vatAmount, currency),
        })),
        {
          label: "Bruttó",
          value: formatMoney(preview.totals.grossAmount, currency),
          emphasis: true,
        },
      ]
    : [];

  return (
    <PilotSection
      title={capabilities.summaryTitle}
      subtitle="Kiállítás előtt ellenőrizd az összegeket."
    >
      {preview ? (
        <>
          <PilotTotals rows={rows} />
          {preview.zeroForintLines.length > 0 ? (
            <p className="mt-3 text-xs text-pilot-accent-warm-text">
              {preview.zeroForintLines
                .map((index) => `${index + 1}.`)
                .join(", ")}{" "}
              tétel a forint-kerekítés után 0 Ft-tal áll a bizonylaton.
            </p>
          ) : null}
        </>
      ) : (
        <p role="alert" className="text-sm text-pilot-red-700">
          Valamelyik tétel száma nem érvényes, ezért az összeg nem számolható.
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-2 border-t border-pilot-grey-100 pt-4">
        <PilotBadge variant="teal">{capabilities.label}</PilotBadge>
        {format ? (
          <PilotBadge variant="blue">
            {INVOICE_FORMAT_LABELS[format]}
          </PilotBadge>
        ) : null}
        <PilotBadge variant="grey">{currency}</PilotBadge>
        {capabilities.showsPaymentFields && paymentMethod ? (
          <PilotBadge variant="grey">{paymentMethod}</PilotBadge>
        ) : null}
      </div>
      <p className="mt-4 rounded-lg bg-pilot-accent-warm-soft px-4 py-3 text-xs text-pilot-accent-warm-text">
        A bizonylat számát a Számlázz.hu adja a sikeres kiállításkor. Addig ez
        egy belső vázlat.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        <PilotButton
          variant="secondary"
          size="regular"
          onClick={onSave}
          disabled={saving || saveDisabledReason !== null}
          title={saveDisabledReason ?? undefined}
        >
          {saving ? "Mentés…" : "Vázlat mentése"}
        </PilotButton>
        <PilotButton
          variant="primary"
          size="regular"
          disabled
          title="A kiállítás a Számlázz.hu bekötésével érkezik."
        >
          {billingIssueCta(documentType, format)}
        </PilotButton>
        <p className="text-xs text-pilot-grey-500">
          {saveDisabledReason
            ? `Mentéshez hiányzik: ${saveDisabledReason}.`
            : (savedLabel ?? "A vázlat még nincs mentve.")}{" "}
          A kiállítás a Számlázz.hu bekötésével érkezik.
        </p>
      </div>
    </PilotSection>
  );
}
