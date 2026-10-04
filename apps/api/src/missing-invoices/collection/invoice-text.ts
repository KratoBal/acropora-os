/**
 * EGY ISMERETLEN SZÁLLÍTÓ PDF-JÉNEK ÁLTALÁNOS OLVASÁSA (kártya 3e75c2f4).
 *
 * A szállítói illesztők (`supplier-invoice-import`) szállítónként olvasnak, és
 * mindent kivesznek. A begyűjtött PDF-ek nagy része viszont olyan szállítótól
 * jön, akinek nincs illesztője; ezekből csak annyi kell, amennyi a NAV-sorhoz
 * köti őket: a SZÁMLASZÁM és a szállító ADÓSZÁMA (a kulcs a párosításban:
 * `mergeSameInvoice`). A kelet és a bruttót a NAV-sor adja, amint a kettő
 * összeért.
 *
 * NINCS KALIBRÁLVA VALÓDI MINTÁN (2026-10-01): a címkék a magyar és az angol
 * számlák szokásos feliratai. A mérés a 31 augusztusi „Eredeti hiányzik”
 * NAV-sor ellen jön, az acrobot által kért mintán; addig a begyűjtés kapcsolója
 * KI marad.
 */
import { ACROPORA_COMPANY } from "@acropora/types";

export interface InvoiceTextReading {
  invoiceNumber: string | null;
  /** Honnan jött a szám; a mérés és a hibakeresés ebből látja, melyik szabály vitte. */
  numberFrom: "NAV" | "BANK" | "LABEL" | "FILE_NAME" | null;
  /** A szállító adószáma: az első, ami nem a miénk (magyar vagy EU-s alak). */
  supplierTaxNumber: string | null;
  /**
   * Amivel egy banki terhelés közleménye a számlára hivatkozik, ha az nem a
   * számla száma (például a rendelésé); a párosító 1. szabálya ezt is nézi.
   */
  bankReference?: string | null;
  /**
   * A kártyás fizetés, amihez a NAV nélküli számla illik (`cardPaymentMatch`):
   * az összeg és a deviza a terhelésé, a partner a terhelés partnerneve. A
   * párosító ebből tudja a dokumentum bruttóját és szállítóját.
   */
  cardPayment?: CardPaymentMatch | null;
}

/** Egy kártyás terhelés, amennyit a számla felismeréséhez kell. */
export interface CardDebit {
  /** a BankTransaction azonosítója: a párosító ehhez köti a dokumentumot */
  id: string;
  /** ÉÉÉÉ-HH-NN */
  bookingDate: string;
  counterpartyName: string;
  /** a könyvelt összeg, a bankszámla pénznemében */
  amount: string;
  currency: string;
  /** a közlemény eredeti devizás összege (`originalAmountOf`), ha van */
  original: { amount: string; currency: string } | null;
}

export interface CardPaymentMatch {
  /** a számla összege (több fizetésnél azok összege) */
  amount: string;
  currency: string;
  partner: string;
  /** a fizetés(ek) azonosítója: egy, vagy legfeljebb három (Kia Charge) */
  debitIds: string[];
}

export interface InvoiceTextHints {
  /**
   * A szállító (adószám szerint) NAV-ban ismert számlaszámai. Ha egyik a
   * szövegben áll, az a szám: ezt nem kitaláljuk, hanem megtaláljuk.
   */
  navNumbers?: (supplierTaxBase: string) => readonly string[];
  /** A fájl neve és a levél tárgya: a szám sokszor ott is áll. */
  fileName?: string;
  subject?: string | null;
}

/**
 * A SZÁMLA-SZÓ ÖNÁLLÓ SZÓKÉNT: a „bankszámlaszám” nem számla. A `\b` az
 * ékezetes betűt nem tartja betűnek, ezért saját határ áll itt.
 */
const INVOICE_WORD =
  /(?<!\p{L})(számla|szamla|e-számla|invoice|rechnung|facture|faktura|fattura|factura|díjbekérő|díjértesítő|díjértesítés)(?!\p{L})/iu;

/**
 * A SZÁMLASZÁM CÍMKÉI. A sorrend számít: a hosszabb, pontosabb címke áll
 * elöl, különben a „Számla” magában elvinné a „Számla sorszáma” sort.
 */
