/**
 * A SZÁMLÁZÁS ÖSSZEG-SZÁMÍTÁSA, EGY HELYEN A FELÜLETNEK ÉS A SZERVERNEK.
 *
 * Balázs briefje (Számlázás v0.1, 15. pont): a felület élő számítást mutat,
 * a szerver újraszámol, és a böngésző összegét nem fogadja el. Ha a kettő
 * két külön kódból számolna, egy kerekítési eltérés ott jelenne meg, ahol a
 * legrosszabb: a felület más bruttót mutatna, mint ami a bizonylatra kerül.
 * Ezért EZ a modul az egyetlen számoló, és a csomag hitelesítéstől független
 * (a 2026-09-25-i "publikus alap" elv).
 *
 * === MIÉRT BIGINT, ÉS NEM NUMBER VAGY DECIMAL ===
 *
 * A `number` bináris lebegőpontos: 0,1 + 0,2 nem 0,3, és egy számla összege
 * ettől egy fillérrel elcsúszhat. A szerver `Prisma.Decimal`-lal számol, de
 * az a böngészőben nincs. A BigInt mindkét helyen ott van (ES2020), és a
 * fixpontos egész aritmetika PONTOS: a skálák a séma oszlopai (mennyiség 6,
 * pénz 4, százalék 2 tizedesjegy), a kerekítés fél-felfelé, a nullától el --
 * ugyanaz, mint a szerver `Decimal.ROUND_HALF_UP`-ja.
 *
 * === A KEDVEZMÉNY KÜLÖN NEGATÍV SOR ===
 *
 * Balázs döntése, 2026-09-30: a kedvezmény külön negatív sor, közvetlenül az
 * érintett tétel alatt. Ez a modul a tétel mellé kiszámolja a kedvezmény-sor
 * összegeit is; a sor tárolása a szerveré (`InvoiceLine.kind = DISCOUNT`).
 */

const QUANTITY_SCALE = 6;
const MONEY_SCALE = 4;
const PERCENT_SCALE = 2;

/** Egy tizedes szám szövegként: "12", "1.5", "-3.25". Vessző is elfogadott. */
export type DecimalText = string;

export type BillingAmountError =
  "BILLING_AMOUNT_INVALID" | "BILLING_AMOUNT_TOO_PRECISE";

/**
 * Szöveg -> skálázott egész. `null`, ha nem szám, vagy több tizedesjegyet
 * hordoz, mint az oszlop: egy 7 tizedesjegyes mennyiséget nem vágunk le
 * csendben, mert az a tárolt és a számolt érték elválását jelentené.
 */
function parseScaled(text: DecimalText, scale: number): bigint | null {
  const trimmed = text.trim().replace(",", ".");
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  if (fraction.length > scale) return null;
  const digits = `${whole}${fraction.padEnd(scale, "0")}`;
  const value = BigInt(digits);
  return sign ? -value : value;
}

/** Skálázott egész -> tizedes szöveg, a skála teljes hosszában ("12.5000"). */
function formatScaled(value: bigint, scale: number): DecimalText {
  const negative = value < 0n;
  const digits = (negative ? -value : value)
    .toString()
    .padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  return `${negative ? "-" : ""}${whole}${scale > 0 ? `.${fraction}` : ""}`;
}

/** Osztás 10^shift-tel, fél-felfelé (a nullától el) kerekítve. */
function divRound(value: bigint, shift: number): bigint {
  if (shift <= 0) return value * 10n ** BigInt(-shift);
  const divisor = 10n ** BigInt(shift);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  let quotient = absolute / divisor;
  if ((absolute % divisor) * 2n >= divisor) quotient += 1n;
  return negative ? -quotient : quotient;
}

export interface BillingLineInput {
  quantity: DecimalText;
  unitNet: DecimalText;
  vatRatePercent: DecimalText;
  /** `null` vagy "0": nincs kedvezmény-sor. */
  discountPercent: DecimalText | null;
}

export interface BillingAmounts {
  netAmount: DecimalText;
  vatAmount: DecimalText;
  grossAmount: DecimalText;
}

export interface BillingLineAmounts extends BillingAmounts {
  /** A tétel alatti negatív kedvezmény-sor, vagy `null`. */
  discount: (BillingAmounts & { discountPercent: DecimalText }) | null;
}

export interface BillingVatRateTotal extends BillingAmounts {
  vatRatePercent: DecimalText;
}

export interface BillingDocumentAmounts {
  lines: BillingLineAmounts[];
  totals: BillingAmounts;
  /** ÁFA-kulcsonként, növekvő kulcs szerint (az összesítő "ÁFA (27%)" sorai). */
  byVatRate: BillingVatRateTotal[];
}

