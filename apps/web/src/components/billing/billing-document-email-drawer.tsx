"use client";

import {
  PilotButton,
  PilotDrawer,
  PilotFormField,
  PilotInput,
  PilotSelect,
  PilotVariableChips,
} from "@acropora/ui";
import {
  billingDrawerCta,
  getDocumentCapabilities,
  INVOICE_FORMAT_LABELS,
  type BillingDocumentType,
  type InvoiceFormat,
} from "@acropora/types";
import { useRef, useState } from "react";

/**
 * A KIKÜLDŐ FIÓK (brief 16-17. pont), általános néven: nem "invoice email",
 * mert díjbekérőt és előlegszámlát is küld.
 *
 * A VÁLTOZÓK: az alap a `{document_number}` és a `{document_link}`; az
 * `{invoice_number}` csak számlánál kínálkozik, kompatibilitásból. Ami a
 * kiállítás előtt nem ismert (a szám, a hivatkozás), az az előnézetben
 * jelölve marad, nem kitalált értékkel.
 *
 * A VÉGSŐ GOMB TILTOTT, amíg a kiküldés nincs bekötve (nautilus). A fiók maga
 * használható: a levél megírható és előnézhető.
 */
export interface BillingEmailDraft {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
}

export function billingEmailVariables(
  documentType: BillingDocumentType,
): string[] {
  return [
    "{customer_name}",
    "{document_number}",
    ...(documentType === "INVOICE" ? ["{invoice_number}"] : []),
    "{gross_total}",
    "{due_date}",
    "{document_link}",
    "{order_number}",
  ];
}

/** A tárgyeset kézzel: a "-t" rag nem toldható vakon ("szállítólevelet"). */
const ACCUSATIVE: Record<BillingDocumentType, string> = {
  INVOICE: "számlát",
  PROFORMA: "díjbekérőt",
  ADVANCE_INVOICE: "előlegszámlát",
  DELIVERY_NOTE: "szállítólevelet",
};

export function defaultBillingEmail(
  documentType: BillingDocumentType,
  to: string,
): BillingEmailDraft {
  return {
    to,
    cc: "",
    bcc: "",
    subject: "Acropora – {document_number}",
    body: [
      "Kedves {customer_name}!",
      "",
      `Csatoltan küldjük a(z) {document_number} számú ${ACCUSATIVE[documentType]}.`,
      "",
      "Fizetendő összeg: {gross_total}",
      "Fizetési határidő: {due_date}",
      "",
      "Köszönjük!",
      "Acropora",
    ].join("\n"),
  };
}

/** Az előnézet: az ismert változók behelyettesítve, a többi jelölve marad. */
export function previewBillingEmail(
  text: string,
  known: Record<string, string>,
): string {
  return text.replace(
    /\{[a-z_]+\}/g,
    (variable) => known[variable] ?? variable,
  );
}

