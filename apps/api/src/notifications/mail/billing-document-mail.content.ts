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
/**
 * The manual text's English twin (card d5c6befd, P4): the webshop's proforma goes out on the manual text, and a customer
 * who ordered on the English storefront gets this one. The key is the manual key plus `_EN`, like the webshop mails' twins.
 */
export const BILLING_DOCUMENT_MANUAL_EN = "BILLING_DOCUMENT_MANUAL_EN";

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

export const DEFAULT_BILLING_DOCUMENT_MANUAL_EN_TEMPLATE = {
  subject: "Acropora: {{document_number}}",
  body: [
    "Dear {{customer_name}},",
    "",
    "Please find our document no. {{document_number}} attached.",
    "",
    "Amount due: {{gross_total}}",
    "Payment deadline: {{due_date}}",
    "",
    "Thank you!",
    "Acropora",
  ].join("\n"),
} as const;
