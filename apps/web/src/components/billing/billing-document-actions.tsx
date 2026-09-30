"use client";

import { PilotButton } from "@acropora/ui";

/**
 * A RÉSZLETEK HÁROM MŰVELETE, EGY CSOPORTBAN (brief 11-14. pont): Nyomtatás, PDF
 * letöltése, E-mail újraküldése. A csoport tör, nem lóg ki: a Figma QA-n ez
 * külön javítva lett, ezért `flex-wrap` és a jobb oldali kártyaoszlop
 * szélességén belül marad.
 *
 * A NYOMTATÁS ÉS A LETÖLTÉS A HIVATALOS PDF-ET HASZNÁLJA, és csak akkor
 * aktív, ha az megvan: vázlatból nem nyomtatunk "számlának látszó" lapot. Az
 * újraküldés csak ott látszik, ahol a bizonylat e-mailben küldhető.
 */
export function BillingDocumentActions({
  pdfAvailable,
  pdfReason,
  onPrint,
  onDownload,
  resend,
  busy,
}: {
  pdfAvailable: boolean;
  /** Miért nem érhető el a PDF; a gomb `title`-je. */
  pdfReason: string;
  onPrint: () => void;
  onDownload: () => void;
  /** `null`: a bizonylat nem küldhető e-mailben, a gomb nem látszik. */
  resend: {
    label: string;
    enabled: boolean;
    /** Miért tiltott; a gomb `title`-je. */
    reason?: string;
    onClick: () => void;
  } | null;
  busy: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Bizonylat műveletei"
      className="flex max-w-full flex-wrap justify-end gap-2"
    >
      <PilotButton
        variant="secondary"
        size="action"
        onClick={onPrint}
        disabled={!pdfAvailable || busy}
        title={pdfAvailable ? undefined : pdfReason}
      >
        Nyomtatás
      </PilotButton>
      <PilotButton
        variant="secondary"
        size="action"
        onClick={onDownload}
        disabled={!pdfAvailable || busy}
        title={pdfAvailable ? undefined : pdfReason}
      >
        PDF letöltése
      </PilotButton>
      {resend ? (
        <PilotButton
          variant="secondary"
          size="action"
          onClick={resend.onClick}
          disabled={!resend.enabled || busy}
          title={resend.enabled ? undefined : resend.reason}
        >
          {resend.label}
        </PilotButton>
      ) : null}
    </div>
  );
}
