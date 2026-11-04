/**
 * MIKOR KELL A VEVŐNEK ADÓSZÁM (kártya aaf4f09d; Balázs, 2026-11-04 11:43-12:23
 * UTC: „Az összes számlánk, ami az állatkertnek ment ki a rendszerből, adószám
 * nélkül ment ki", „Én azt szeretném, hogy soha többet ne fordulhasson elő ilyen",
 * „Az állatkertnél nincs se kft se bt se rt"; acrobot 42297).
 *
 * A SZABÁLY, FORDÍTOTT ALAPÉRTELMEZÉSSEL: adószám (magyar vagy közösségi) KELL,
 * HACSAK a vevő nincs kifejezetten magánszemélynek jelölve. Az üres vagy
 * ismeretlen típus nem magánszemély. A partnerhez kötött vevő (a Partnerek
 * képernyőről jövő vevő-tükör) MINDIG adószámot kér: partner nem lehet
 * magánszemély, a típusa itt nem számít. A cégforma a névben (Kft, Zrt, Bt, ...)
 * csak kiegészítő jel a magánszemélynek jelölt rekordra: ha ott áll, mégis kell
 * adószám. Az állatkert intézmény, a nevében nincs cégforma, ezért a fő szabály a
 * típus, nem a név.
 *
 * EGY HELYEN, KÉT OLDALRA: a szabály itt áll, hogy a felület (a kiállítás gombja
 * melletti ok) és az API ugyanazt mondja. Az XML-építő (`buildSzamlazzAgentInvoiceXml`) ezzel áll meg, és azon
 * megy át minden számla a Számlázz.hu felé; a szolgáltatások ugyanezzel szólnak
 * korábban, érthető hibával. A napi ellenőrző lekérdezés
 * (`packages/database/prisma/diagnostics/ceges-szamla-adoszam-nelkul.sql`) ugyanezt a szabályt és
 * ugyanezt a cégforma-listát használja; egy spec méri, hogy a kettő együtt mozog.
 */

/** A vevő, amennyi a döntéshez kell. */
export interface BuyerTaxSubject {
  name: string;
  /** a vevő típusa (`PERSON` | `COMPANY`); hiányzik vagy ismeretlen: nem magánszemély */
  type: string | null | undefined;
  /** a vevő egy partner vevő-tükre (`Supplier.customerId`) */
  partnerMirror: boolean;
  taxNumber?: string | null;
  euTaxNumber?: string | null;
  /**
   * A névvel egyező partner adószáma (Partnerek oldal), ha a vevő-sornak nincs: honnan
   * másolja a kezelő. Csak tipp az okban, az adatot semmi nem írja át (kártya aaf4f09d;
   * Luca, 2026-11-04 13:53 UTC: a régi vevő-sort választotta, a tükör nem választható).
   */
  partnerHint?: PartnerTaxHint | null;
}

/** A névvel egyező partner, akinél az adószám megvan. */
export interface PartnerTaxHint {
  partnerName: string;
  taxNumber: string;
}

/**
 * A CÉGFORMÁK ÉS SZERVEZETI JELÖLÉSEK, egész szóként, kis- és nagybetű nélkül.
 * Ugyanez a lista áll az SQL-ellenőrzésben (a spec méri).
 */
export const ORGANIZATION_NAME_MARKERS = [
  "kft",
  "zrt",
  "nyrt",
  "rt",
  "bt",
  "kkt",
  "kht",
  "nonprofit",
  "ev",
  "e\\.v",
  "egyéni vállalkozó",
  "alapítvány",
  "egyesület",
  "önkormányzat",
  "gmbh",
  "ltd",
  "s\\.r\\.o",
] as const;

const ORGANIZATION_NAME = new RegExp(
  `(^|[^\\p{L}\\p{N}])(${ORGANIZATION_NAME_MARKERS.join("|")})\\.?($|[^\\p{L}\\p{N}])`,
  "iu",
);

export function looksLikeOrganization(name: string): boolean {
  return ORGANIZATION_NAME.test(name);
}

/** Kell-e adószám a vevőnek (a fenti szabály). */
export function buyerNeedsTaxNumber(buyer: BuyerTaxSubject): boolean {
  if (buyer.partnerMirror) return true;
  if (buyer.type !== "PERSON") return true;
  return looksLikeOrganization(buyer.name);
}

/** A kezelőnek szóló ok, vagy `null`, ha nincs akadály. */
export function buyerTaxNumberProblem(buyer: BuyerTaxSubject): string | null {
  if (buyer.taxNumber?.trim() || buyer.euTaxNumber?.trim()) return null;
  if (!buyerNeedsTaxNumber(buyer)) return null;
  const why = buyer.partnerMirror
    ? "partner"
    : buyer.type === "PERSON"
      ? "a neve cégformát visel"
      : "nincs magánszemélynek jelölve";
  const base = `A vevőnek nincs adószáma: ${buyer.name} (${why}), de sem magyar, sem közösségi adószám nincs megadva. Egészítsd ki a partnernél vagy a vevőnél; adószám nélkül csak kifejezetten magánszemélynek jelölt vevőnek állítunk ki számlát.`;
  return buyer.partnerHint
    ? `${base} A Partnerek között ${buyer.partnerHint.partnerName} a(z) ${buyer.partnerHint.taxNumber} adószámmal szerepel: ha ez ugyanaz a cég, írd be a vevő adatlapján.`
    : base;
}
