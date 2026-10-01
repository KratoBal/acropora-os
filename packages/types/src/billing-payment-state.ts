import type { DecimalText } from "./billing-document-amounts.js";
import type { IncomingPaymentState } from "./billing-incoming.js";

/**
 * A SZÁMLA KIFIZETÉSI ÁLLAPOTA, EGY HELYEN a bejövő és a kimenő számlára
 * (murena és nautilus, 2026-10-01): a két lista ugyanazt mondja. A forrás a
 * Számlázz.hu kifizetés-adata (`kifizetesek`); ez a számítás TISZTA FÜGGVÉNY.
 *
 *   UNKNOWN   a Számlázz.hu nem küldött kifizetés-adatot (az elem opcionális):
 *             ez NEM azonos a „nem fizetett”-tel
 *   PAID      a kifizetések összege eléri a bruttót, a tűréssel
 *   PARTIAL   van kifizetés, de kevesebb
 *   UNPAID    van adat, és nincs kifizetés
 *
 * A TŰRÉS forintnál 2 Ft: a készpénzes utánvét 5 forintra kerekít (barracuda
 * mérése: 105 830 beszedve egy 105 831-es számlára). Devizánál fél cent. ABSZOLÚT
 * ÉRTÉKBEN mér, mert a sztornó végösszege negatív.
 */
export type BillingPaymentState = IncomingPaymentState;

const SCALE = 4;

/** Tizedes szöveg -> 10^-4 egész; a nem szám hiba, nem nulla. */
function scaled(text: DecimalText): bigint {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) throw new Error(`nem tizedes szám: ${text}`);
  const [, sign, whole, fraction = ""] = match;
  const digits = `${whole}${fraction.slice(0, SCALE).padEnd(SCALE, "0")}`;
  const value = BigInt(digits);
  return sign ? -value : value;
}

const abs = (value: bigint) => (value < 0n ? -value : value);

/** A tűrés 10^-4 egységben: forintnál 2 Ft, devizánál 0,005. */
const TOLERANCE = { HUF: 20_000n, OTHER: 50n } as const;

export function paymentStateOf(input: {
  readonly paymentsKnown: boolean;
  readonly paidAmount: DecimalText;
  readonly grossAmount: DecimalText;
  readonly currency: string;
}): BillingPaymentState {
  if (!input.paymentsKnown) return "UNKNOWN";
  const paid = abs(scaled(input.paidAmount));
  const gross = abs(scaled(input.grossAmount));
  const tolerance =
    input.currency.toUpperCase() === "HUF" ? TOLERANCE.HUF : TOLERANCE.OTHER;
  if (paid >= gross - tolerance) return "PAID";
  if (paid > 0n) return "PARTIAL";
  return "UNPAID";
}

/**
 * KIMENŐ SZÁMLA `kifizetesek` NÉLKÜL: MIT JELENT A HIÁNY, a fizetési módtól
 * függően (acrobot 25936 és 25938, Balázs kérdése 20:16 UTC: „miért nincs adat
 * fog állni, ha tudjuk, hogy kifizették?”):
 *
 *   UNPAID          átutalás, utánvét, üres mód: a fizetés a számla UTÁN jön
 *   CARD_AT_ORDER   bankkártya, SimplePay (OTP Simple), online fizetés: a vevő a
 *                   rendeléskor fizetett, a Számlázz.hu-ban csak nincs rögzítve
 *   CASH_AT_ORDER   készpénz: ugyanígy, a helyszínen
 *   UNKNOWN         bármi más: nem tudjuk
 *
 * E nélkül 18 kártyás webshop-számla „Nincs fizetve”-t mutatott élesen.
 */
export type OutgoingMissingPayments =
  "UNPAID" | "CARD_AT_ORDER" | "CASH_AT_ORDER" | "UNKNOWN";

/**
 * A `fizmodunified` (szamla.xsd, `fizmodunifiedTipus`) MIND A 21 ÉRTÉKE, és
 * mit jelent a `kifizetesek` hiánya mellette (acrobot 25964 és 25967). A
 * felsorolás zárt, ezért ELSŐKÉNT ez dönt, a szabad szöveges `fizmod` csak
 * tartalék. `null`: a tábla nem dönt, a szabad szöveg igen; ez az „egyéb”:
 * élesen mind a 27 üres fizmodú webshop-számla „egyéb”, és UNKNOWN-ként a
 * „Nincs fizetve”-ből „Nincs adat” lenne, épp az utánvétes számlákon.
 */
export const FIZMODUNIFIED_MISSING_PAYMENTS: Readonly<
  Record<string, OutgoingMissingPayments | null>
> = {
  átutalás: "UNPAID",
  utánvét: "UNPAID",
  csekk: "UNPAID",
  "csoportos beszedés": "UNPAID",
  bankkártya: "CARD_AT_ORDER",
  "OTP Simple": "CARD_AT_ORDER",
  "SZÉP kártya": "CARD_AT_ORDER",
  "EP kártya": "CARD_AT_ORDER",
  PayPal: "CARD_AT_ORDER",
  PayU: "CARD_AT_ORDER",
  barion: "CARD_AT_ORDER",
  "MasterCard Mobile": "CARD_AT_ORDER",
  Borgun: "CARD_AT_ORDER",
  készpénz: "CASH_AT_ORDER",
  ajándékutalvány: "UNKNOWN",
  utalvány: "UNKNOWN",
  kupon: "UNKNOWN",
  barter: "UNKNOWN",
  kompenzáció: "UNKNOWN",
  térítésmentes: "UNKNOWN",
  egyéb: null,
};

const fold = (value: string) =>
  value.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();

const UNIFIED_BY_FOLDED = new Map(
  Object.entries(FIZMODUNIFIED_MISSING_PAYMENTS).map(([value, missing]) => [
    fold(value),
    missing,
  ]),
);

export function outgoingMissingPayments(
  paymentMethod: string | null,
  paymentMethodUnified: string | null = null,
): OutgoingMissingPayments {
  // a zárt felsorolás előbb; ismeretlen értéknél vagy az „egyéb”-nél a szabad szöveg
  const unified = paymentMethodUnified
    ? UNIFIED_BY_FOLDED.get(fold(paymentMethodUnified))
    : undefined;
  if (unified) return unified;
  const method = fold(paymentMethod ?? "");
  // ELSŐKÉNT és BÁRHOL a szövegben (murena review-ja, 25948): a „Készpénzes
  // utánvét”, a „Bankkártyás utánvét” és az „Online átutalás” is később fizet;
  // a kártya- vagy online-szó előre véve ezeket hamisan „Fizetve”-nek mondaná
  if (method === "" || /utanvet|utalas/.test(method)) return "UNPAID";
  if (/kartya|card|simple|barion|paypal|online/.test(method))
    return "CARD_AT_ORDER";
  if (/^keszpenz/.test(method)) return "CASH_AT_ORDER";
  return "UNKNOWN";
}
