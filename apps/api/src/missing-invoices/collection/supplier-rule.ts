import { GENERIC_SIGN_WORDS, senderDomain } from "./invoice-corroboration.js";

/**
 * AZ ISMERT SZÁLLÍTÓ SZABÁLYA (PDF-javaslatok 2. útja; acrobot 57881, 2026-11-20). A 144 függő PDF élő mérése szerint a
 * NAV-szám út nem működik (118 szám a NAV-ban nincs, külföldi és online szolgáltatók), ezért a döntés szállító-szintű: EGY
 * ember által elfogadott dokumentum szabályt hoz létre, és a szállító következő PDF-jét a rendszer magától elfogadja.
 *
 * KÉT KULCS. `TAX`: a PDF-ből kiolvasott szállítói adószám/EU-adószám, normalizálva. `NAME`: a szállító jellemző neve a PDF
 * szövegében (azokhoz, ahol nincs adószám: mérve 62 a 144-ből); ez szigorúbb, mert a nevet a PDF-be bárki beírhatja.
 *
 * A FELADÓ A KULCS MELLÉ KELL, külső feladónál: a szabály létrehozásakor megjegyzett tartomány. A saját továbbítóink (a
 * begyűjtött postafiókok tartománya) megbízott csatorna: TAX kulcsnál a feladó nem kulcs; NAME kulcsnál a továbbító NEM elég.
 *
 * A KIUGRÓ ÖSSZEG EMBERRE MARAD: egy ismert pénznemben az összeg legfeljebb az eddig elfogadott legnagyobb háromszorosa;
 * új pénznem vagy kiugró összeg esetén a PDF emberre vár. Egy olvashatatlan összegnél a döntés beállítás (alapból: ember).
 *
 * A JEL NEM HITELESÍT: aki egy szállító adószámát és tartományát ismeri, hamis PDF-et küldhet. A hatás szűk (a PDF tárolt
 * dokumentum lesz, kifizetést nem indít), és minden elfogadás naplózott és visszavonható.
 */
export type SupplierRuleKind = "TAX" | "NAME";

export interface SupplierRule {
  id: string;
  kind: SupplierRuleKind;
  /** TAX: `taxMatchKey` */
  taxKey: string | null;
  /** NAME: a jellemző szavak, szóközzel (`nameKeyOf`) */
  nameKey: string | null;
  /** a feladó tartománya (`senderDomain` alakban), vagy null, ha a szabály egy megbízott továbbítótól jött (csak TAX) */
  senderDomain: string | null;
  /** pénznemenként a legnagyobb elfogadott bruttó, centben */
  grossCeilings: Readonly<Record<string, number>>;
}

/** Az összeg legfeljebb ennyiszerese lehet az eddig elfogadott legnagyobbnak. */
export const OUTLIER_FACTOR = 3;

/**
 * Az adószám összehasonlító alakja: nagybetű, csak betű és számjegy; a magyar adószám (`12345678-2-42`, `HU12345678`) a
 * törzsszámra (8 jegy) egyszerűsödik, mert a számlán a teljes és a rövid alak is áll. Túl rövid érték nem kulcs.
 */
export function taxMatchKey(raw: string | null | undefined): string | null {
  const compact = (raw ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  const hungarian = /^(?:HU)?(\d{8})(?:\d{3})?$/.exec(compact);
  if (hungarian) return `HU${hungarian[1]}`;
  return compact.length >= 8 ? compact : null;
}

/**
 * A szállító jellemző szavai (legfeljebb kettő) a beírt névből; üres, ha nincs olyan szó, ami azonosít. A szó legalább HÁROM
 * betűs (a `nameSigns` négyet kér, de ott a szállítónevet a NAV adja): a GLS tipikus eset, a "General Logistics Systems"
 * szavai mind általánosak, a rövidítés az egyetlen azonosító, és az embert beírja, a szerver a PDF szövegében ellenőrzi.
 */
export function nameKeyOf(
  name: string,
  normalizeName: (value: string) => string,
): string | null {
  const words = normalizeName(name)
    .split(" ")
    .filter((word) => word.length >= 3 && !GENERIC_SIGN_WORDS.has(word))
    .slice(0, 2);
  return words.length > 0 ? words.join(" ") : null;
}

/** Whether the document text holds every key word as a whole word. */
export function textHasNameKey(
  text: string,
  nameKey: string,
  normalizeName: (value: string) => string,
): boolean {
  const words = new Set(normalizeName(text).split(" "));
  return nameKey.split(" ").every((word) => words.has(word));
}

/** A begyűjtött postafiókok tartománya és a beállított további megbízott tartományok (`senderDomain` alakban). */
export function trustedForwarderDomains(
  mailboxUsers: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const extra = (environment.INVOICE_SUPPLIER_RULE_TRUSTED_DOMAINS ?? "")
    .split(",")
    .map((value) =>
      value
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, ""),
    )
    .filter(Boolean);
  const own = mailboxUsers
    .map((user) => senderDomain(user))
    .filter((value): value is string => Boolean(value));
  return [...new Set([...own, ...extra])];
}

