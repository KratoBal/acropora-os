/**
 * A KET LEIRAS-MEZO OSSZERAKASA A BOLT SZAMARA.
 *
 * MIERT KETTO: a UNAS ket kulon leirast tart (rovid es hosszu), es a MAI BOLT
 * MIND A KETTOT KIRAKJA, ket kulon helyre. Merve harom elo lapon: a
 * `page_artdet_rovleir` blokkban all a ROVID, a `tab_description_content`
 * blokkban a HOSSZU, es ahol mind a ketto letezik, a ROVID all ELOBB a
 * dokumentumban (1651 kontra 1791, illetve 1738 kontra 1881).
 *
 * A BOLT TEHAT NEM VALASZT KOZOTTUK. Ezert nem az a kerdes, melyik "nyer",
 * hanem hogy mind a ketto atmenjen.
 *
 * MIERT NEM A HOSSZ DONT: kezenfekvo lenne a hosszabb szoveget venni fo
 * leirasnak, es INSTABIL. Ha valaki holnap hozzair harom sort a rovid mezohoz,
 * egy termek fo leirasa csendben helyet cserelne. Egy leosztas, ami
 * karakterszamon billeg, nem leosztas.
 *
 * ES MIERT NEM CSAK A HOSSZU: merve a publikalt termekeken, 972-nek CSAK rovid
 * leirasa van. Ha a `description` csak a hosszut kapna, azok a lapok URESEN
 * erkeznenek meg -- azert, hogy 105 uresen erkezot megjavitsunk. Tizszer akkora
 * kar, mint a hiba, es rosszabb fajta: ma azok a lapok MUKODNEK.
 */

/**
 * AMI URESNEK SZAMIT, ES EZ MERT DONTES.
 *
 * Egy `<p>&nbsp;</p>` tartalmu mezo NEM tartalom: jelolo es egy nem-toro szokoz.
 * A tisztitas a jeloloket kiveszi es a szokozoket osszevonja -- ami utana nem
 * marad, az ures.
 *
 * MIERT SZAMIT: ket kulon meres a ket modszerrel 181 kontra 172 publikalt
 * terméket adott ugyanarra a kerdesre (hany terméknek van MIND A KET mezoje
 * kitoltve). A kulonbseg pontosan a csak-jelolobol allo mezok szama, es a
 * kesobbi ujraszamolasnak tudnia kell, mihez mer.
 */
export function descriptionTextContent(value: string | null): string {
  if (!value) return "";
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ProductDescriptions {
  /** A bolt fo leiras-mezojebe. `null`, ha egyik forras sincs. */
  description: string | null;
  /** A ket forras KULON is, hogy a kirakat ket helyre tudja tenni. */
  metadata: { unas_short_description?: string; unas_long_description?: string };
}

/**
 * A KETTO OSSZERAKASA, ES AZ EGYETLEN KIVETEL.
 *
 * ALAPESET: a ketto osszefuzve, ROVID eloszor -- ugyanabban a sorrendben, ahogy
 * a mai bolt lapja mutatja oket.
 *
 * A KIVETEL: ha az egyik szoveg BETURE tartalmazza a masikat, csak a TARTALMAZO
 * megy ki. Enelkul a vevo ugyanazt a bekezdest ketszer latna.
 *
 * ES A KIVETEL NEM EGY SZEGLETES ESET, HANEM A TOBBSEG EGY RESZE. Merve a
 * publikalt termekeken, ahol mind a ket mezo ki van toltve (181 termek):
 *
 *     a ketto AZONOS                 10
 *     a ROVID benne a hosszuban       3
 *     a HOSSZU benne a rovidben      66     <- a TOBBSEGI irany
 *     egyik sem tartalmazza         102
 *
 * A tartalmazas tehat NEM SZIMMETRIKUS, es a gyakoribb irany a forditott. Egy
 * kivetel, ami csak az egyik iranyt nezi, 66 lapon hagyna ott a duplikatumot --
 * ezert vizsgalja MIND A KETTOT.
 *
 * AZ OSSZEVETES A TISZTITOTT szovegen tortenik, a KIMENET viszont az EREDETI
 * (jelolokkel): a bolt HTML-t var, es a tartalmazas kerdese a SZOVEGROL szol,
 * nem a jelolokrol. Ket kulonbozo jeloles ugyanazzal a szoveggel duplikatum a
 * vevo szemeben, akkor is, ha bajtra kulonbozik.
 */
export function buildProductDescription(
  shortText: string | null,
  longText: string | null,
): ProductDescriptions {
  const metadata: ProductDescriptions["metadata"] = {};
  if (shortText) metadata.unas_short_description = shortText;
  if (longText) metadata.unas_long_description = longText;

  const shortContent = descriptionTextContent(shortText);
  const longContent = descriptionTextContent(longText);

  if (!shortContent && !longContent) return { description: null, metadata };
  if (!longContent) return { description: shortText, metadata };
  if (!shortContent) return { description: longText, metadata };

  /**
   * A TARTALMAZAS MINDKET IRANYBAN, es az AZONOS eset is ide esik (mindketto
   * tartalmazza a masikat, es a rovidet adjuk vissza -- barmelyik jo).
   */
  if (longContent.includes(shortContent))
    return { description: longText, metadata };
  if (shortContent.includes(longContent))
    return { description: shortText, metadata };

  return { description: `${shortText}\n${longText}`, metadata };
}
