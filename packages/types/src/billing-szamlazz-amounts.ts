/**
 * A TÉTEL ÉS A BIZONYLAT ÖSSZEGEI, AHOGY A SZÁMLÁZZ.HU-RA MENNEK ÉS AHOGY
 * VISSZAJÖNNEK (Számlázás v0.1).
 *
 * A Számlázz.hu Agent tételenként két azonosságot ellenőriz (01-es doksi):
 * nettó egységár × mennyiség = nettó érték, nettó + ÁFA = bruttó; eltérésre
 * 259-264-es hibát ad. Hogy HUF-ban hány tizedest fogad el, és van-e tűrés az
 * első azonosságon, a doksi NEM mondja meg: a stage tesztfiókján mértük
 * (acrobot 25138 és 25153), öt változattal; az eredmény a konstansnál áll.
 *
 * A SZABÁLY PARAMÉTER, és egyetlen konstans rögzíti (`SZAMLAZZ_AMOUNT_RULE`).
 * A két kérdés, amire a mérés válaszolt:
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
 * A MÉRT SZABÁLY (stage tesztfiók, 2026-09-30, acrobot 25153, öt előnézet,
 * mind sikeres):
 *   - a tétel 2 tizedessel megy át (B: 3 × 1566,93 = 4700,79);
 *   - az egységár × mennyiség = nettó azonosságon van tűrés: a D (2350,395 ->
 *     2350,40) és az E (2350,395 -> 2350) is átment, tehát a tört mennyiség
 *     tizedes egységárral NEM termék-döntés;
 *   - a HUF végösszeget a Számlázz.hu TÉTELENKÉNT kerekíti egész forintra; a
 *     pontos szabály a `szamlazzDocumentTotals`-nál áll, 14 mérésből.
 */
export const SZAMLAZZ_AMOUNT_RULE: SzamlazzAmountRule = {
  hufDecimals: 2,
  exactNet: false,
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

export interface SzamlazzDocumentTotals {
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  /**
   * A tételek (a bemenet sorrendjében, 0-tól), amik nem nulla összeggel mentek,
   * és a forint-kerekítés után 0 Ft-os bruttóval állnak a számlán (mért: 0,20
   * Ft -> 0). Nem hiba, de a felület jelezze, ne tűnjön el csendben.
   */
  zeroForintLines: number[];
}

/**
 * A bizonylat végösszege, AHOGY A SZÁMLÁZZ.HU KIÍRJA. MÉRVE a stage
 * tesztfiókján (2026-09-30, acrobot 25153, 25157, 25159 és 25161, 14
 * előnézet, mindegyik sikeres), HUF-ban TÉTELENKÉNT:
 *
 *   bruttó = round(tétel bruttó)                    fél-felfelé, a nullától el
 *   ÁFA    = round(tétel ÁFA)
 *   nettó  = bruttó - ÁFA
 *
 * és a végösszeg ezek összege. Ami ezt eldöntötte, mert első ránézésre más
 * szabály is illett rá:
 *   - G (2350,40 + 2350,40): a nettó 4700, nem 4701 -> TÉTELENKÉNT kerekít;
 *   - H3 (1,40, bruttó 1,78): a nettó 2, nem 1 -> a nettót NEM önmagában
 *     kerekíti, hanem a kerekített bruttóból vezeti le;
 *   - I1 (5,75; ÁFA 1,55; bruttó 7,30): a nettó 5, I2 (20,12; 5,43; 25,55):
 *     a nettó 21 -> bruttó MÍNUSZ kerekített ÁFA, nem round(bruttó / 1,27);
 *   - H5 (10,00 és -0,40): -0,51 -> -1, a negatív sor is a nullától el kerül.
 * Más pénznemben a tétel 2 tizedese marad, ott nincs forint-kerekítés.
 */
export function szamlazzDocumentTotals(
  lines: ReadonlyArray<{
    netAmount: string;
    vatAmount: string;
    grossAmount: string;
  }>,
  currency: string,
): SzamlazzDocumentTotals {
  const decimals = currency.toUpperCase() === "HUF" ? 0 : 2;
  const read = (text: string) => {
    const parsed = parse(text);
    if (!parsed) throw new Error("SZAMLAZZ_TOTAL_INVALID_NUMBER");
    return parsed;
  };
  let net = 0n;
  let vat = 0n;
  let gross = 0n;
  const zeroForintLines: number[] = [];
  lines.forEach((line, index) => {
    const lineGross = read(line.grossAmount);
    const lineVat = read(line.vatAmount);
    const roundedGross = rescale(lineGross.value, lineGross.scale, decimals);
    const roundedVat = rescale(lineVat.value, lineVat.scale, decimals);
    if (roundedGross === 0n && lineGross.value !== 0n)
      zeroForintLines.push(index);
    gross += roundedGross;
    vat += roundedVat;
    net += roundedGross - roundedVat;
  });
  return {
    netAmount: format(net, decimals),
    vatAmount: format(vat, decimals),
    grossAmount: format(gross, decimals),
    zeroForintLines,
  };
}
