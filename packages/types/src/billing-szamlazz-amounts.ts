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

export interface SzamlazzUnitNetFromGrossInput {
  /** A beírt bruttó sorösszeg (mennyiség × egységár, a kedvezmény előtt). */
  grossAmount: string;
  quantity: string;
  vatRatePercent: string;
  currency: string;
}

export type SzamlazzUnitNetFromGross =
  | {
      ok: true;
      /** A tárolandó nettó egységár, legfeljebb 4 tizedessel. */
      unitNet: string;
      /** A tétel bruttója ebből az egységárból, a `szamlazzLineAmounts` szerint. */
      grossAmount: string;
      /** A tétel bruttója pontosan a beírt érték-e. */
      exact: boolean;
    }
  | {
      ok: false;
      /**
       * INVALID_NUMBER: valamelyik bemenet nem tizedes szám.
       * ZERO_QUANTITY: nullás mennyiségből nincs egységár.
       */
      error: "INVALID_NUMBER" | "ZERO_QUANTITY";
    };

/** A nettó egységár tárolási tizedesei (`Decimal(19, 4)`). */
const UNIT_NET_SCALE = 4;

/** `numerator / denominator`, fél-felfelé (a nullától el). */
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const rounded = (n * 2n + d) / (d * 2n);
  return negative ? -rounded : rounded;
}

const abs = (value: bigint) => (value < 0n ? -value : value);

/**
 * BRUTTÓBÓL A NETTÓ EGYSÉGÁR (Balázs a stage-en, 2026-09-30: "brutto osszeget
 * is lehessen beirni es szamolja vissza a nettot"). A tárolt érték továbbra is
 * a nettó egységár; a bruttó csak bevitel.
 *
 * A VISSZASZÁMOLÁS NEM MINDIG PONTOS, és ezt nem takarjuk el. A tétel bruttója
 * a Számlázz.hu szabályával nettó + round(nettó × kulcs), két tizedesen, tehát
 * bizonyos bruttók egyik nettóból sem jönnek ki (27%-on a 10 000,00: a 7874,01
 * nettó 9999,99-et, a 7874,02 10 000,01-et ad). A függvény a beírthoz
 * legközelebbi elérhető bruttót választja, és az `exact` megmondja, hogy
 * pontosan a beírt-e; a felület eltérésnél kiírja, mi kerül a számlára.
 *
 * A keresés a TÉTEL NETTÓJÁN megy (a pénznem tizedesein), mert a bruttó csak
 * attól függ: az ideális nettó körüli néhány értékből mindegyikhez a
 * mennyiséggel osztott, 4 tizedesre kerekített egységárat próbálja ki, a
 * `szamlazzLineAmounts`-szal, és azt tartja meg, aminek a bruttója a
 * beírthoz legközelebb esik. Azonos bruttónál a kevesebb tizedesű egységár
 * nyer (az a számlán is áll, és a 7874,02 olvashatóbb a 7874,0157-nél), végül
 * az ideálishoz közelebbi.
 */
export function szamlazzUnitNetFromGross(
  input: SzamlazzUnitNetFromGrossInput,
  rule: SzamlazzAmountRule = SZAMLAZZ_AMOUNT_RULE,
): SzamlazzUnitNetFromGross {
  const gross = parse(input.grossAmount.replace(",", "."));
  const quantity = parse(input.quantity.replace(",", "."));
  const rate = parse(input.vatRatePercent.replace(",", "."));
  if (!gross || !quantity || !rate)
    return { ok: false, error: "INVALID_NUMBER" };
  if (quantity.value === 0n) return { ok: false, error: "ZERO_QUANTITY" };
  const decimals = szamlazzMoneyDecimals(input.currency, rule);

  // (100 + kulcs) a kulcs skáláján
  const rateFactor = 100n * 10n ** BigInt(rate.scale) + rate.value;
  // az ideális tétel-nettó a pénznem tizedesein: bruttó × 100 / (100 + kulcs)
  const idealNet = divideRounded(
    gross.value * 100n * 10n ** BigInt(rate.scale + decimals),
    10n ** BigInt(gross.scale) * rateFactor,
  );
  // az ideális egységár 4 tizedesen: bruttó × 100 / (menny. × (100 + kulcs))
  const idealUnitNet = divideRounded(
    gross.value *
      100n *
      10n ** BigInt(rate.scale + quantity.scale + UNIT_NET_SCALE),
    10n ** BigInt(gross.scale) * quantity.value * rateFactor,
  );
  const typedGross = rescale(
    gross.value,
    gross.scale,
    Math.max(gross.scale, 2),
  );
  const typedScale = Math.max(gross.scale, 2);

  let best: {
    unitNet: bigint;
    grossAmount: string;
    distance: bigint;
    places: number;
    drift: bigint;
  } | null = null;
  const candidates = new Set<bigint>([idealUnitNet]);
  for (let step = -3n; step <= 3n; step += 1n) {
    // egységár = tétel-nettó / mennyiség, 4 tizedesre
    candidates.add(
      divideRounded(
        (idealNet + step) * 10n ** BigInt(quantity.scale + UNIT_NET_SCALE),
        10n ** BigInt(decimals) * quantity.value,
      ),
    );
  }
  for (const unitNet of candidates) {
    const result = szamlazzLineAmounts(
      {
        quantity: input.quantity.replace(",", "."),
        unitNet: format(unitNet, UNIT_NET_SCALE),
        vatRatePercent: input.vatRatePercent.replace(",", "."),
        currency: input.currency,
      },
      rule,
    );
    if (!result.ok) continue;
    const computed = parse(result.grossAmount)!;
    const distance = abs(
      rescale(computed.value, computed.scale, typedScale) - typedGross,
    );
    const places = decimalPlaces(unitNet, UNIT_NET_SCALE);
    const drift = abs(unitNet - idealUnitNet);
    if (
      !best ||
      distance < best.distance ||
      (distance === best.distance &&
        (places < best.places ||
          (places === best.places && drift < best.drift)))
    )
      best = {
        unitNet,
        grossAmount: result.grossAmount,
        distance,
        places,
        drift,
      };
  }
  if (!best) return { ok: false, error: "INVALID_NUMBER" };
  return {
    ok: true,
    unitNet: trimTrailingZeros(format(best.unitNet, UNIT_NET_SCALE)),
    grossAmount: best.grossAmount,
    exact: best.distance === 0n,
  };
}

/** Hány tizedes marad a végére álló nullák nélkül: 78740200 (4) -> 2. */
function decimalPlaces(value: bigint, scale: number): number {
  let places = scale;
  let rest = abs(value);
  while (places > 0 && rest % 10n === 0n) {
    rest /= 10n;
    places -= 1;
  }
  return places;
}

/** "7874.0200" -> "7874.02", "10000.0000" -> "10000". */
function trimTrailingZeros(text: string): string {
  if (!text.includes(".")) return text;
  return text.replace(/0+$/, "").replace(/\.$/, "");
}
