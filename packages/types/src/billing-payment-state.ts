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
