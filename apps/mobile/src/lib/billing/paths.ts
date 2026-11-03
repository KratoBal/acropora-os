/**
 * A SZÁMLA-ADATLAP FAJTÁJA ÉS A PDF ÚTJA, ALIAS NÉLKÜLI TISZTA FÁJLBAN: az `api/billing.ts` az `@/` aliast használó
 * klienst húzza be, amit a mobil teszt-fordítás nem old fel (`tsconfig.test.json`), ezért ami tesztelt logika, az ide
 * kerül.
 */
const BILLING = "/billing";

/** Melyik adatlap: a saját kimenő, a külső (Számlázz.hu, eBIZ) kimenő, vagy a bejövő. */
export type BillingDocumentKind = "own" | "external" | "incoming";

/** A PDF útja az API-n belül; a letöltés a bejelentkezési tokennel megy (`open-billing-pdf.ts`). */
export function billingPdfPath(kind: BillingDocumentKind, id: string) {
  const segment =
    kind === "own"
      ? "documents"
      : kind === "external"
        ? "external-documents"
        : "incoming-documents";
  return `${BILLING}/${segment}/${encodeURIComponent(id)}/pdf`;
}
