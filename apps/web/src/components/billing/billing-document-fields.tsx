"use client";

import {
  PilotFormField,
  PilotInput,
  PilotSection,
  PilotSelect,
} from "@acropora/ui";
import {
  getDocumentCapabilities,
  INVOICE_FORMAT_LABELS,
  type InvoiceFormat,
} from "@acropora/types";

import {
  CURRENCIES,
  LANGUAGES,
  PAYMENT_METHODS,
  type EditorState,
} from "./billing-editor-state";

type FieldKey =
  | "fulfillmentDate"
  | "dueDate"
  | "paymentMethod"
  | "currency"
  | "language"
  | "reference"
  | "note";

/**
 * A BIZONYLAT ADATAI (brief 7. pont). A fizetési mezők csak ott látszanak, ahol
 * a típus mutatja őket (`showsPaymentFields`); a szállítólevélen eltűnnek,
 * az értékük a szerkesztő állapotában megmarad.
 */
export function BillingDocumentFields({
  state,
  format,
  onChange,
  disabled,
}: {
  state: EditorState;
  format: InvoiceFormat | null;
  onChange: (key: FieldKey, value: string) => void;
  disabled?: boolean;
}) {
  const capabilities = getDocumentCapabilities(state.documentType);
  return (
    <PilotSection
      title={`${capabilities.label} adatai`}
      subtitle="A kiállítás dátuma automatikusan a tényleges kiállítás napja."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <PilotFormField label="Teljesítés dátuma">
          <PilotInput
            aria-label="Teljesítés dátuma"
            type="date"
            value={state.fulfillmentDate}
            onChange={(value) => onChange("fulfillmentDate", value)}
            disabled={disabled}
          />
        </PilotFormField>
        {capabilities.showsPaymentFields ? (
          <>
            <PilotFormField label="Fizetési határidő">
              <PilotInput
                aria-label="Fizetési határidő"
                type="date"
                value={state.dueDate}
                onChange={(value) => onChange("dueDate", value)}
                disabled={disabled}
              />
            </PilotFormField>
            <PilotFormField label="Fizetési mód">
              <PilotSelect
                aria-label="Fizetési mód"
                chevron
                value={state.paymentMethod}
                onChange={(value) => onChange("paymentMethod", value)}
                disabled={disabled}
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </PilotSelect>
            </PilotFormField>
          </>
        ) : null}
        <PilotFormField label="Pénznem">
          <PilotSelect
            aria-label="Pénznem"
            chevron
            value={state.currency}
            onChange={(value) => onChange("currency", value)}
            disabled={disabled}
          >
            {CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </PilotSelect>
        </PilotFormField>
        <PilotFormField label="Nyelv">
          <PilotSelect
            aria-label="Nyelv"
            chevron
            value={state.language}
            onChange={(value) => onChange("language", value)}
            disabled={disabled}
          >
            {LANGUAGES.map((language) => (
              <option key={language.value} value={language.value}>
                {language.label}
              </option>
            ))}
          </PilotSelect>
        </PilotFormField>
        <PilotFormField label="Hivatkozási szám">
          <PilotInput
            aria-label="Hivatkozási szám"
            value={state.reference}
            onChange={(value) => onChange("reference", value)}
            disabled={disabled}
          />
        </PilotFormField>
        <PilotFormField label="Megjegyzés" className="sm:col-span-2">
          <PilotInput
            aria-label="Megjegyzés"
            placeholder="A bizonylatra kerülő megjegyzés"
            value={state.note}
            onChange={(value) => onChange("note", value)}
            disabled={disabled}
          />
        </PilotFormField>
      </div>
      <p className="mt-4 text-xs text-pilot-grey-500">
        Kiállítás dátuma: automatikus
        {format ? ` · Formátum: ${INVOICE_FORMAT_LABELS[format]}` : ""}
      </p>
    </PilotSection>
  );
}