const NUMBER_LABELS = [
  "számla sorszáma",
  "számla száma",
  "számlaszám",
  "számla sorszám",
  "sorszám",
  "invoice number",
  "invoice no.",
  "invoice no",
  "invoice #",
  "rechnungsnummer",
  "rechnung nr.",
  "rechnung nr",
  "numéro de facture",
  "facture n°",
];

/**
 * A „számlaszám” a magyarban a BANKSZÁMLA száma is (mérve 2026-10-01, az info@
 * augusztusi mintáján: a saját számláinkon a címke után a bankszámlánk állt).
 * Ez az alak ezért nem számlaszám.
 */
const BANK_ACCOUNT = /^\d{8}-\d{8}(-\d{8})?$/;

/**
 * IBAN: országkód, két ellenőrző számjegy, legalább 11 további jel (a
 * legrövidebb IBAN 15 jel). Mérve 2026-10-01, éles: a De Jong fizetési
 * emlékeztetőiben a szállító IBAN-ja (NL30RABO0322265428) minden De Jong
 * terhelés közleményében önálló szóként áll, ezért a banki hivatkozás
 * keresése az IBAN-t találta meg „számlaszámként”, és az emlékeztető minden
 * De Jong fizetéshez párosodott.
 */
const IBAN = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;

/** Bankszámlaszám (hazai vagy IBAN), ami soha nem számlaszám. */
export const looksLikeBankAccount = (value: string): boolean =>
  BANK_ACCOUNT.test(value) || IBAN.test(compactNumber(value));

/**
 * MAGYAR ADÓSZÁM, VAGY A MIÉNK BÁRMILYEN ALAKBAN: egy céget azonosít, nem egy
 * dokumentumot, tehát sem számlaszám, sem banki hivatkozás nem lehet (acrobot
 * 26158, UNAS díjbekérők: a banki ág a VEVŐ, vagyis a saját adószámunkat
 * vette számlaszámnak, mert egy terhelés közleménye is hordozta).
 */
export const looksLikeTaxNumber = (value: string): boolean => {
  const digits = value.replace(/^HU/i, "").replace(/\D/g, "");
  return (
    HU_TAX_NUMBER.test(value.trim()) ||
    ((digits.length === 8 || digits.length === 11) &&
      digits.slice(0, 8) === ACROPORA_COMPANY.taxNumberBase)
  );
};

/**
 * Egy számlaszám alakja: betűvel vagy számmal kezdődik, legalább 3 jel. Előtte
 * a `|` is állhat: a PDF-olvasó (`pdfTextLines`) így választja el a táblázat
 * celláit. Mérve 2026-10-04 a FleetCor számláin: a „Számla száma |
 * E0401352892” sorban a címke ezen akadt el, és a szám helyett a fájlnév
 * tartaléka vitte az ügyfél-azonosítót.
 */