export type BillingAmountsResult =
  | { ok: true; amounts: BillingDocumentAmounts }
  | {
      ok: false;
      error: BillingAmountError;
      lineIndex: number;
      field: keyof BillingLineInput;
    };

interface ScaledAmounts {
  net: bigint;
  vat: bigint;
}

/**
 * A SOR KÉT LÉPÉSBEN, ugyanúgy, mint a munkalap (`computeWorksheetLineAmounts`):
 * nettó = mennyiség × egységár, pénz-skálára kerekítve; ÁFA = nettó × kulcs /
 * 100, kerekítve; bruttó = a kettő összege. A bruttó így mindig pontosan a
 * nettó plusz az ÁFA, egy fillérnyi rés sem nyílhat köztük.
 */
function vatOf(net: bigint, rate: bigint): bigint {
  // net: MONEY_SCALE, rate: PERCENT_SCALE, és még /100 -> +2
  return divRound(net * rate, PERCENT_SCALE + 2);
}

export function computeBillingDocumentAmounts(
  inputs: readonly BillingLineInput[],
): BillingAmountsResult {
  const scaledLines: {
    item: ScaledAmounts;
    discount: (ScaledAmounts & { percent: bigint }) | null;
    rate: bigint;
  }[] = [];

  for (const [lineIndex, input] of inputs.entries()) {
    const quantity = parseScaled(input.quantity, QUANTITY_SCALE);
    if (quantity === null)
      return fail(input.quantity, QUANTITY_SCALE, lineIndex, "quantity");
    const unitNet = parseScaled(input.unitNet, MONEY_SCALE);
    if (unitNet === null)
      return fail(input.unitNet, MONEY_SCALE, lineIndex, "unitNet");
    const rate = parseScaled(input.vatRatePercent, PERCENT_SCALE);
    if (rate === null || rate < 0n)
      return fail(
        input.vatRatePercent,
        PERCENT_SCALE,
        lineIndex,
        "vatRatePercent",
      );
    const percent =
      input.discountPercent === null || input.discountPercent.trim() === ""
        ? 0n
        : parseScaled(input.discountPercent, PERCENT_SCALE);
    if (percent === null || percent < 0n || percent > 100n * 10n ** 2n)
      return fail(
        input.discountPercent ?? "",
        PERCENT_SCALE,
        lineIndex,
        "discountPercent",
      );

    const net = divRound(quantity * unitNet, QUANTITY_SCALE);
    const item = { net, vat: vatOf(net, rate) };
    let discount: (ScaledAmounts & { percent: bigint }) | null = null;
    if (percent > 0n) {
      const discountNet = -divRound(net * percent, PERCENT_SCALE + 2);
      discount = { net: discountNet, vat: vatOf(discountNet, rate), percent };
    }
    scaledLines.push({ item, discount, rate });
  }

  const byRate = new Map<bigint, ScaledAmounts>();
  let totalNet = 0n;
  let totalVat = 0n;
  for (const { item, discount, rate } of scaledLines) {
    for (const part of discount ? [item, discount] : [item]) {
      totalNet += part.net;
      totalVat += part.vat;
      const bucket = byRate.get(rate) ?? { net: 0n, vat: 0n };
      byRate.set(rate, {
        net: bucket.net + part.net,
        vat: bucket.vat + part.vat,
      });
    }
  }

  return {
    ok: true,
    amounts: {
      lines: scaledLines.map(({ item, discount }) => ({
        ...money(item),
        discount: discount
          ? {
              ...money(discount),
              discountPercent: formatScaled(discount.percent, PERCENT_SCALE),
            }
          : null,
      })),
      totals: money({ net: totalNet, vat: totalVat }),
      byVatRate: [...byRate.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([rate, amounts]) => ({
          vatRatePercent: formatScaled(rate, PERCENT_SCALE),
          ...money(amounts),
        })),
    },
  };
}

function money({ net, vat }: ScaledAmounts): BillingAmounts {
  return {
    netAmount: formatScaled(net, MONEY_SCALE),
    vatAmount: formatScaled(vat, MONEY_SCALE),
    grossAmount: formatScaled(net + vat, MONEY_SCALE),
  };
}

function fail(
  text: DecimalText,
  scale: number,
  lineIndex: number,
  field: keyof BillingLineInput,
): BillingAmountsResult {
  // A KÉT HIBA KÜLÖN: a "nem szám" és a "túl sok tizedesjegy" más teendőt ad a
  // felhasználónak, és a második nem gépelési hiba.
  const tooPrecise =
    /^-?\d+[.,]\d+$/.test(text.trim()) &&
    (text.trim().split(/[.,]/)[1]?.length ?? 0) > scale;
  return {
    ok: false,
    error: tooPrecise ? "BILLING_AMOUNT_TOO_PRECISE" : "BILLING_AMOUNT_INVALID",
    lineIndex,
    field,
  };
}
