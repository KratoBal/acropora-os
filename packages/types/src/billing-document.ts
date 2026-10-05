/**
 * A SZÁMLÁZÁS MODUL DOMAINJE: NÉGY BIZONYLATTÍPUS, KÉT KÜLÖN DIMENZIÓ.
 *
 * Balázs briefje, 2026-09-30 (Számlázás v0.1), és a capability report
 * (`exchange/figma-os-direction-f/szamlazas-capability-report.md`, 6. pont).
 *
 * === MIÉRT A KÖZÖS CSOMAGBAN ===
 *
 * A felület ebből dönti el, mit mutat (van-e Formátum választó, mi a gomb
 * felirata), a szerver pedig ebből dönti el, mit fogad el. Ha a kettő külön
 * írná le, a felület felkínálhatna egy párost, amit a szerver elutasít, vagy
 * fordítva: a szerver átengedne egy e-számla jelzőt egy olyan típusra, ahol
 * a felület el sem rejtette. Egy táblából ez fordítási kérdés.
 *
 * === AMI SZÁNDÉKOSAN NINCS ITT ===
 *
 * A Számlázz.hu részletei (melyik `fejlec` jelző, az `eszamla` mező). Azok az
 * API adapterében élnek: a brief 31. pontja szerint a core billing domain ne
 * legyen feleslegesen Számlázz.hu-specifikus, és a React oldal ne tudjon az
 * Agent XML-ről.
 */

export const BILLING_DOCUMENT_TYPES = [
  "INVOICE",
  "PROFORMA",
  "ADVANCE_INVOICE",
  "DELIVERY_NOTE",
] as const;
export type BillingDocumentType = (typeof BILLING_DOCUMENT_TYPES)[number];

/** A formátum KÜLÖN dimenzió, nem a dokumentumtípus egy értéke (brief 3. pont). */
export const INVOICE_FORMATS = ["PAPER", "ELECTRONIC"] as const;
export type InvoiceFormat = (typeof INVOICE_FORMATS)[number];

export const BILLING_DOCUMENT_STATUSES = [
  "DRAFT",
  "ISSUING",
  "ISSUED",
  "ISSUE_FAILED",
] as const;
export type BillingDocumentStatus = (typeof BILLING_DOCUMENT_STATUSES)[number];

/** Az e-mail állapota a kiállítástól KÜLÖN (brief 20. pont). */
export const BILLING_EMAIL_STATUSES = [
  "NOT_REQUIRED",
  "PENDING",
  "SENDING",
  "SENT",
  "FAILED",
] as const;
export type BillingEmailStatus = (typeof BILLING_EMAIL_STATUSES)[number];

export const BILLING_SOURCE_TYPES = [
  "PROJECT",
  "SALES_ORDER",
  "POS_TRANSACTION",
  "SERVICE_JOB",
  "MANUAL",
  "WEBSHOP_ORDER",
] as const;
export type BillingSourceType = (typeof BILLING_SOURCE_TYPES)[number];

/**
 * Az e-mailes kiküldés helye a kiállítási folyamatban.
 *
 * - `REQUIRED`: a kiállítás gombja a kiküldő fiókot nyitja, és a kettő egy
 *   folyamat (e-számla: "Kiállítás és kiküldés");
 * - `OPTIONAL`: kiállítás után kiküldhető, de nem része a kiállításnak;
 * - `NONE`: ennél a típusnál nincs kiküldés.
 */
export type BillingEmailDelivery = "REQUIRED" | "OPTIONAL" | "NONE";

export interface BillingDocumentCapabilities {
  type: BillingDocumentType;
  /** Üres: a Formátum választó rejtve, és a bizonylat formátuma `null`. */
  formats: readonly InvoiceFormat[];
  defaultFormat: InvoiceFormat | null;
  /**
   * Látszanak-e a fizetési mezők (határidő, mód) a felületen. Ahol nem, ott
   * a szerver tölti ki őket, mert a Számlázz.hu mindegyik típusnál kötelezőnek
   * jelöli (acrobot döntése a capability report 7.3 pontjára, 2026-09-30).
   */
  showsPaymentFields: boolean;
  /** Oldal-cím: "Új számla". */
  newTitle: string;
  /** Az összesítő kártya címe: "Számla összesen". */
  summaryTitle: string;
  /** A típus neve, ahogy a választóban és a jelvényen áll. */
  label: string;
}

/**
 * A KÉPESSÉG-TÁBLA.
 *
 * A csillaggal jelölt döntések a Számlázz.hu tesztfiókján még NEM MÉRT
 * viselkedésen állnak (capability report 2. pont, nyitott kérdések), és a
 * mérés után változhatnak:
 *   - * a díjbekérőnél és a szállítólevélnél nincs formátum: a doksi nem
 *     mondja meg, értelmezett-e ott az e-számla, és a brief szerint amit nem
 *     tudunk, azt nem küldjük;
 *   - * az előlegszámla ugyanúgy e-számla lehet, mint a számla.
 */