const NUMBER_TOKEN = /^[#:.|\s]*([A-Za-z0-9][A-Za-z0-9\-/_.]{2,39})/;

/**
 * AZ ÜGYFÉL-AZONOSÍTÓ CÍMKÉI. Ami a szövegben ilyen címke után áll, az a MI
 * azonosítónk a szállítónál, nem a számla száma, akkor sem, ha a levél tárgya
 * vagy a fájlneve is hordozza (FleetCor: „ügyfélazonosítószám: HU00008659” a
 * tárgyban, „Ügyfélazonosító szám | HU00008659” a számlán, minden hónapban
 * ugyanaz).
 */
const CUSTOMER_ID_LABELS = [
  "ügyfélazonosító szám",
  "ügyfélazonosítószám",
  "ügyfélazonosító",
  "ügyfélszám",
  "vevőkód",
  "vevőazonosító",
  "customer number",
  "customer no",
  "customer id",
  "kundennummer",
];

/** A szövegben ügyfél-azonosítóként címkézett értékek, tömörített alakban. */
export function customerIds(lines: readonly string[]): Set<string> {
  const ids = new Set<string>();
  for (const label of CUSTOMER_ID_LABELS) {
    const value = labelledValue(lines, label);
    if (value) ids.add(compactNumber(value));
  }
  return ids;
}

/**
 * Magyar adószám (`12345678-1-12`), vagy EU-s közösségi adószám. Az EU-s alak
 * az országkód után CSAK számjegy (a francia és a holland saját alakjával): a
 * betűs változat a mintán BIC-kódot (`DRESDEFF510`) és szót (`CONFIRMATION`)
 * fogott.
 */
const HU_TAX_NUMBER = /^\d{8}-\d-\d{2}$/;
const TAX_NUMBER =
  /(?<![\dA-Za-z])(\d{8}-\d-\d{2}|FR[0-9A-Z]{2}\d{9}|NL\d{9}B\d{2}|ATU\d{8}|[A-Z]{2}\d{8,12})(?![\dA-Za-z])/g;

const usable = (value: string | undefined): string | null => {
  const cleaned = value?.replace(/[.]$/, "");
  return cleaned && /\d/.test(cleaned) && !BANK_ACCOUNT.test(cleaned)
    ? cleaned
    : null;
};

/**
 * A CÍMKE UTÁNI ÉRTÉK, A CELLÁJÁVAL EGYÜTT MEGÍTÉLVE (2026-10-04, a `|` előtag
 * bekapcsolásakor az exchange 517 számlaszerű PDF-jén mérve):
 *
 *   - ha a cella szóközök nélkül bankszámlaszám, nem számlaszám (OTP: „Ellen-
 *     oldali számlaszám | 50453331 -10000843 -00000000”);
 *   - ha az értéket egy ÜRES cella követi, a PDF-olvasó egy értéket vágott
 *     szét (Stripe: „Invoice number | 53AEF736 |   | 256060”, a számla száma
 *     53AEF736-256060; a kötőjel helyén NUL karakter áll). A darab nem a szám: minden számlán ugyanaz az előtag
 *     állna, tehát két különböző számla egy számot kapna. Ilyenkor nincs
 *     címkézett érték, és a régi út (fájlnév) dönt.
 */
function cellValue(text: string): string | null {
  const match = NUMBER_TOKEN.exec(text);
  if (!match) return null;
  const after = text.slice(match[0].length);
  const cell = `${match[1]}${after.split("|")[0]}`.replace(/\s+/g, "");
  if (BANK_ACCOUNT.test(cell)) return null;
  // üres: szóköz vagy vezérlőjel (a Stripe-PDF kötőjele NUL-ként jön át)
  if (/^[^|]*\|[\s\u0000-\u001f]*\|/.test(after)) return null;
  return usable(match[1]);
}

function labelledValue(lines: readonly string[], label: string): string | null {
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i]!.toLowerCase();
    let at = lower.indexOf(label);
    // a címke önálló szó legyen: a „bankszámlaszám” nem „számlaszám”
    while (at > 0 && /\p{L}/u.test(lower[at - 1]!))
      at = lower.indexOf(label, at + 1);
    if (at < 0) continue;
    const rest = lines[i]!.slice(at + label.length);
    const sameLine = cellValue(rest);
    if (sameLine) return sameLine;
    // a címke alatti sorban áll az érték (táblázatos fejléc)
    const next = cellValue(lines[i + 1] ?? "");
    if (!rest.trim() && next) return next;
  }
  return null;
}

/** Betű és szám, minden más nélkül: a `KS26/09229` és a `KS2609229` így egy. */
export const compactNumber = (value: string): string =>
  value.toUpperCase().replace(/[^A-Z0-9]/g, "");

const taxBase = (tax: string): string =>
  tax.replace(/^HU/, "").replace(/\D/g, "").slice(0, 8);

/**
 * A SZÁMLA HIVATKOZÁSA EGY BANKI TERHELÉS KÖZLEMÉNYÉBEN. A külföldi szállító
 * számlája nincs a NAV-ban, tehát a NAV-kulcs soha nem viszi; a közlemény
 * viszont sokszor megnevezi. Mérve 2026-10-01, éles:
 *
 *   Amblard      „485,40 EUR F2602896 ...”    a számla száma (F2602896.PDF)
 *   Fauna Marin  „1.698,58 EUR 20144304 ...”  a RENDELÉS száma, ami a számlán
 *                                               „Auftragsnr.” alatt áll; a
 *                                               számla száma 40142365
 *
 * A jelöltek sorrendben: amit az olvasó számnak talált, a fájlnév és a tárgy
 * szavai (ha a PDF szövegében is állnak), végül a PDF szövegének szám-szavai.
 * Az első kettő a közlemény tömörített szövegében bárhol állhat, mint a
 * párosító 1. szabályánál. A harmadik szigorúbb, mert sok van belőle: csak
 * pont és vessző nélküli szó (az összeg és a dátum így kiesik), legalább 6
 * karakter és 5 számjegy, és a közleményben is ÖNÁLLÓ SZÓKÉNT kell állnia (egy
 * IBAN belseje nem találat).
 */
