"use client";

import type {
  BillingDocumentListItem,
  ExternalBillingSource,
} from "@acropora/types";

/**
 * MIÉRT NINCS PDF, EGY HELYEN (Balázs, 2026-10-21: „látszódjon, hogy megvan a pdf”). A lista és a
 * külső bizonylat adatlapja ugyanezt mondja. A kódokat az API írja: a Számlázz.hu-s letöltés
 * (`external-invoice-pdf-fill.ts`), az eBIZ szinkron (`ebiz-sync.service.ts`) és a saját számla
 * (`OWN_PDF_NOT_STORED`). Ismeretlen kódnál maga a kód látszik, hogy ne vesszen el.
 */
const FIXED: Record<string, string> = {
  DOCUMENT_STORE_NOT_CONFIGURED:
    "Nincs letöltve: a dokumentumtár nincs beállítva.",
  OWN_PDF_NOT_STORED: "A kiállításkor nem tárolódott PDF.",
  SZAMLAZZ_PDF_REJECTED_7: "A Számlázz.hu ezt a számlaszámot nem ismeri.",
  SZAMLAZZ_PDF_EMPTY: "A Számlázz.hu üres választ adott.",
  SZAMLAZZ_PDF_NOT_PDF: "A Számlázz.hu válasza nem PDF volt.",
  SZAMLAZZ_PDF_STORE_FAILED: "Letöltve, de a tárolás nem sikerült.",
};

export function pdfMissingText(
  reason: string | null,
  source: ExternalBillingSource | "OWN",
): string {
  if (reason === null) {
    // the Számlázz.hu fill is a command, not a schedule: no promise that it runs by itself
    return source === "EBIZ"
      ? "Még nincs letöltve; a következő eBIZ-szinkron megpróbálja."
      : "Még nincs letöltve: a Számlázz.hu-s letöltés ezen a soron még nem futott.";
  }
  const fixed = FIXED[reason];
  if (fixed) return fixed;
  const rejected = /^SZAMLAZZ_PDF_REJECTED_(\d+)$/.exec(reason);
  if (rejected) return `A Számlázz.hu elutasította (${rejected[1]}. hibakód).`;
  const http = /^SZAMLAZZ_PDF_HTTP_(\d+)$/.exec(reason);
  if (http) return `A Számlázz.hu nem adta ki (HTTP ${http[1]}).`;
  return `Nem sikerült letölteni (${reason}).`;
}

/** A lista „PDF” cellája: megvan, vagy nincs és miért; nem kiállított bizonylatnál „—”. */
export function PdfStateBadge({
  item,
}: {
  item: Pick<BillingDocumentListItem, "pdf" | "origin" | "externalSource">;
}) {
  if (item.pdf === null) return <span className="text-pilot-grey-400">—</span>;
  if (item.pdf.available)
    return (
      <span className="inline-flex items-center rounded-full bg-pilot-aqua-50 px-2 py-0.5 text-xs font-semibold text-pilot-aqua-700">
        Megvan
      </span>
    );
  const reason = pdfMissingText(
    item.pdf.missingReason,
    item.origin === "EXTERNAL" ? (item.externalSource ?? "SZAMLAZZ") : "OWN",
  );
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span className="inline-flex items-center rounded-full bg-pilot-amber-50 px-2 py-0.5 text-xs font-semibold text-pilot-amber-700">
        Nincs
      </span>
      <span className="text-xs text-pilot-grey-500">{reason}</span>
    </span>
  );
}