const CAPABILITIES: Record<BillingDocumentType, BillingDocumentCapabilities> = {
  INVOICE: {
    type: "INVOICE",
    formats: ["PAPER", "ELECTRONIC"],
    defaultFormat: "ELECTRONIC",
    showsPaymentFields: true,
    newTitle: "Új számla",
    summaryTitle: "Számla összesen",
    label: "Számla",
  },
  PROFORMA: {
    type: "PROFORMA",
    formats: [],
    defaultFormat: null,
    showsPaymentFields: true,
    newTitle: "Új díjbekérő",
    summaryTitle: "Díjbekérő összesen",
    label: "Díjbekérő",
  },
  ADVANCE_INVOICE: {
    type: "ADVANCE_INVOICE",
    formats: ["PAPER", "ELECTRONIC"],
    defaultFormat: "ELECTRONIC",
    showsPaymentFields: true,
    newTitle: "Új előlegszámla",
    summaryTitle: "Előlegszámla összesen",
    label: "Előlegszámla",
  },
  DELIVERY_NOTE: {
    type: "DELIVERY_NOTE",
    formats: [],
    defaultFormat: null,
    showsPaymentFields: false,
    newTitle: "Új szállítólevél",
    summaryTitle: "Szállítólevél összesen",
    label: "Szállítólevél",
  },
};

export function getDocumentCapabilities(
  type: BillingDocumentType,
): BillingDocumentCapabilities {
  return CAPABILITIES[type];
}

export const INVOICE_FORMAT_LABELS: Record<InvoiceFormat, string> = {
  PAPER: "Papír alapú",
  ELECTRONIC: "E-számla",
};

export type BillingFormatError =
  "BILLING_FORMAT_REQUIRED" | "BILLING_FORMAT_NOT_SUPPORTED";

/**
 * A kért formátum, a típus képessége szerint ellenőrizve. A szerver ezzel
 * fogad el egy párost; a felület ugyanezzel dönti el, mit küld.
 *
 * - ahol a típusnak nincs formátuma, csak a `null` érvényes: egy odaküldött
 *   formátum NEM esik ki csendben, hanem hiba (brief 32. pont: ne küldjünk
 *   e-számla jelzőt, ahol nem értelmezett);
 * - ahol van, ott kötelező, és a listában kell lennie.
 */
export function resolveInvoiceFormat(
  type: BillingDocumentType,
  requested: InvoiceFormat | null | undefined,
):
  | { ok: true; format: InvoiceFormat | null }
  | { ok: false; error: BillingFormatError } {
  const { formats } = getDocumentCapabilities(type);
  if (formats.length === 0)
    return requested == null
      ? { ok: true, format: null }
      : { ok: false, error: "BILLING_FORMAT_NOT_SUPPORTED" };
  if (requested == null) return { ok: false, error: "BILLING_FORMAT_REQUIRED" };
  return formats.includes(requested)
    ? { ok: true, format: requested }
    : { ok: false, error: "BILLING_FORMAT_NOT_SUPPORTED" };
}

/**
 * Hol áll a kiküldés a folyamatban, típus ÉS formátum szerint.
 *
 * - e-számla (számla, előleg): a kiállítás és a kiküldés egy folyamat;
 * - papír számla és díjbekérő: kiküldhető, de nem kötelező (brief 7. pont:
 *   papírnál a drawer ne legyen kötelező része a kiállításnak);
 * - szállítólevél: nincs kiküldés (brief 10. pont).
 */
export function billingEmailDelivery(
  type: BillingDocumentType,
  format: InvoiceFormat | null,
): BillingEmailDelivery {
  if (type === "DELIVERY_NOTE") return "NONE";
  if (format === "ELECTRONIC") return "REQUIRED";
  return "OPTIONAL";
}

/** A fő gomb felirata a szerkesztőn (brief 7-10. és 24. pont). */
export function billingIssueCta(
  type: BillingDocumentType,
  format: InvoiceFormat | null,
): string {
  if (billingEmailDelivery(type, format) === "REQUIRED")
    return "Kiállítás és kiküldés";
  return `${getDocumentCapabilities(type).label} kiállítása`;
}

/** A kiküldő fiók végső gombja, ahol a kiküldés a kiállítás része. */
export function billingDrawerCta(
  type: BillingDocumentType,
  format: InvoiceFormat | null,
): string {
  // "E-számla" a brief szó szerinti felirata; más típusnál a típus neve áll,
  // mert az "e-előlegszámla" nem szó, amit a könyvelő használna
  const noun =
    type === "INVOICE" && format === "ELECTRONIC"
      ? "E-számla"
      : getDocumentCapabilities(type).label;
  return `${noun} kiállítása és elküldése`;
}

/**
 * A kiállítási állapotgép, minden típusra ugyanaz (brief 19. pont):
 *
 *   DRAFT -> ISSUING           a valódi hívás elindult (feltételes foglalás)
 *   ISSUING -> ISSUED          a Számlázz.hu számot adott
 *   ISSUING -> ISSUE_FAILED    hibakóddal elutasította
 *   ISSUE_FAILED -> DRAFT      szerkesztés után újra kiállítható
 *
 * Nincs ISSUING -> DRAFT: ismeretlen kimenetnél a sor ISSUING-ben marad, mert
 * egy újabb hívás egy második valódi bizonylatot állíthatna ki. Nincs ISSUED
 * -> bármi: egy kiállított bizonylatot csak sztornó vagy (díjbekérőnél)
 * törlés érint, és az külön bizonylat, nem állapotváltás.
 */
const TRANSITIONS: Record<
  BillingDocumentStatus,
  readonly BillingDocumentStatus[]
> = {
  DRAFT: ["ISSUING"],
  ISSUING: ["ISSUED", "ISSUE_FAILED"],
  ISSUED: [],
  ISSUE_FAILED: ["DRAFT"],
};

export function canTransitionBillingDocument(
  from: BillingDocumentStatus,
  to: BillingDocumentStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}