export function bankReference(
  lines: readonly string[],
  reading: InvoiceTextReading,
  hints: Pick<InvoiceTextHints, "fileName" | "subject">,
  narratives: readonly string[],
): string | null {
  const text = lines.join("\n");
  const compactText = compactNumber(text);
  const fromName = `${hints.fileName ?? ""} ${hints.subject ?? ""}`
    .split(/[^A-Za-z0-9/_-]+/)
    .map((token) => token.replace(/^[-_/]+|[-_/]+$/g, ""))
    .filter((token) => compactText.includes(compactNumber(token)));
  const compactNarratives = narratives.map(compactNumber);
  const loose = [reading.invoiceNumber, ...fromName]
    .filter((n): n is string => n !== null)
    .filter((n) => compactNumber(n).length >= 5 && /\d/.test(n))
    .filter((n) => !looksLikeBankAccount(n) && !looksLikeTaxNumber(n))
    .find((n) =>
      compactNarratives.some((narrative) =>
        narrative.includes(compactNumber(n)),
      ),
    );
  if (loose) return loose;
  const narrativeWords = new Set(
    narratives.flatMap((narrative) =>
      narrative.split(/\s+/).map(compactNumber),
    ),
  );
  return (
    text
      .split(/[\s|]+/)
      .filter((word) => /^[A-Za-z0-9/-]+$/.test(word))
      .filter(
        (word) =>
          compactNumber(word).length >= 6 &&
          (word.match(/\d/g) ?? []).length >= 5 &&
          !looksLikeBankAccount(word) &&
          !looksLikeTaxNumber(word),
      )
      .find((word) => narrativeWords.has(compactNumber(word))) ?? null
  );
}

export function looksLikeInvoice(text: string): boolean {
  return INVOICE_WORD.test(text);
}

/**
 * DÍJBEKÉRŐ-E. A könyvelőnek nem számla (a Hiányzó számlák „Csak díjbekérő”
 * állapota), ezért a kind ennek alapján PROFORMA, ha illesztő nem olvasta.
 */
const PROFORMA_WORD =
  /(?<!\p{L})(díjbekérő|dijbekero|előlegbekérő|proforma|pro forma|pro-forma|facture provisoire)(?!\p{L})/iu;

/**
 * FIZETÉSI EMLÉKEZTETŐ, FELSZÓLÍTÁS (acrobot 25664 és 25668, Balázs a De
 * Jong-számlákról): nem számla, de idézi a számla számát, ezért a NAV- vagy a
 * banki kulcs megtalálja. A levélben gyakran MELLETTE áll a számla PDF-je is
 * (De Jong: „Second reminder 11069-26007910.pdf” és „inv26007910.pdf”), tehát
 * nem a levelet, csak ezt a mellékletet kell kihagyni.
 *
 * A fájlnév, vagy a szöveg ELEJE (a cím). Mérve 2026-10-01 az exchange 627
 * olvasható PDF-jén: a 15 emlékeztető mind a fájlnévben, mind az első öt sorban
 * viseli a szót; a többi találat hosszú szöveg mélyén áll (egy adatkezelési
 * tájékoztató 195. sorában „Mahnung”, egy szerződés 398. sorában
 * „felszólítás”), és egyik sem számla.
 */
const REMINDER_WORD =
  /(?<!\p{L})(reminder|mahnung|zahlungserinnerung|zahlungsaufforderung|emlékeztető|emlekezteto|felszólítás|felszolitas|rappel|relance|herinnering|aanmaning|sollecito|upomínka|dunning)(?!\p{L})/iu;
const REMINDER_TITLE_LINES = 10;

/** A fájlnév fizetési emlékeztetőé (a már tárolt dokumentumoknál csak ez van kéznél). */
export function reminderFileName(fileName: string | null | undefined): boolean {
  return REMINDER_WORD.test((fileName ?? "").replace(/[_.-]+/g, " "));
}