export function BillingDocumentEmailDrawer({
  open,
  onClose,
  documentType,
  format,
  draft,
  onChange,
  customerName,
  grossLabel,
  meta,
  known,
}: {
  open: boolean;
  onClose: () => void;
  documentType: BillingDocumentType;
  format: InvoiceFormat | null;
  draft: BillingEmailDraft;
  onChange: (draft: BillingEmailDraft) => void;
  customerName: string;
  grossLabel: string;
  meta: string;
  known: Record<string, string>;
}) {
  const [showCopies, setShowCopies] = useState(
    draft.cc !== "" || draft.bcc !== "",
  );
  const [preview, setPreview] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const noun = getDocumentCapabilities(documentType).label;

  const insert = (variable: string) => {
    const element = bodyRef.current;
    const at = element?.selectionStart ?? draft.body.length;
    const end = element?.selectionEnd ?? at;
    onChange({
      ...draft,
      body: `${draft.body.slice(0, at)}${variable}${draft.body.slice(end)}`,
    });
  };

  return (
    <PilotDrawer
      open={open}
      onClose={onClose}
      width="xl"
      title={`${format === "ELECTRONIC" && documentType === "INVOICE" ? "E-számla" : noun} kiküldése`}
      subtitle="A levél a bizonylat végleges kiállítása előtt szerkeszthető."
      footer={
        <div className="space-y-3">
          <p className="text-xs text-pilot-grey-500">
            A kiállítás elküldi az adatokat a Számlázz.hu-nak, majd siker esetén
            az értesítő levelet. A kiküldés a Számlázz.hu bekötésével érkezik.
          </p>
          <div className="flex gap-2">
            <PilotButton variant="secondary" size="regular" onClick={onClose}>
              Mégse
            </PilotButton>
            <PilotButton
              variant="primary"
              size="regular"
              disabled
              title="A kiküldés a Számlázz.hu bekötésével érkezik."
            >
              {billingDrawerCta(documentType, format)}
            </PilotButton>
          </div>
        </div>
      }
    >
      {/* A BELSŐ MARGÓ (Balázs a stage-en, 2026-09-30: "ne erjen hozza a
          szoveg a szelehez"): a fejléc és a lábléc px-6-ja a törzsre is. */}
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <div className="rounded-xl bg-pilot-grey-50 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <p className="font-semibold text-pilot-grey-900">{customerName}</p>
            {format ? (
              <span className="text-xs text-pilot-blue-700">
                {INVOICE_FORMAT_LABELS[format]}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-2xl font-semibold text-pilot-grey-900">
            {grossLabel}
          </p>
          <p className="mt-1 text-xs text-pilot-grey-600">{meta}</p>
        </div>
        <div className="rounded-xl border border-pilot-accent-warm bg-pilot-accent-warm-soft px-4 py-3 text-xs text-pilot-accent-warm-text">
          <p className="font-semibold">A bizonylat száma még nem ismert</p>
          <p className="mt-1">
            A {"{document_number}"} változó a sikeres Számlázz.hu kiállítás után
            helyettesítődik be.
          </p>
        </div>
        <PilotFormField label="Címzett">
          <PilotInput
            aria-label="Címzett"
            type="email"
            value={draft.to}
            onChange={(to) => onChange({ ...draft, to })}
          />
        </PilotFormField>
        {showCopies ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <PilotFormField label="Másolat (CC)">
              <PilotInput
                aria-label="Másolat (CC)"
                value={draft.cc}
                onChange={(cc) => onChange({ ...draft, cc })}
              />
            </PilotFormField>
            <PilotFormField label="Titkos másolat (BCC)">
              <PilotInput
                aria-label="Titkos másolat (BCC)"
                value={draft.bcc}
                onChange={(bcc) => onChange({ ...draft, bcc })}
              />
            </PilotFormField>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowCopies(true)}
            className="cursor-pointer text-xs font-medium text-pilot-aqua-700 hover:underline"
          >
            Másolat / titkos másolat hozzáadása
          </button>
        )}
        <PilotFormField label="Sablon">
          <PilotSelect aria-label="Sablon" chevron value="default">
            <option value="default">
              Alapértelmezett {noun.toLowerCase()}
            </option>
          </PilotSelect>
        </PilotFormField>
        <PilotFormField label="Tárgy">
          <PilotInput
            aria-label="Tárgy"
            value={draft.subject}
            onChange={(subject) => onChange({ ...draft, subject })}
          />
        </PilotFormField>
        <PilotFormField label="Levél tartalma">
          {preview ? (
            <div
              aria-label="Levél előnézete"
              className="min-h-56 whitespace-pre-wrap rounded-lg bg-pilot-grey-50 px-4 py-3 text-sm text-pilot-grey-800"
            >
              {previewBillingEmail(draft.body, known)}
            </div>
          ) : (
            <textarea
              ref={bodyRef}
              aria-label="Levél tartalma"
              value={draft.body}
              onChange={(event) =>
                onChange({ ...draft, body: event.target.value })
              }
              rows={10}
              className="w-full rounded-lg px-4 py-3 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
            />
          )}
        </PilotFormField>
        {preview ? null : (
          <PilotVariableChips
            variables={billingEmailVariables(documentType)}
            onInsert={insert}
          />
        )}
        <div className="flex items-center gap-3">
          <PilotButton
            variant="secondary"
            size="regular"
            onClick={() => setPreview((current) => !current)}
          >
            {preview ? "Vissza a szerkesztéshez" : "Levél előnézete"}
          </PilotButton>
          <p className="text-xs text-pilot-grey-500">
            A végleges levél a sikeres kiállítás után kapja meg a bizonylat
            számát és hivatkozását.
          </p>
        </div>
      </div>
    </PilotDrawer>
  );
}
