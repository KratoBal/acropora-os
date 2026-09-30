import type {
  BillingDocumentStatus,
  BillingEmailStatus,
} from "./billing-document.js";

/** A bizonylat állapotának magyar neve (lista, részletek, szűrő). */
export const BILLING_DOCUMENT_STATUS_LABELS: Record<
  BillingDocumentStatus,
  string
> = {
  DRAFT: "Piszkozat",
  ISSUING: "Kiállítás alatt",
  ISSUED: "Kiállítva",
  ISSUE_FAILED: "Kiállítás sikertelen",
};

/**
 * A kiküldés állapotának magyar neve. KÜLÖN a bizonylat állapotától (brief 4.
 * és 20. pont): egy kiállított számla, amelynek a levele elbukott, kiállított
 * számla marad.
 */
export const BILLING_EMAIL_STATUS_LABELS: Record<BillingEmailStatus, string> = {
  NOT_REQUIRED: "Nem szükséges",
  PENDING: "Kiküldésre vár",
  SENDING: "Küldés alatt",
  SENT: "Elküldve",
  FAILED: "Sikertelen kiküldés",
};