/**
 * SZERZŐDÉS, AJÁNLAT, VÁMNYILATKOZAT (acrobot 25784, barracuda vak címkéi a Jev
 * levél-válogatás DEV-eltérésein): a gyűjtő ezeket számlaként tárolta, mert a
 * szövegükben a partner egy NAV-számlaszáma vagy egy banki hivatkozás is
 * állhat. Nem számlák, tehát a fizetéshez sem lehetnek jelöltek.
 *
 * A fájlnév, vagy a CÍM: az első 10 sor egyike, ami csak a megnevezésből és
 * esetleg egy azonosítóból áll („ADÁSVÉTELI SZERZŐDÉS”, „Árajánlat |
 * AJ26-U60-01170”). Egy számla „Ajánlat száma: …” sora nem cím, és nem zár ki.
 * Mérve 2026-10-01 a 435 tárolt dokumentumon: 10-et zár ki, mind a 10 szerződés,
 * ajánlat vagy vámnyilatkozat (4 vakon címkézve, 6 szövegből ellenőrizve),
 * számlát egyet sem. Mind a 10-et a fájlneve fogja meg; a cím a fájlnév nélküli
 * új levelekre való.
 */
const OTHER_DOCUMENT_KIND = String.raw`(?:adásvételi\s+|vállalkozási\s+|bérleti\s+)?(?:keret)?szerződés|megállapodás|árajánlat|ajánlat|quotation|angebot|devis|árunyilatkozat|vámáru-nyilatkozat`;
const OTHER_DOCUMENT_TITLE = new RegExp(
  String.raw`^[\s|:\-–]*(?:${OTHER_DOCUMENT_KIND})(?:[\s|#\-–]+[\p{Lu}\d][\p{L}\d/._-]*\d[\p{L}\d/._-]*)?[\s|\-–]*$`,
  "iu",
);
const OTHER_DOCUMENT_NAME =
  /(?<!\p{L})(szerződés|szerzodes|árajánlat|arajanlat|ajánlat|ajanlat|árunyilatkozat|arunyilatkozat|quotation|angebot)/iu;

/** A fájlnév szerződésé, ajánlaté vagy vámnyilatkozaté (a tárolt dokumentumnál csak ez van kéznél). */
export function otherDocumentFileName(
  fileName: string | null | undefined,
): boolean {
  // a levelek fájlneve gyakran NFD alakú (ő = o + ékezet), a minta NFC; a
  // „mycarAjanlat” alakban a szóhatár a nagybetű előtt van
  return OTHER_DOCUMENT_NAME.test(
    (fileName ?? "")
      .normalize("NFC")
      .replace(/[_.]+/g, " ")
      .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2"),
  );
}

export function looksLikeOtherDocument(
  lines: readonly string[],
  fileName: string | null | undefined,
): boolean {
  return (
    otherDocumentFileName(fileName) ||
    lines
      .slice(0, REMINDER_TITLE_LINES)
      .some((line) => OTHER_DOCUMENT_TITLE.test(line.normalize("NFC")))
  );
}

export function looksLikeReminder(
  lines: readonly string[],
  fileName: string | null | undefined,
): boolean {
  return (
    reminderFileName(fileName) ||
    lines
      .slice(0, REMINDER_TITLE_LINES)
      .some((line) => REMINDER_WORD.test(line))
  );
}

export function looksLikeProforma(text: string): boolean {
  return PROFORMA_WORD.test(text);
}

/**
 * DÍJBEKÉRŐ A LEVÉL-BESOROLÓ ELŐTT (acrobot 25840). A Jev a díjbekérőt számlának
 * veheti: a HOLDOUT egyetlen hamis „bejövő számlája” egy CONTRACT/PROFORMA-INVOICE
 * fejlécű, `РI-` számú díjbekérő volt (0,83), és a DEV-en ugyanez a fajta állt
 * (0,74). A díjbekérő nem kerülhet számlaként a jelöltek közé, ezért ez a szűrő
 * a hívás ELŐTT dönt, determinisztikusan.
 *
 * A fájlnév (`PI-`, vagy a díjbekérő szó), vagy az első 10 sor (a díjbekérő szó,
 * vagy egy `PI-` szám; a `Р` cirill is lehet, a PDF így hozta). A teljes szöveg
 * NEM: egy számla, ami a korábbi díjbekérőjére hivatkozik, attól még számla.
 * Mérve 2026-10-01 az 1029 mért levélen: 35-öt fog meg, ebből 10 UNMATCHED; ott
 * a Jev kettőt mondott számlának, és mind a kettő díjbekérő volt. A teljes
 * szövegre egy vakon címkézett valódi számlát is elvett volna.
 */
const PROFORMA_NUMBER = /(?<![\p{L}\d])[PР][IІ]-[\p{L}\d]*\d/u;
const PROFORMA_FILE = /^[PР][IІ][-_ ]/iu;

