/**
 * A SZÁMLÁZÁSI BIZONYLAT LEVELÉNEK KÉT ALAPSZÖVEGE (Balázs kérése, 2026-09-30,
 * Beállítások / Általános / Levelezés). Sima szöveg: a számla-levél formázás
 * nélkül megy ki, a PDF csatolmányként.
 *
 * A kézi kiküldés (`POST /billing/documents/:id/email`) a kiküldő fiókot az
 * első szövegével nyitja meg. A második ma csak sablon: a webshop-rendelés
 * automatikus számlázása és kiküldése még nem épült meg.
 */
export const BILLING_DOCUMENT_MANUAL = "BILLING_DOCUMENT_MANUAL";
export const BILLING_DOCUMENT_WEBSHOP_ORDER = "BILLING_DOCUMENT_WEBSHOP_ORDER";

export const DEFAULT_BILLING_DOCUMENT_MANUAL_TEMPLATE = {
  subject: "Acropora: {{document_number}}",
  body: [
    "Kedves {{customer_name}}!",
    "",
    "Csatoltan küldjük a(z) {{document_number}} számú bizonylatunkat.",
    "",
    "Fizetendő összeg: {{gross_total}}",
    "Fizetési határidő: {{due_date}}",
    "",
    "Köszönjük!",
    "Acropora",
  ].join("\n"),
} as const;

export const DEFAULT_BILLING_DOCUMENT_WEBSHOP_ORDER_TEMPLATE = {
  subject: "Acropora: a(z) {{order_number}} rendelés számlája",
  body: [
    "Kedves {{customer_name}}!",
    "",
    "Köszönjük a rendelését! Csatoltan küldjük a(z) {{order_number}} rendeléshez tartozó {{document_number}} számú számlát.",
    "",
    "Végösszeg: {{gross_total}}",
    "",
    "Köszönjük, hogy tőlünk vásárolt!",
    "Acropora",
  ].join("\n"),
} as const;
