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
  plainTextToRichHtml,
  richHtmlToText,
  sanitizeRichHtml,
} from "@acropora/rich-text";
import {
  billingDrawerCta,
  getDocumentCapabilities,
  INVOICE_FORMAT_LABELS,
  renderMailTemplateHtml,
  type BillingDocumentType,
  type InvoiceFormat,
} from "@acropora/types";
import {
  RichTextEditor,
  type RichTextEditorHandle,
} from "@acropora/ui/rich-text-editor";
import { useRef, useState } from "react";

/**
 * A KIKÜLDŐ FIÓK (brief 16-17. pont), általános néven: nem "invoice email",
 * mert díjbekérőt és előlegszámlát is küld.
 *
 * A VÁLTOZÓK `{{név}}` alakban (a Levelezés sablonjaival közös alak, nautilus
 * #1293; a szerver a régi `{név}`-et is feloldja, tehát a már megírt szöveg nem
 * törik el). Az alap a `{{document_number}}` és a `{{document_link}}`; az
 * `{{invoice_number}}` csak számlánál és előlegszámlánál kínálkozik, mert csak
 * ott van értéke (a közös változó-leírás szerint). Ami a
 * kiállítás előtt nem ismert (a szám, a hivatkozás), az az előnézetben
 * jelölve marad, nem kitalált értékkel.
 *
 * A VÉGSŐ GOMB TILTOTT, amíg a kiküldés nincs bekötve (nautilus). A fiók maga
 * használható: a levél megírható és előnézhető.
 */
/**
 * A LEVÉL TÖRZSE FORMÁZOTT (nautilus #1301, Balázs kérése a stage-en): a fiók a
 * Levelezés oldal szerkesztőjével dolgozik, a törzs HTML, és a küldés mellé a
 * belőle készült szöveges alternatíva megy (`billingEmailText`).
 */
export interface BillingEmailDraft {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  bodyHtml: string;
}

/** Minden számla-változó neve, a `{{…}}` nélkül (a fiók és az előnézet listája). */
export const BILLING_EMAIL_VARIABLE_NAMES = [
  "customer_name",
  "document_number",
  "invoice_number",
  "gross_total",
  "due_date",
  "document_link",
  "order_number",
] as const;

/**
 * Szövegből formázott törzs: a `{{név}}` jelölők változó-atomok lesznek,
 * ugyanúgy, ahogy a Levelezés oldal egy szöveges sablont betölt.
 */
export function billingEmailHtmlFromText(text: string): string {
  return plainTextToRichHtml(text, {
    variables: [...BILLING_EMAIL_VARIABLE_NAMES],
  });
}

/** A küldés szöveges alternatívája (a szerver a HTML-ből úgyis újra előállítja). */
export function billingEmailText(bodyHtml: string): string {
  return richHtmlToText(bodyHtml);
}

export function billingEmailVariables(
  documentType: BillingDocumentType,
): string[] {
  return [
    "{{customer_name}}",
    "{{document_number}}",
    ...(documentType === "INVOICE" || documentType === "ADVANCE_INVOICE"
      ? ["{{invoice_number}}"]
      : []),
    "{{gross_total}}",
    "{{due_date}}",
    "{{document_link}}",
    "{{order_number}}",
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
    subject: "Acropora – {{document_number}}",
    bodyHtml: billingEmailHtmlFromText(
      [
        "Kedves {{customer_name}}!",
        "",
        `Csatoltan küldjük a(z) {{document_number}} számú ${ACCUSATIVE[documentType]}.`,
        "",
        "Fizetendő összeg: {{gross_total}}",
        "Fizetési határidő: {{due_date}}",
        "",
        "Köszönjük!",
        "Acropora",
      ].join("\n"),
    ),
  };
}

/** "a@x.hu, b@y.hu; c@z.hu" -> a címek listája (a kiküldés `to`/`cc`/`bcc`-je). */
export const splitAddresses = (text: string) =>
  text
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean);

/**
 * Az előnézet: az ismert változók behelyettesítve, a többi jelölve marad
 * (`{{név}}`). UGYANAZ a motor, amit a küldés használ
 * (`renderMailTemplateHtml`, escape-elt értékek), utána a tisztító: az
 * előnézet nem mutathat mást, mint ami kimegy. `null`: a motor nem renderel
 * (ismeretlen változó), és küldéskor sem menne ki.
 */
