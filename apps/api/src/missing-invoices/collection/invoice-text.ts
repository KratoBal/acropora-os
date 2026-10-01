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
  counterpartyName: string;
  /** a könyvelt összeg, a bankszámla pénznemében */
  amount: string;
  currency: string;
  /** a közlemény eredeti devizás összege (`originalAmountOf`), ha van */
  original: { amount: string; currency: string } | null;
}

export interface CardPaymentMatch {
  amount: string;
  currency: string;
  partner: string;
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

/** Egy számlaszám alakja: betűvel vagy számmal kezdődik, legalább 3 jel. */
const NUMBER_TOKEN = /^[#:.\s]*([A-Za-z0-9][A-Za-z0-9\-/_.]{2,39})/;

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

function labelledValue(lines: readonly string[], label: string): string | null {
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i]!.toLowerCase();
    let at = lower.indexOf(label);
    // a címke önálló szó legyen: a „bankszámlaszám” nem „számlaszám”
    while (at > 0 && /\p{L}/u.test(lower[at - 1]!))
      at = lower.indexOf(label, at + 1);
    if (at < 0) continue;
    const rest = lines[i]!.slice(at + label.length);
    const sameLine = usable(NUMBER_TOKEN.exec(rest)?.[1]);
    if (sameLine) return sameLine;
    // a címke alatti sorban áll az érték (táblázatos fejléc)
    const next = usable(NUMBER_TOKEN.exec(lines[i + 1] ?? "")?.[1]);
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
    .filter((n) => !BANK_ACCOUNT.test(n))
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
          (word.match(/\d/g) ?? []).length >= 5,
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
  /(?<!\p{L})(díjbekérő|dijbekero|előlegbekérő|proforma|pro forma|pro-forma)(?!\p{L})/iu;

export function looksLikeProforma(text: string): boolean {
  return PROFORMA_WORD.test(text);
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
  const taxNumbers = [...text.matchAll(TAX_NUMBER)]
    .map((m) => m[1] as string)
    .filter((tax) => taxBase(tax) !== ours);
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

export function cardPaymentMatch(
  lines: readonly string[],
  debits: readonly CardDebit[],
  distinctiveWord: (name: string) => string | null,
): CardPaymentMatch | null {
  const text = lines.join("\n");
  const values = moneyValues(text);
  const matches: CardPaymentMatch[] = [];
  for (const debit of debits) {
    const word = distinctiveWord(debit.counterpartyName);
    if (!word || OWN_NAME.test(word)) continue;
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`(?<!\\p{L})${escaped}(?!\\p{L})`, "iu").test(text))
      continue;
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
      });
  }
  return matches.length === 1 ? matches[0]! : null;
}
