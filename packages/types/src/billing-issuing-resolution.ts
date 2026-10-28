/**
 * A KIÁLLÍTÁS VÉSZÁLLAPOTÁBÓL KIVEZETŐ ÚT (kártya 38e9271d): a bizonylat
 * ISSUING-ben áll, és a kiállítás nem tudta lezárni. Az út CSAK OLVAS a
 * Számlázz.hu-n; kiállítást nem indít.
 *
 * Az ISSUING-be vezető hat út a `syncError` szövegében hagy nyomot; a
 * besorolás szerepe: melyik fajtánál VAN a szövegben szám (RECORDING_FAILED,
 * STRAY_PREVIEW), és melyiknél kell a Számlázz.hu a forrás.
 */
export const BILLING_ISSUING_KINDS = [
  "RECORDING_FAILED",
  "STRAY_PREVIEW",
  "NO_REPLY",
  "UNCLEAR_REPLY",
  "NO_NOTE",
  "OTHER",
] as const;
export type BillingIssuingKind = (typeof BILLING_ISSUING_KINDS)[number];

/**
 * Amit a szerver javasol. `NONE`: nem tudjuk, a sor ISSUING marad, és nincs
 * végrehajtó gomb. `RECORD_ISSUED`: a Számlázz.hu a mi bizonylatunkat
 * igazolta, a megadott számmal. `BACK_TO_DRAFT`: bizonyított, hogy nincs
 * kiállított bizonylat.
 */
export const BILLING_ISSUING_ACTIONS = [
  "RECORD_ISSUED",
  "BACK_TO_DRAFT",
  "NONE",
] as const;
export type BillingIssuingAction = (typeof BILLING_ISSUING_ACTIONS)[number];

/** Mit mondott a Számlázz.hu a mi azonosítónkra (vagy a szövegben álló számra). */
export const BILLING_ISSUING_LOOKUPS = [
  "FOUND",
  "NOT_FOUND",
  "UNKNOWN",
] as const;
export type BillingIssuingLookup = (typeof BILLING_ISSUING_LOOKUPS)[number];

/** `POST /billing/documents/:id/issuing-check` válasza: új állapotot nem ír. */
export interface BillingIssuingCheck {
  documentId: string;
  kind: BillingIssuingKind;
  lookup: BillingIssuingLookup;
  action: BillingIssuingAction;
  /** A javasolt akció száma (RECORD_ISSUED): a Számlázz.hu által visszaadott szám. */
  invoiceNumber: string | null;
  /** Egy mondat: miért ez a javaslat, vagy miért "nem tudjuk". */
  reason: string;
  /** A sor `updatedAt`-ja az ellenőrzéskor: ezt kell visszaküldeni a végrehajtáskor. */
  expectedUpdatedAt: string;
  /** Mióta áll a sor ISSUING-ben, percben. */
  ageMinutes: number;
}

/** `POST /billing/documents/:id/issuing-resolve` bemenete: az ellenőrzés javaslata, megerősítve. */
export interface BillingIssuingResolveInput {
  expectedUpdatedAt: string;
  action: Exclude<BillingIssuingAction, "NONE">;
  /** RECORD_ISSUED-nél kötelező, BACK_TO_DRAFT-nál null. */
  invoiceNumber: string | null;
}

/** A sor legkisebb kora (perc), amitől bizonyított "nincs szám"-ra DRAFT lehet. */
export const BILLING_ISSUING_MIN_AGE_MINUTES = 30;
