/**
 * A BESZERZÉSI SZERZŐDÉS RÉSZTELJESÍTÉSE ÉS SZÁMLÁZÁSA (feladat
 * t-20261014-szerzodesek-reszteljesitese-szamlazasa-d510; Balázs 2026-10-14
 * 13:11: „jelezze, hogy történt számlázás; teljes számlázásnál zárja le;
 * részteljesítésnél jelezze, és a következő számla csak a még nem számlázott
 * részt engedje”).
 *
 * A számlázott mennyiség SZÁMOLT, nem tárolt: a szerződés-tételre mutató
 * számlasorok összege (`InvoiceLine.contractItemId`), csak a számít bele, amit
 * a hívó számlázottnak ad át (kiállított vagy kiállítás alatt álló, nem
 * sztornózott számla). Így egy sztornó magától visszaadja a mennyiséget, és
 * nincs második igazságforrás, ami elcsúszhatna.
 *
 * Tiszta függvények, adatbázis és hitelesítés nélkül: a szerver, a felület és
 * egy későbbi publikus felület ugyanezt számolja.
 */

const QUANTITY_SCALE = 6;

/** Mennyiség szövegként: "12", "1.5"; vessző is elfogadott. */
type QuantityText = string;

function parseQuantity(text: QuantityText): bigint | null {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text.trim().replace(",", "."));
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  if (fraction.length > QUANTITY_SCALE) return null;
  const value = BigInt(`${whole}${fraction.padEnd(QUANTITY_SCALE, "0")}`);
  return sign ? -value : value;
}

/** Skálázott egész -> a legrövidebb tizedes szöveg ("2", "1.5", "-0.25"). */
function formatQuantity(value: bigint): QuantityText {
  const negative = value < 0n;
  const digits = (negative ? -value : value)
    .toString()
    .padStart(QUANTITY_SCALE + 1, "0");
  const whole = digits.slice(0, digits.length - QUANTITY_SCALE);
  const fraction = digits
    .slice(digits.length - QUANTITY_SCALE)
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export type ContractBillingState = "NONE" | "PARTIAL" | "FULL";

export const CONTRACT_BILLING_STATE_LABELS: Record<
  ContractBillingState,
  string
> = {
  NONE: "Nincs számlázva",
  PARTIAL: "Részben számlázva",
  FULL: "Lezárva: teljesen számlázva",
};

export interface ContractBillingItemInput {
  id: string;
  quantity: QuantityText;
}

/** Egy számlázottnak számító sor (a hívó szűri: kiállított, nem sztornózott). */
export interface ContractBilledLine {
  contractItemId: string;
  quantity: QuantityText;
}

export interface ContractItemBilling {
  contractItemId: string;
  quantity: QuantityText;
  invoicedQuantity: QuantityText;
  /** Nem negatív: egy túlszámlázott tétel maradéka 0, a többlet `overInvoiced`. */
  remainingQuantity: QuantityText;
  overInvoiced: boolean;
}

export interface ContractBilling {
  state: ContractBillingState;
  items: ContractItemBilling[];
}

/**
 * A szerződés számlázási állapota tételenként. NONE: semmi nincs számlázva;
 * FULL: minden tétel maradéka 0 (és van legalább egy tétel); különben PARTIAL.
 * Egy olvashatatlan mennyiség 0-nak számít, nem dob: az állapot kijelzés.
 */
export function contractBilling(
  items: readonly ContractBillingItemInput[],
  billed: readonly ContractBilledLine[],
): ContractBilling {
  const sums = new Map<string, bigint>();
  for (const line of billed) {
    const quantity = parseQuantity(line.quantity) ?? 0n;
    sums.set(
      line.contractItemId,
      (sums.get(line.contractItemId) ?? 0n) + quantity,
    );
  }
  const rows = items.map((item) => {
    const total = parseQuantity(item.quantity) ?? 0n;
    const invoiced = sums.get(item.id) ?? 0n;
    const remaining = total - invoiced;
    return {
      contractItemId: item.id,
      quantity: formatQuantity(total),
      invoicedQuantity: formatQuantity(invoiced),
      remainingQuantity: formatQuantity(remaining > 0n ? remaining : 0n),
      overInvoiced: remaining < 0n,
      invoiced,
      remaining,
    };
  });
  const anyInvoiced = rows.some((row) => row.invoiced !== 0n);
  const allDone = rows.length > 0 && rows.every((row) => row.remaining <= 0n);
  return {
    state: !anyInvoiced ? "NONE" : allDone ? "FULL" : "PARTIAL",
    items: rows.map(({ invoiced: _i, remaining: _r, ...row }) => row),
  };
}

/** Egy kiállítandó számla szerződés-tételre mutató sora. */
export interface ContractDraftLine {
  contractItemId: string;
  description: string;
  quantity: QuantityText;
}

/**
 * „A következő számla csak a még nem számlázott részt engedje”: a kiállítandó
 * számla tételenkénti összege nem lépheti túl a maradékot, ami a TÖBBI
 * számlázott sor után marad. `null`, ha rendben; különben a magyar indok, ami
 * megnevezi a tételt, a kért és a megmaradt mennyiséget. Egy ismeretlen tétel
 * (nem ehhez a szerződéshez tartozik) is hiba: a sor nem mutathat idegen tételre.
 */
export function contractOverbillingProblem(
  items: readonly ContractBillingItemInput[],
  billedElsewhere: readonly ContractBilledLine[],
  draft: readonly ContractDraftLine[],
): string | null {
  const known = new Set(items.map((item) => item.id));
  const asked = new Map<string, { quantity: bigint; description: string }>();
  for (const line of draft) {
    if (!known.has(line.contractItemId))
      return `A(z) „${line.description}” sor olyan szerződés-tételre mutat, ami nem ehhez a szerződéshez tartozik.`;
    const quantity = parseQuantity(line.quantity);
    if (quantity === null)
      return `A(z) „${line.description}” sor mennyisége nem érvényes szám.`;
    const prev = asked.get(line.contractItemId);
    asked.set(line.contractItemId, {
      quantity: (prev?.quantity ?? 0n) + quantity,
      description: prev?.description ?? line.description,
    });
  }
  const state = contractBilling(items, billedElsewhere);
  for (const row of state.items) {
    const want = asked.get(row.contractItemId);
    if (!want) continue;
    const remaining = parseQuantity(row.remainingQuantity) ?? 0n;
    if (want.quantity > remaining)
      return remaining === 0n
        ? `A(z) „${want.description}” tétel már teljesen ki van számlázva a szerződésből; erre nem állítható ki újabb számla.`
        : `A(z) „${want.description}” tételből csak ${row.remainingQuantity} maradt számlázatlan, a számla pedig ${formatQuantity(want.quantity)} egységet kér.`;
  }
  return null;
}
