/**
 * A TÉTEL ÖSSZEGEI, AHOGY A SZÁMLÁZZ.HU-RA MENNEK (Számlázás v0.1).
 *
 * A Számlázz.hu Agent tételenként két azonosságot ellenőriz (01-es doksi):
 * nettó egységár × mennyiség = nettó érték, nettó + ÁFA = bruttó; eltérésre
 * 259-264-es hibát ad. Hogy HUF-ban hány tizedest fogad el, és van-e tűrés az
 * első azonosságon, a doksi NEM mondja meg: a stage tesztfiókján mérjük
 * (acrobot 25138), öt változattal. A mérés a tesztfiók kulcsára vár.
 *
 * EZÉRT A SZABÁLY PARAMÉTER, és a mérés után egyetlen konstans rögzíti
 * (`SZAMLAZZ_AMOUNT_RULE`). A két kérdés, amire a mérés válaszol:
 *   - `hufDecimals`: HUF-ban 0 (egész forint) vagy 2 tizedes;
 *   - `exactNet`: kell-e, hogy az egységár × mennyiség PONTOSAN kiadja a
 *     nettót a kerekítés után is. Ha kell, egy tört mennyiség tizedes
 *     egységárral nem mindig küldhető el, és azt nem kerüljük meg csendben:
 *     a függvény megmondja, és a döntés termék-kérdés (acrobot 25138).
 *
 * A felület és a szerver UGYANEZT hívja, így a felület ugyanazt a bruttót
 * mutatja, amit a számla kiír (murena kérése, szamlazas-vazlat-vegpontok.md).
 * A számítás BigInt fixpontos, lebegőpontos szám nélkül; a kerekítés
 * fél-felfelé (a nullától el), ahogy a `Decimal.ROUND_HALF_UP`.
 */

export interface SzamlazzAmountRule {
  /** A HUF összegek tizedesjegyei; más pénznemben mindig 2. */
  hufDecimals: 0 | 2;
  /** Pontosan ki kell-e adnia az egységár × mennyiségnek a nettót. */
  exactNet: boolean;
}

/**
 * A MÉRÉS ELŐTTI ÉRTÉK, ÉS NEM MÉRT: 2 tizedes, pontos nettó. Ez a kettő a
 * legszigorúbb pár, amit a doksi azonosságai megengednek: ami így elmegy, az
 * a mért szabály szerint is elmegy, fordítva nem biztos.
 */
export const SZAMLAZZ_AMOUNT_RULE: SzamlazzAmountRule = {
  hufDecimals: 2,
  exactNet: true,
};

export interface SzamlazzLineAmountsInput {
  /** Tizedes szöveg: "1.5". */
  quantity: string;
  /** Tizedes szöveg: "1566.93". */
  unitNet: string;
  /** Tizedes szöveg: "27". */
  vatRatePercent: string;
  currency: string;
}

export type SzamlazzLineAmounts =
  | {
      ok: true;
      /** Mind tizedes szöveg, a pénznem tizedesjegyeivel. */
      netAmount: string;
      vatAmount: string;
      grossAmount: string;
    }
  | {
      ok: false;
      /**
       * NET_NOT_EXACT: az egységár × mennyiség nem fér el a pénznem
       * tizedesjegyeiben, és a szabály pontos nettót kér.
       * INVALID_NUMBER: a bemenet nem tizedes szám.
       */
      error: "NET_NOT_EXACT" | "INVALID_NUMBER";
    };

const DECIMAL = /^-?\d+(?:\.\d+)?$/;

/** "1566.93" -> { value: 156693n, scale: 2 } */
function parse(text: string): { value: bigint; scale: number } | null {
  const trimmed = text.trim();
  if (!DECIMAL.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  return { value: BigInt(whole! + fraction), scale: fraction.length };
}

/** A `value / 10^from` érték `to` tizedesre, fél-felfelé (a nullától el). */
function rescale(value: bigint, from: number, to: number): bigint {
  if (to >= from) return value * 10n ** BigInt(to - from);
  const divisor = 10n ** BigInt(from - to);
  const half = divisor / 2n;
  const magnitude = value < 0n ? -value : value;
  const rounded = (magnitude + half) / divisor;
  return value < 0n ? -rounded : rounded;
}

function format(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value)
    .toString()
    .padStart(scale + 1, "0");
  const text =
    scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative ? `-${text}` : text;
}

export function szamlazzMoneyDecimals(
  currency: string,
  rule: SzamlazzAmountRule = SZAMLAZZ_AMOUNT_RULE,
): number {
  return currency.toUpperCase() === "HUF" ? rule.hufDecimals : 2;
}

/**
 * Egy tétel nettója, ÁFÁ-ja és bruttója, ahogy a Számlázz.hu-ra megy:
 *   nettó = egységár × mennyiség, a pénznem tizedeseire kerekítve
 *   ÁFA   = nettó × kulcs / 100, ugyanígy kerekítve
 *   bruttó = nettó + ÁFA (összeadás, tehát a második azonosság mindig áll)
 * Ha a szabály pontos nettót kér, és a kerekítés változtatna, hibát ad.
 */
export function szamlazzLineAmounts(
  line: SzamlazzLineAmountsInput,
  rule: SzamlazzAmountRule = SZAMLAZZ_AMOUNT_RULE,
): SzamlazzLineAmounts {
  const quantity = parse(line.quantity);
  const unitNet = parse(line.unitNet);
  const rate = parse(line.vatRatePercent);
  if (!quantity || !unitNet || !rate)
    return { ok: false, error: "INVALID_NUMBER" };
  const decimals = szamlazzMoneyDecimals(line.currency, rule);

  const exactScale = quantity.scale + unitNet.scale;
  const exact = quantity.value * unitNet.value;
  const net = rescale(exact, exactScale, decimals);
  if (rule.exactNet && rescale(net, decimals, exactScale) !== exact)
    return { ok: false, error: "NET_NOT_EXACT" };

  // nettó × kulcs / 100: a kulcs skálája plusz kettő
  const vat = rescale(net * rate.value, decimals + rate.scale + 2, decimals);
  return {
    ok: true,
    netAmount: format(net, decimals),
    vatAmount: format(vat, decimals),
    grossAmount: format(net + vat, decimals),
  };
}