export function looksLikeProformaLetter(
  lines: readonly string[],
  fileName: string | null | undefined,
): boolean {
  const name = (fileName ?? "").normalize("NFC");
  const title = lines
    .slice(0, REMINDER_TITLE_LINES)
    .map((line) => line.normalize("NFC"))
    .join("\n");
  return (
    PROFORMA_FILE.test(name) ||
    PROFORMA_WORD.test(name.replace(/[_.]+/g, " ")) ||
    PROFORMA_WORD.test(title) ||
    PROFORMA_NUMBER.test(title)
  );
}

export function readInvoiceText(
  lines: readonly string[],
  hints: InvoiceTextHints = {},
): InvoiceTextReading {
  const text = lines.join("\n");
  const ours = ACROPORA_COMPANY.taxNumberBase;
  /*
    A TELJES MAGYAR ALAK ELŐBB, AZ EU-S UTÁNA, nem a szöveg sorrendjében. Mérve
    2026-10-01, a balazs@ augusztusi mintáján: a FleetCor számláján egy
    ügyfél-azonosító (`HU0000865961148`) darabja előbb állt, mint a szállító
    `25103272-2-42` adószáma, és EU-s adószámnak látszott; a NAV-kulcs így
    elment a számla mellett.
  */
  // az ügyfél-azonosító EU-s adószámnak is látszhat (FleetCor: HU00008659 a
  // számla-áttekintésen, ahol a szállító adószáma nem is áll); az nem adószám
  const customers = customerIds(lines);
  const taxNumbers = [...text.matchAll(TAX_NUMBER)]
    .map((m) => m[1] as string)
    .filter((tax) => taxBase(tax) !== ours)
    .filter((tax) => !customers.has(compactNumber(tax)));
  const supplierTaxNumber =
    taxNumbers.find((tax) => HU_TAX_NUMBER.test(tax)) ?? taxNumbers[0] ?? null;
  const reading = (
    invoiceNumber: string | null,
    numberFrom: InvoiceTextReading["numberFrom"],
  ): InvoiceTextReading => ({ invoiceNumber, numberFrom, supplierTaxNumber });

  const compactText = compactNumber(text);
  let labelled: string | null = null;
  for (const label of NUMBER_LABELS) {
    labelled = labelledValue(lines, label);
    if (labelled) break;
  }
  if (supplierTaxNumber && hints.navNumbers) {
    const present = hints
      .navNumbers(taxBase(supplierTaxNumber))
      .filter(
        (number) =>
          compactNumber(number).length >= 4 &&
          compactText.includes(compactNumber(number)),
      );
    // ami egy másik, itt álló számnak csak a része, az nem önálló találat
    const whole = present.filter(
      (number) =>
        !present.some(
          (other) =>
            compactNumber(other).length > compactNumber(number).length &&
            compactNumber(other).includes(compactNumber(number)),
        ),
    );
    /*
      TÖBB NAV-SZÁM IS ÁLLHAT A SZÖVEGBEN (mérve 2026-10-01, egy MVM-számlán:
      a korábbi számlák listája a számla végén). Ezért a címke dönt, ha van:
      a címkézett számtól ELTÉRŐ NAV-szám nem találat, akkor sem, ha egyedül
      áll (a számla saját száma még nincs a NAV-ban, a hivatkozott régi igen).
      Címke nélkül a fájlnév vagy a tárgy dönt, végül az egyetlen találat.
    */
    const inName = compactNumber(
      `${hints.fileName ?? ""} ${hints.subject ?? ""}`,
    );
    const found = labelled
      ? whole.find((n) => compactNumber(n) === compactNumber(labelled!))
      : (whole.find((n) => inName.includes(compactNumber(n))) ??
        (whole.length === 1 ? whole[0] : undefined));
    if (found) return reading(found, "NAV");
  }
  if (labelled) return reading(labelled, "LABEL");
  const fromName = `${hints.fileName ?? ""} ${hints.subject ?? ""}`
    .split(/[^A-Za-z0-9/_-]+/)
    .map((token) => token.replace(/^[-_/]+|[-_/]+$/g, ""))
    .find(
      (token) =>
        token.length >= 5 &&
        /\d/.test(token) &&
        !BANK_ACCOUNT.test(token) &&
        !looksLikeTaxNumber(token) &&
        !customers.has(compactNumber(token)) &&
        compactText.includes(compactNumber(token)),
    );
  return fromName ? reading(fromName, "FILE_NAME") : reading(null, null);
}

