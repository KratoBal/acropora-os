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

const SEQUENCE_DIGITS = 3;

export function serviceJobNumberPrefix(year: number): string {
  return `${SERVICE_JOB_NUMBER_PREFIX}-${year}-`;
}

/**
 * A következő szám az idei LEGNAGYOBB alapján.
 *
 * A `null` az év első jegye. Egy nem értelmezhető sorszám (kézi beavatkozás,
 * importált sor) NEM csendben nullázza a számlálót: inkább dobunk, mert egy
 * újrakezdett sorozat két jegyet adna ugyanazzal a számmal, és azt utólag nem
 * lehet szétválasztani.
 */
export function nextServiceJobNumber(input: {
  year: number;
  lastNumber: string | null;
}): string {
  const prefix = serviceJobNumberPrefix(input.year);
  if (input.lastNumber === null)
    return `${prefix}${"1".padStart(SEQUENCE_DIGITS, "0")}`;

  const tail = input.lastNumber.slice(prefix.length);
  const parsed = Number(tail);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(
      `A legutolsó hibajegy-szám nem értelmezhető: ${input.lastNumber}`,
    );
  }
  return `${prefix}${String(parsed + 1).padStart(SEQUENCE_DIGITS, "0")}`;
}