export function previewBillingEmail(
  bodyHtml: string,
  known: Record<string, string>,
): string | null {
  const values = Object.fromEntries(
    BILLING_EMAIL_VARIABLE_NAMES.map((name) => [
      name,
      known[name] ?? `{{${name}}}`,
    ]),
  );
  const rendered = renderMailTemplateHtml(bodyHtml, values);
  return rendered.ok ? sanitizeRichHtml(rendered.text) : null;
}

/** Az előnézet kerete; a `sandbox` üres, benne semmi nem futhat. */
function previewDocument(html: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2937;margin:12px;">${html}</body></html>`;
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
  submit,
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
  /**
   * A KÜLDÉS, ha már bekötött (a részletek oldalán: kiküldés, hiba utáni
   * újrapróbálás, kifejezett újraküldés). Nélküle a végső gomb tiltott, és a
   * fiók a kiállítás előtti szerkesztésre szolgál.
   */
  submit?: {
    label: string;
    onSubmit: () => void;
    busy: boolean;
    error: string | null;
  };
}) {
  const [showCopies, setShowCopies] = useState(
    draft.cc !== "" || draft.bcc !== "",
  );
  const [preview, setPreview] = useState(false);
  const editorRef = useRef<RichTextEditorHandle | null>(null);
  const noun = getDocumentCapabilities(documentType).label;
  const chips = billingEmailVariables(documentType);

  // a chip `{{név}}` alakot mutat; a szerkesztőbe a név atomként kerül
  const insert = (variable: string) =>
    editorRef.current?.insertVariable(variable.replace(/[{}]/g, ""));
  const rendered = preview ? previewBillingEmail(draft.bodyHtml, known) : null;

  return (
    <PilotDrawer
      open={open}
      onClose={onClose}
      width="xl"
      title={`${format === "ELECTRONIC" && documentType === "INVOICE" ? "E-számla" : noun} kiküldése`}
      subtitle="A levél a bizonylat végleges kiállítása előtt szerkeszthető."
      footer={
        <div className="space-y-3">
          {submit ? (
            <>
              <p className="text-xs text-pilot-grey-500">
                A levél újraküldése nem állít ki új bizonylatot.
              </p>
              {submit.error ? (
                <p role="alert" className="text-xs text-pilot-red-700">
                  {submit.error}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-pilot-grey-500">
              A kiállítás elküldi az adatokat a Számlázz.hu-nak, majd siker
              esetén az értesítő levelet. A kiküldés a Számlázz.hu bekötésével
              érkezik.
            </p>
          )}
          <div className="flex gap-2">
            <PilotButton variant="secondary" size="regular" onClick={onClose}>
              Mégse
            </PilotButton>
            {submit ? (
              <PilotButton
                variant="primary"
                size="regular"
                disabled={submit.busy || !draft.to.trim()}
                onClick={submit.onSubmit}
              >
                {submit.busy ? "Küldés…" : submit.label}
              </PilotButton>
            ) : (
              <PilotButton
                variant="primary"
                size="regular"
                disabled
                title="A kiküldés a Számlázz.hu bekötésével érkezik."
              >
                {billingDrawerCta(documentType, format)}
              </PilotButton>
            )}
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
        {submit ? null : (
          <div className="rounded-xl border border-pilot-accent-warm bg-pilot-accent-warm-soft px-4 py-3 text-xs text-pilot-accent-warm-text">
            <p className="font-semibold">A bizonylat száma még nem ismert</p>
            <p className="mt-1">
              A {"{{document_number}}"} változó a sikeres Számlázz.hu kiállítás
              után helyettesítődik be.
            </p>
          </div>
        )}
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
            rendered === null ? (
              <p role="alert" className="text-xs text-pilot-red-700">
                Ismeretlen változó miatt nincs előnézet, és küldéskor sem menne
                ki a levél.
              </p>
            ) : (
              <iframe
                title="Levél előnézete"
                sandbox=""
                srcDoc={previewDocument(rendered)}
                className="h-72 w-full rounded-lg bg-white ring-1 ring-pilot-grey-200"
              />
            )
          ) : (
            <RichTextEditor
              ref={editorRef}
              aria-label="Levél tartalma"
              value={draft.bodyHtml}
              onChange={(bodyHtml) => onChange({ ...draft, bodyHtml })}
              variables={chips.map((chip) => ({
                name: chip.replace(/[{}]/g, ""),
                ...(chip === "{{document_link}}"
                  ? { kind: "link" as const }
                  : {}),
              }))}
              toolbar={[
                "bold",
                "italic",
                "underline",
                "link",
                "bulletList",
                "orderedList",
              ]}
            />
          )}
        </PilotFormField>
        {preview ? null : (
          <PilotVariableChips variables={chips} onInsert={insert} />
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