/**
 * A NAV NÉLKÜLI SZÁMLA ÉS A KÁRTYÁS FIZETÉS (acrobot 25666 és 25673, Balázs a
 * Hetznerről): a külföldi előfizetés számlája nincs a NAV-ban, és a kártyás
 * közlemény nem nevezi meg (`2026.09.06 ... HETZNER ONLINE GMBH 46,640EUR`).
 * A számla akkor tartozik egy fizetéshez, ha
 *
 *   - a fizetés partnernevének jellemző szava (az első legalább négybetűs,
 *     nem a mi nevünk) önálló szóként áll a szövegben, ÉS
 *   - a fizetés összege (a devizás eredeti, vagy a könyvelt forint) pénzösszegként
 *     áll a szövegben,
 *
 * és ez PONTOSAN EGY fizetésre igaz. Nem a végösszeget olvassuk ki (az
 * általános olvasó azt nem tudja, és a formák túl sokfélék), hanem azt nézzük,
 * hogy a fizetés összege szerepel-e. Mérve 2026-10-01 az exchange PDF-jein:
 * lásd a PR leírását.
 */
const OWN_NAME = /^acropora/;

/** A szöveg pénzösszeg-alakú számai, értékként (két tizedesre kerekítve, centben). */
function moneyValues(text: string): Set<number> {
  const values = new Set<number>();
  const token =
    /(?<![\d.,])(\d{1,3}(?:[ \u00a0.,]\d{3})+(?:[.,]\d{1,4})?|\d+(?:[.,]\d{1,4})?)(?![\d])/g;
  for (const match of text.matchAll(token)) {
    const raw = match[1]!.replace(/[ \u00a0]/g, "");
    // az utolsó elválasztó tizedesjel, ha nem pontosan három jegy követi
    const last = Math.max(raw.lastIndexOf("."), raw.lastIndexOf(","));
    const decimals = last >= 0 ? raw.length - last - 1 : 0;
    const normalized =
      last >= 0 && decimals !== 3
        ? `${raw.slice(0, last).replace(/[.,]/g, "")}.${raw.slice(last + 1)}`
        : raw.replace(/[.,]/g, "");
    const value = Number(normalized);
    if (Number.isFinite(value)) values.add(Math.round(value * 100));
  }
  return values;
}

/** A pénzösszeg a sorban: a szám és a pénznem jele UGYANABBAN a sorban, egymás mellett. */
const CURRENCY = String.raw`HUF|Ft\.?|EUR|€|USD|\$|GBP|£`;
const AMOUNT = String.raw`\d{1,3}(?:[ \u00a0.,]\d{3})+(?:[.,]\d{1,4})?|\d+(?:[.,]\d{1,4})?`;
const MONEY = new RegExp(
  String.raw`(?:(${CURRENCY})[ \t\u00a0]*(${AMOUNT})(?![\d])|(?<![\d.,])(${AMOUNT})[ \t\u00a0]*(${CURRENCY}))`,
  "gu",
);
const CURRENCY_CODE: Record<string, string> = {
  "€": "EUR",
  Ft: "HUF",
  "Ft.": "HUF",
  $: "USD",
  "£": "GBP",
};

function amountValue(raw: string): number {
  const compact = raw.replace(/[ \u00a0]/g, "");
  const last = Math.max(compact.lastIndexOf("."), compact.lastIndexOf(","));
  const decimals = last >= 0 ? compact.length - last - 1 : 0;
  return Number(
    last >= 0 && decimals !== 3
      ? `${compact.slice(0, last).replace(/[.,]/g, "")}.${compact.slice(last + 1)}`
      : compact.replace(/[.,]/g, ""),
  );
}

/**
 * A SZÁMLA VÉGÖSSZEGE: a legnagyobb, pénznemmel jelölt összeg (acrobot 25691:
 * a végösszeg soha nem kisebb egy tételnél). Pénznem nélküli szám nem számít:
 * a Kia Charge számláján a „34,625 kWh” nagyobb lenne a végösszegnél.
 */
export function largestMoney(
  text: string,
): { cents: number; currency: string } | null {
  let best: { cents: number; currency: string } | null = null;
  for (const m of text.matchAll(MONEY)) {
    const symbol = (m[1] ?? m[4])!;
    const cents = Math.round(amountValue((m[2] ?? m[3])!) * 100);
    if (Number.isFinite(cents) && (!best || cents > best.cents))
      best = { cents, currency: CURRENCY_CODE[symbol] ?? symbol };
  }
  return best;
}

