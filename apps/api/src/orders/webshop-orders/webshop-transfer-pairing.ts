/**
 * AZ ELŐRE UTALÁS PÁROSÍTÁSA (kártya bb3a6bd5; Balázs, 2026-10-06 16:42 UTC:
 * „Kell a banki parositas! Es szolnia kell ha megjott a penz”). TISZTA
 * FÜGGVÉNYEK, adatbázis és hálózat nélkül: a beérkezett jóváírásokból és a
 * kiállított díjbekérőkből megmondja, melyik díjbekérő fizetődött ki.
 *
 * A SZABÁLY (acrobot 27127-ben leírva):
 *   - csak jóváírás (CREDIT), a díjbekérő devizanemében;
 *   - a közleményben ott a díjbekérő száma. Kis- és nagybetű nem számít, a
 *     kötőjel és a szóköz sem: a bank vagy az ügyfél gyakran elhagyja vagy
 *     szóközre cseréli. Egy számjeggyel hosszabb szám NEM ugyanaz (D-1 nem
 *     párosul a D-12-re hivatkozó utalással);
 *   - az összeg PONTOSAN a díjbekérő bruttó összege.
 *
 * Ami ebből kilóg, az nem párosul, hanem kézi ellenőrzésre megy, az okkal:
 * egy rossz párosítás egy ki nem fizetett rendelést küldene ki, egy elmaradt
 * párosítást a kézi gomb pótol.
 */

export interface PairingProforma {
  /** A díjbekérő (OS bizonylat) azonosítója. */
  readonly id: string;
  readonly orderId: string;
  readonly number: string;
  /** Bruttó, tizedesponttal (`"4800.0000"`). */
  readonly grossAmount: string;
  readonly currency: string;
}

export interface PairingCredit {
  readonly id: string;
  readonly direction: "CREDIT" | "DEBIT";
  /** Előjel nélkül, tizedesponttal. */
  readonly amount: string;
  readonly currency: string;
  readonly narrative: string;
}

export type PairingDecision =
  | { readonly kind: "paired"; readonly transactionId: string }
  | {
      readonly kind: "review";
      readonly reason: string;
      readonly transactionIds: readonly string[];
    }
  | { readonly kind: "none" };

/** Szavakra bontva, nagybetűvel: minden nem betű-szám jel elválasztó. */
const words = (text: string): string[] =>
  text
    .toUpperCase()
    .split(/[^0-9A-ZÁÉÍÓÖŐÚÜŰ]+/u)
    .filter(Boolean);

/**
 * HIVATKOZIK-E A KÖZLEMÉNY A SZÁMRA. Két alak számít: a szám szavai egymás
 * után (`D ACR 2026 1`, bármilyen elválasztóval), vagy egyetlen szóba írva
 * (`DACR20261`). Részszó nem: a `D-12` közleményben a `D-1` nem áll.
 */
export function narrativeNames(narrative: string, number: string): boolean {
  const target = words(number);
  if (!target.length) return false;
  const text = words(narrative);
  const compact = target.join("");
  if (text.includes(compact)) return true;
  for (let start = 0; start + target.length <= text.length; start += 1)
    if (target.every((word, offset) => text[start + offset] === word))
      return true;
  return false;
}

/** Összeg-egyezés fillérre, a tizedesjegyek írásmódjától függetlenül. */
const cents = (value: string): bigint | null => {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const fraction = (match[2] ?? "").padEnd(2, "0");
  // a harmadik tizedestől csak nulla állhat: fillér alatti eltérés nem egyezés
  if (/[^0]/.test(fraction.slice(2))) return null;
  return BigInt(match[1]!) * 100n + BigInt(fraction.slice(0, 2));
};

const money = (value: string, currency: string) => {
  const amount = cents(value);
  return amount === null
    ? `${value} ${currency}`
    : `${(amount / 100n).toLocaleString("hu-HU")}${amount % 100n ? `,${String(amount % 100n).padStart(2, "0")}` : ""} ${currency}`;
};

/**
 * DÍJBEKÉRŐNKÉNT A DÖNTÉS. Egy jóváírás legfeljebb EGY díjbekérőt fizethet
 * ki: ha a közleménye kettőre is hivatkozik, mindkettő kézi ellenőrzésre megy.
 */
export function pairTransfers(
  proformas: readonly PairingProforma[],
  credits: readonly PairingCredit[],
): Map<string, PairingDecision> {
  const incoming = credits.filter((credit) => credit.direction === "CREDIT");
  const named = new Map<string, PairingCredit[]>();
  const claims = new Map<string, number>();
  for (const proforma of proformas) {
    const hits = incoming.filter(
      (credit) =>
        credit.currency.toUpperCase() === proforma.currency.toUpperCase() &&
        narrativeNames(credit.narrative, proforma.number),
    );
    named.set(proforma.id, hits);
    for (const hit of hits) claims.set(hit.id, (claims.get(hit.id) ?? 0) + 1);
  }

  const decisions = new Map<string, PairingDecision>();
  for (const proforma of proformas) {
    const hits = named.get(proforma.id) ?? [];
    if (!hits.length) {
      decisions.set(proforma.id, { kind: "none" });
      continue;
    }
    const ids = hits.map((hit) => hit.id);
    if (hits.some((hit) => (claims.get(hit.id) ?? 0) > 1)) {
      decisions.set(proforma.id, {
        kind: "review",
        reason:
          "Egy utalás közleménye több díjbekérőre is hivatkozik: kézzel kell eldönteni, melyiket fizette.",
        transactionIds: ids,
      });
      continue;
    }
    const expected = cents(proforma.grossAmount);
    const exact = hits.filter(
      (hit) => expected !== null && cents(hit.amount) === expected,
    );
    if (hits.length === 1 && exact.length === 1) {
      decisions.set(proforma.id, {
        kind: "paired",
        transactionId: exact[0]!.id,
      });
      continue;
    }
    decisions.set(proforma.id, {
      kind: "review",
      reason:
        hits.length > 1
          ? `${hits.length} utalás is erre a díjbekérőre hivatkozik: kézzel kell eldönteni, melyik a befizetés.`
          : `Az utalás összege ${money(hits[0]!.amount, hits[0]!.currency)}, a díjbekérőé ${money(proforma.grossAmount, proforma.currency)}.`,
      transactionIds: ids,
    });
  }
  return decisions;
}