/** A szabályok kapcsolója: `live` fut; bármi más vagy hiányzó érték: KI (az elfogadás emberre marad). */
export function supplierRulesLive(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.INVOICE_SUPPLIER_RULES?.trim() === "live";
}

/** Az összeg nélküli PDF: alapból emberre marad; `accept` esetén "összeg nélkül" jelöléssel elfogadódik. */
export function amountlessAccepted(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.INVOICE_SUPPLIER_RULES_AMOUNTLESS?.trim() === "accept";
}

export interface RuleDocument {
  /** a PDF-ből kiolvasott szállítói adószám, ahogy áll */
  taxNumber: string | null;
  /** a feladó `senderDomain` alakban, vagy null */
  senderDomain: string | null;
  /** a PDF szövege */
  text: string;
  /** a bruttó, előjellel, ahogy a `textReading.gross` */
  gross: string | null;
  currency: string | null;
  payee: string;
}

export type RuleRefusal =
  | "NO_RULE"
  | "NOT_COMPANY"
  | "SENDER_MISMATCH"
  | "UNTRUSTED_NAME_SENDER"
  | "NEW_CURRENCY"
  | "OUTLIER"
  | "NO_AMOUNT";

export type RuleDecision =
  | {
      accept: true;
      rule: SupplierRule;
      /** az összeg cent, vagy null: nem olvasható, a beállítás szerint elfogadva */
      grossCents: number | null;
      currency: string | null;
    }
  | { accept: false; reason: RuleRefusal; rule?: SupplierRule };

/** Egy pénzösszeg szövegből centbe (`-1234.50`, `1234,5`); null, ha nem olvasható. */
export function grossCentsOf(value: string | null): number | null {
  if (value === null) return null;
  const match = /^-?(\d+)(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || 0);
}

export function decideSupplierRule(input: {
  rules: readonly SupplierRule[];
  document: RuleDocument;
  trustedDomains: readonly string[];
  normalizeName: (value: string) => string;
  amountless: boolean;
}): RuleDecision {
  const { document, rules, trustedDomains } = input;
  if (document.payee === "NOT_COMPANY")
    return { accept: false, reason: "NOT_COMPANY" };
  const taxKey = taxMatchKey(document.taxNumber);
  const trusted =
    document.senderDomain !== null &&
    trustedDomains.includes(document.senderDomain);
  let refusal: RuleDecision = { accept: false, reason: "NO_RULE" };
  for (const rule of rules) {
    if (rule.kind === "TAX") {
      if (!taxKey || rule.taxKey !== taxKey) continue;
      // a rule from a trusted forwarder has no sender; an external one needs its sender
      if (
        rule.senderDomain !== null &&
        !trusted &&
        rule.senderDomain !== document.senderDomain
      ) {
        refusal = { accept: false, reason: "SENDER_MISMATCH", rule };
        continue;
      }
    } else {
      if (
        !rule.nameKey ||
        !textHasNameKey(document.text, rule.nameKey, input.normalizeName)
      )
        continue;
      // a name alone is no key: it needs the rule's external sender (a forwarder is not enough)
      if (
        rule.senderDomain === null ||
        document.senderDomain !== rule.senderDomain
      ) {
        refusal = {
          accept: false,
          reason: trusted ? "UNTRUSTED_NAME_SENDER" : "SENDER_MISMATCH",
          rule,
        };
        continue;
      }
    }
    const cents = grossCentsOf(document.gross);
    const currency = document.currency;
    if (cents === null || !currency) {
      if (!input.amountless) {
        refusal = { accept: false, reason: "NO_AMOUNT", rule };
        continue;
      }
      return {
        accept: true,
        rule,
        grossCents: null,
        currency: currency ?? null,
      };
    }
    const ceiling = rule.grossCeilings[currency];
    if (ceiling === undefined) {
      refusal = { accept: false, reason: "NEW_CURRENCY", rule };
      continue;
    }
    if (Math.abs(cents) > ceiling * OUTLIER_FACTOR) {
      refusal = { accept: false, reason: "OUTLIER", rule };
      continue;
    }
    return { accept: true, rule, grossCents: Math.abs(cents), currency };
  }
  return refusal;
}

/** A szabály legnagyobb elfogadott összege az új elfogadás után. */
export function raisedCeilings(
  ceilings: Readonly<Record<string, number>>,
  currency: string | null,
  grossCents: number | null,
): Record<string, number> {
  if (!currency || grossCents === null) return { ...ceilings };
  return {
    ...ceilings,
    [currency]: Math.max(ceilings[currency] ?? 0, Math.abs(grossCents)),
  };
}
