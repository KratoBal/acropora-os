/**
 * A HIBAJEGY SZÁMA: UGYANAZ A LOGIKA, MÁS ELŐTAG.
 *
 * A munkalap száma `BIO-2026-001` alakú: partner-rövidítés, alegység-kód, év,
 * sorszám. A hibajegyé `HJ-2026-001`: év és folyamatos sorszám, egy
 * megkülönböztető előtaggal.
 *
 * MIÉRT NEM SZÓ SZERINT UGYANAZ. A munkalap mindig egy vevőhöz és egy
 * alegységhez tartozik - onnan jön a rövidítés és a kód. A hibajegynél a vevő
 * ELHAGYHATÓ (mi is nyithatunk jegyet olyasmire, ami még nem kötődik
 * ügyfélhez), tehát a rövidítés nem mindig létezik. Egy szám, ami néha
 * kimarad, nem szám.
 *
 * AMI AZONOS, ÉS EZ VOLT A DÖNTÉS LÉNYEGE (Balázs, 2026-09-02): a SZERELŐ ÉS
 * AZ IRODA UGYANAZ AZ EMBER-KÖR. Ha a két szám másképp NÉZNE KI - más
 * elválasztó, más évalak, más sorszám-hossz -, minden telefonhívásnál
 * tisztázni kellene, melyikről van szó. A különbség ezért az ELŐTAG, nem a
 * szerkezet.
 *
 * ÉVENKÉNT EGY SZÁMLÁLÓ, az egész cégre, ahogy a munkalapnál is.
 */
export const SERVICE_JOB_NUMBER_PREFIX = "HJ";

/**
 * A KARBANTARTÁSI LAP SZÁMA KT-ÉÉÉÉ-NNN (Balázs, 2026-11-18, Luca-Balázs-Acrobot szál; acrobot 55777, 55781, 55787): a szerződésből keletkező
 * karbantartás nem hibajegy, a száma sem az. KÜLÖN sorozat (évente 001-ről, ugyanaz a három jegyű alak: az előtag az egyetlen különbség), a
 * hibajegy (REPAIR) HJ marad. A szám a LÉTREHOZÁS pillanatában kapott fajta szerint keletkezik; egy későbbi fajta-váltás nem számoz át.
 */
export type ServiceJobNumberKind = "REPAIR" | "MAINTENANCE";

export const SERVICE_JOB_NUMBER_PREFIXES: Readonly<
  Record<ServiceJobNumberKind, string>
> = { REPAIR: SERVICE_JOB_NUMBER_PREFIX, MAINTENANCE: "KT" };

const SEQUENCE_DIGITS = 3;

export function serviceJobNumberPrefix(
  year: number,
  kind: ServiceJobNumberKind = "REPAIR",
): string {
  return `${SERVICE_JOB_NUMBER_PREFIXES[kind]}-${year}-`;
}

/** A sorszám a szám végén (az előtag után), vagy `null`, ha nem értelmezhető. */
const serialOf = (number: string): number | null => {
  const tail = number.slice(number.lastIndexOf("-") + 1);
  const parsed = Number(tail);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
};

/**
 * A LEGNAGYOBB SZÁM, SZÁMSZERŰEN: az élő és a törölt/felszabadított számok közös maximumához (a törölt szám nem térhet vissza). Számszerű és
 * nem betűrendi, mert a "…-1000" betűrendben a "…-999" előtt áll. A hiányzó (`null`) kimarad; mind hiányzik: `null`. Azonos előtagú számokat vár.
 */
export function latestServiceJobNumber(
  ...numbers: readonly (string | null | undefined)[]
): string | null {
  let best: string | null = null;
  let bestSerial = -1;
  for (const number of numbers) {
    if (!number) continue;
    const serial = serialOf(number) ?? -1;
    if (best === null || serial > bestSerial) {
      best = number;
      bestSerial = serial;
    }
  }
  return best;
}

/**
 * A következő szám az idei LEGNAGYOBB alapján.
 *
 * A `null` az év első jegye. Egy nem értelmezhető sorszám (kézi beavatkozás,
 * importált sor) NEM csendben nullázza a számlálót: inkább dobunk, mert egy
 * újrakezdett sorozat két jegyet adna ugyanazzal a számmal, és azt utólag nem
 * lehet szétválasztani. Egy MÁSIK sorozat száma (HJ a KT-hez) sem értelmezhető: dob, nem számol át.
 */
export function nextServiceJobNumber(input: {
  year: number;
  lastNumber: string | null;
  kind?: ServiceJobNumberKind;
}): string {
  const prefix = serviceJobNumberPrefix(input.year, input.kind ?? "REPAIR");
  if (input.lastNumber === null)
    return `${prefix}${"1".padStart(SEQUENCE_DIGITS, "0")}`;

  if (!input.lastNumber.startsWith(prefix))
    throw new Error(
      `A legutolsó jegyszám (${input.lastNumber}) nem a ${prefix} sorozaté`,
    );
  const tail = input.lastNumber.slice(prefix.length);
  const parsed = Number(tail);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(
      `A legutolsó hibajegy-szám nem értelmezhető: ${input.lastNumber}`,
    );
  }
  return `${prefix}${String(parsed + 1).padStart(SEQUENCE_DIGITS, "0")}`;
}
