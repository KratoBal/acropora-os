import type { BillingEmailMode, BillingEmailStatus } from "@acropora/types";

import type { BillingDocumentRow } from "./billing-documents.repository.js";

/**
 * A KIKÜLDÉS TISZTA RÉSZE (szerződés, `POST :id/email`): a változók, a
 * behelyettesítés és a címzettek ellenőrzése. Nincs adatbázis és hálózat.
 *
 * A VÁLTOZÓKAT A SZERVER HELYETTESÍTI BE, a küldés pillanatában (murena 25179):
 * a kiküldő fiókot a felhasználó a kiállítás ELŐTT is kitöltheti, akkor a szám
 * és a hivatkozás még nem ismert. Az alak EGY kapcsos zárójel, ahogy a brief
 * írja; a `mail-template` modul `{{…}}` alakja egy másik levélfajtáé.
 */
export const BILLING_EMAIL_VARIABLES = [
  "customer_name",
  "document_number",
  "invoice_number",
  "gross_total",
  "due_date",
  "document_link",
  "order_number",
] as const;
type BillingEmailVariable = (typeof BILLING_EMAIL_VARIABLES)[number];

/**
 * ÉRTÉK NÉLKÜL IS FELOLDHATÓ változók: üres szöveggé válnak, nem állítják meg
 * a küldést. acrobot döntése (25240): a `{document_link}` a Számlázz.hu vevői
 * fiókjának hivatkozása, és ahol nincs ilyen (például papír alapú bizonylat),
 * a sablon ne álljon meg egy hiányzó, opcionális linken.
 */
const OPTIONAL: ReadonlySet<BillingEmailVariable> = new Set(["document_link"]);

const HUNGARIAN_DATE = new Intl.DateTimeFormat("hu-HU", { timeZone: "UTC" });

/** Egy kiállított bizonylat változóinak értéke; `null`, ahol nincs érték. */
export function billingEmailValues(
  row: BillingDocumentRow,
  customerName: string,
): Record<BillingEmailVariable, string | null> {
  const currency = row.currency.toUpperCase();
  const gross = row.grossAmount
    ? new Intl.NumberFormat("hu-HU", {
        style: "currency",
        currency,
        maximumFractionDigits: currency === "HUF" ? 0 : 2,
        minimumFractionDigits: currency === "HUF" ? 0 : 2,
      }).format(Number(row.grossAmount))
    : null;
  const isInvoice =
    row.documentType === "INVOICE" || row.documentType === "ADVANCE_INVOICE";
  return {
    customer_name: customerName,
    document_number: row.invoiceNumber,
    // csak számlánál és előlegszámlánál (szerződés): díjbekérőn nincs számlaszám
    invoice_number: isInvoice ? row.invoiceNumber : null,
    gross_total: gross,
    due_date: row.dueDate ? HUNGARIAN_DATE.format(row.dueDate) : null,
    document_link: row.externalUrl,
    order_number: row.reference?.trim() || null,
  };
}

export type RenderResult =
  | { ok: true; text: string }
  | { ok: false; unknown: string[]; missing: string[] };

/**
 * A NYERS SZÖVEG BEHELYETTESÍTVE. Ha egy változó ismeretlen, vagy kötelező és
 * nincs értéke, NEM ad szöveget: nyers `{…}` alak és csendben kimaradt szó sem
 * mehet ki egy vevőnek.
 */
export function renderBillingEmail(
  text: string,
  values: Record<BillingEmailVariable, string | null>,
): RenderResult {
  const unknown = new Set<string>();
  const missing = new Set<string>();
  const rendered = text.replace(/\{([a-z_]+)\}/g, (whole, name: string) => {
    if (!(BILLING_EMAIL_VARIABLES as readonly string[]).includes(name)) {
      unknown.add(name);
      return whole;
    }
    const value = values[name as BillingEmailVariable];
    if (value !== null) return value;
    if (OPTIONAL.has(name as BillingEmailVariable)) return "";
    missing.add(name);
    return whole;
  });
  if (unknown.size > 0 || missing.size > 0)
    return { ok: false, unknown: [...unknown], missing: [...missing] };
  return { ok: true, text: rendered };
}

/** Egy cím: szóköz, vessző, pontosvessző és szögletes zárójel nélkül. */
const ADDRESS = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export type RecipientsResult =
  | { ok: true; to: string[]; cc: string[]; bcc: string[] }
  | { ok: false; invalid: string[] };

/** A címzettek levágva; üres elem kimarad, egy hibás cím megállít. */
export function billingEmailRecipients(input: {
  to: readonly string[];
  cc: readonly string[];
  bcc: readonly string[];
}): RecipientsResult {
  const clean = (list: readonly string[]) =>
    list.map((address) => address.trim()).filter(Boolean);
  const to = clean(input.to);
  const cc = clean(input.cc);
  const bcc = clean(input.bcc);
  const invalid = [...to, ...cc, ...bcc].filter(
    (address) => !ADDRESS.test(address),
  );
  if (invalid.length > 0 || to.length === 0) return { ok: false, invalid };
  return { ok: true, to, cc, bcc };
}

/** Melyik e-mail állapotból indulhat az adott mód (a foglalás feltétele). */
export const MODE_FROM: Record<
  BillingEmailMode,
  readonly (BillingEmailStatus | null)[]
> = {
  SEND: [null, "NOT_REQUIRED", "PENDING"],
  RETRY: ["FAILED"],
  RESEND: ["SENT"],
};

/** Az auditnapló eseménye módonként (szerződés). */
export const AUDIT_ACTION: Record<BillingEmailMode, string> = {
  SEND: "billing.document.email-sent",
  RETRY: "billing.document.email-retried",
  RESEND: "billing.document.email-resent",
};

export const MODE_LABEL: Record<BillingEmailMode, string> = {
  SEND: "kiküldés",
  RETRY: "újrapróbálás",
  RESEND: "újraküldés",
};