/** Legfeljebb `max` elemű, nem üres részhalmazok. */
function smallSubsets<T>(items: readonly T[], max: number): T[][] {
  const out: T[][] = [];
  const walk = (start: number, picked: T[]) => {
    if (picked.length) out.push(picked);
    if (picked.length === max) return;
    for (let i = start; i < items.length; i++)
      walk(i + 1, [...picked, items[i]!]);
  };
  walk(0, []);
  return out;
}

const DAY_MS = 86_400_000;
/** a számla kelte körül ennyi napon belül könyvelt fizetés illhet hozzá */
const SET_WINDOW = { before: 15, after: 45 };
const SET_MAX = 3;

export function cardPaymentMatch(
  lines: readonly string[],
  debits: readonly CardDebit[],
  distinctiveWord: (name: string) => string | null,
  /** a számla kelte, vagy ha az nincs meg, a levél érkezése (ÉÉÉÉ-HH-NN) */
  invoiceDate?: string,
): CardPaymentMatch | null {
  const text = lines.join("\n");
  const values = moneyValues(text);
  const matches: CardPaymentMatch[] = [];
  const partnerOf = (debit: CardDebit) => {
    const word = distinctiveWord(debit.counterpartyName);
    if (!word || OWN_NAME.test(word)) return null;
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<!\\p{L})${escaped}(?!\\p{L})`, "iu").test(text)
      ? word
      : null;
  };
  for (const debit of debits) {
    if (!partnerOf(debit)) continue;
    const amounts = [
      ...(debit.original ? [debit.original] : []),
      { amount: debit.amount, currency: debit.currency },
    ];
    const hit = amounts.find((a) =>
      values.has(Math.round(Number(a.amount) * 100)),
    );
    if (hit)
      matches.push({
        amount: hit.amount,
        currency: hit.currency,
        partner: debit.counterpartyName,
        debitIds: [debit.id],
      });
  }
  if (matches.length === 1) return matches[0]!;
  return invoiceDate
    ? cardPaymentSet(text, debits, partnerOf, invoiceDate)
    : null;
}

/**
 * MÁSODIK ÚT (acrobot 25691, Kia Charge): ha az első út nem talált egyértelmű
 * fizetést, a számla VÉGÖSSZEGÉHEZ (`largestMoney`) keresünk egy fizetést vagy
 * legfeljebb három fizetésből álló halmazt, ugyanattól a partnertől, a számla
 * kelte körül, aminek az összege centre egyezik. Csak egyértelmű halmaz számít:
 * ha két különböző is kiadja, nem döntünk.
 *
 *   Kia július: a havi díj (1518) egy másik hónap fizetése is, az első út
 *     kettőt talál; a végösszeg (9125) egy fizetés.
 *   Kia augusztus: 40 086 = 21 279 + 18 807, két fizetés.
 */
function cardPaymentSet(
  text: string,
  debits: readonly CardDebit[],
  partnerOf: (debit: CardDebit) => string | null,
  invoiceDate: string,
): CardPaymentMatch | null {
  const total = largestMoney(text);
  if (!total) return null;
  const day = Date.parse(`${invoiceDate}T00:00:00Z`);
  const byPartner = new Map<string, { debit: CardDebit; cents: number }[]>();
  for (const debit of debits) {
    const word = partnerOf(debit);
    if (!word) continue;
    const offset =
      (Date.parse(`${debit.bookingDate}T00:00:00Z`) - day) / DAY_MS;
    if (offset < -SET_WINDOW.before || offset > SET_WINDOW.after) continue;
    const amount = [
      ...(debit.original ? [debit.original] : []),
      { amount: debit.amount, currency: debit.currency },
    ].find((a) => a.currency === total.currency);
    if (!amount) continue;
    const list = byPartner.get(word) ?? [];
    list.push({ debit, cents: Math.round(Number(amount.amount) * 100) });
    byPartner.set(word, list);
  }
  const fits: { debit: CardDebit; cents: number }[][] = [];
  for (const list of byPartner.values())
    for (const set of smallSubsets(list.slice(0, 20), SET_MAX))
      if (set.reduce((sum, item) => sum + item.cents, 0) === total.cents)
        fits.push(set);
  if (fits.length !== 1) return null;
  const set = fits[0]!;
  return {
    amount: (total.cents / 100).toFixed(2),
    currency: total.currency,
    partner: set[0]!.debit.counterpartyName,
    debitIds: set.map((item) => item.debit.id),
  };
}
