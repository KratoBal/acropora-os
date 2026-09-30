/**
 * EGY BANKI TERHELÉS BESOROLÁSA (Hiányzó számlák). A szabályok és a sorrendjük
 * barracuda méréséből jönnek (`exchange/havi-elszamolas/parositas-szabalyok.md`
 * 2. pont, `agents/barracuda/havi-elszamolas/terhelesek.py`), két kiegészítéssel:
 * a kölcsön-visszafizetés Nem kell számla (acrobot 25265 d), és a kézi döntés
 * helye a felület (brief 17. pont), nem egy névlista a kódban.
 *
 * A SORREND KÉT MÉRT HIBÁT VÉD KI:
 * - az adó a biztosítás ELŐTT fut, mert a „Társadalombiztosítási járulék”
 *   tartalmazza a „biztosítás” szót;
 * - a HU IBAN a devizás átutalás ELŐTT dönt, mert a DHL Freight Magyarország
 *   EUR-ban, de hazai számlára kapta az utalást.
 *
 * TISZTA FÜGGVÉNY. A kategória nem tárolódik: olvasáskor számoljuk, így egy
 * szabály javítása migráció nélkül minden hónapra hat.
 */

export const BANK_CATEGORIES = [
  "INTERNAL_TRANSFER",
  "BANK_FEE",
  "TAX",
  "PAYROLL",
  "LOAN",
  "INSURANCE",
  "CARD_SUBSCRIPTION",
  "FOREIGN_SUPPLIER",
  "DOMESTIC_SUPPLIER",
  "UNCERTAIN",
] as const;
export type BankCategory = (typeof BANK_CATEGORIES)[number];

/** A „Nem kell számla” kategóriák (brief 4. pont, acrobot d). */
export const NO_INVOICE_CATEGORIES: ReadonlySet<BankCategory> = new Set([
  "INTERNAL_TRANSFER",
  "BANK_FEE",
  "TAX",
  "PAYROLL",
  "LOAN",
]);

export interface ClassifiableTransaction {
  counterpartyAccount: string | null;
  counterpartyName: string | null;
  narrative: string;
  transactionType: string | null;
}

export interface Classification {
  category: BankCategory;
  /** A döntő szabály, emberi mondatban: a felület és a hiánylista kiírja. */
  rule: string;
}

const SUBSCRIPTIONS =
  /openai|chatgpt|anthropic|claude|tesla|google|apple|microsoft|adobe|canva|figma|github|amazon|aws|hetzner|digitalocean|netflix|spotify|zoom|slack|notion|dropbox|meta|facebook|linkedin|shopify|cloudflare|openrouter|elevenlabs|midjourney|atlassian|jetbrains|coolify/i;
const FOREIGN_COMPANY =
  /\b(gmbh|ltd|limited|inc|llc|b\.?v\.?|s\.?r\.?l|s\.?a\.?s|sas|doo|d\.o\.o|ag|sp\.? z|oy|ab|s\.?p\.?a|e\.?k)\b/i;
const DOMESTIC_COMPANY =
  /\b(kft|zrt|nyrt|bt|kkt|e\.?v|egyesület|alapítvány|szövetkezet|intézet|hivatal)\b\.?/i;
const TAX =
  /\bnav\b|nemzeti ad[óo]|ad[óo]hivatal|önkormányzat|onkormanyzat|iparűz|iparuz|illeték|illetek|vám|vam|járulék|jarulek|szja|áfa\b|afa\b|magyar államkincstár|kincstár/i;
const BANK_FEE =
  /költség|koltseg|díj|dij|jutalék|jutalek|különdíj|zárlati|zarlati|kamat/i;
const PAYROLL = /munkab[ée]r|\bb[ée]r\b|fizet[ée]s\b|el[őo]leg/i;
const LOAN = /kölcsön|kolcson/i;
const INSURANCE = /biztos[íi]t[áa]s|allianz|generali|groupama|uniqa/i;

export function classifyTransaction(
  transaction: ClassifiableTransaction,
  context: {
    ownAccounts: ReadonlySet<string>;
    payrollNames: ReadonlySet<string>;
  },
): Classification {
  const account = (transaction.counterpartyAccount ?? "").trim();
  const name = (transaction.counterpartyName ?? "").trim();
  const type = (transaction.transactionType ?? "").trim();
  // "-APPLE" az Apple Pay jele egy kártyás fizetésen, nem Apple-előfizetés
  // (az első futás emiatt 7 kártyás vásárlást sorolt előfizetésnek)
  const narrative = transaction.narrative.replace(/-APPLE\b/g, " ");
  const text = `${name} ${narrative}`;
  const card = /KÁRTY/i.test(type);

  if (TAX.test(text))
    return { category: "TAX", rule: "adó, járulék vagy hatóság" };
  if (INSURANCE.test(`${type} ${name}`))
    return { category: "INSURANCE", rule: "biztosító vagy biztosítási díj" };
  if (
    context.ownAccounts.has(account.replace(/[\s-]/g, "")) ||
    /AZONOS ÜGYFÉL/i.test(type) ||
    /acropora/i.test(name)
  )
    return {
      category: "INTERNAL_TRANSFER",
      rule: "saját számla vagy Acropora név",
    };
  if (!name && BANK_FEE.test(type))
    return { category: "BANK_FEE", rule: `banki tétel: ${type}` };
  if (LOAN.test(narrative))
    return { category: "LOAN", rule: "kölcsön a közleményben" };
  if (PAYROLL.test(narrative))
    return { category: "PAYROLL", rule: "munkabér a közleményben" };
  if (card) {
    if (SUBSCRIPTIONS.test(text))
      return {
        category: "CARD_SUBSCRIPTION",
        rule: "ismert előfizetés kártyával",
      };
    if (FOREIGN_COMPANY.test(name) || /(\d|\b)(EUR|USD|GBP)\b/.test(narrative))
      return {
        category: "FOREIGN_SUPPLIER",
        rule: "kártya, külföldi cégforma vagy devizaösszeg",
      };
    return {
      category: "DOMESTIC_SUPPLIER",
      rule: "kártya, egyéb (várhatóan hazai)",
    };
  }
  if (BANK_FEE.test(type) && name)
    return { category: "BANK_FEE", rule: `banki tétel partnerrel: ${type}` };
  if (/^[A-Z]{2}\d/.test(account) && !account.startsWith("HU"))
    return {
      category: "FOREIGN_SUPPLIER",
      rule: `külföldi IBAN (${account.slice(0, 2)})`,
    };
  if (/\bHU\d{2}\d{8,}/.test(narrative) || DOMESTIC_COMPANY.test(name))
    return {
      category: "DOMESTIC_SUPPLIER",
      rule: "hazai cégforma vagy HU IBAN (deviza-átutalásnál is)",
    };
  if (FOREIGN_COMPANY.test(name) || /DEVIZA/i.test(type))
    return {
      category: "FOREIGN_SUPPLIER",
      rule: "külföldi cégforma vagy deviza-átutalás",
    };
  if (SUBSCRIPTIONS.test(text))
    return {
      category: "CARD_SUBSCRIPTION",
      rule: "ismert előfizetés (nem kártya)",
    };
  // Ugyanaz a személy más hónapban munkabért kapott: BECSLÉS, és ezt mondja is
  if (name && context.payrollNames.has(name))
    return {
      category: "PAYROLL",
      rule: "becslés: ugyanez a személy más hónapban munkabért kapott",
    };
  return { category: "UNCERTAIN", rule: "nincs szabály, kézi döntés kell" };
}

/** A munkabér-következtetés alapja: akiknek bármelyik sorában „munkabér” áll. */
export function payrollNamesOf(
  transactions: readonly ClassifiableTransaction[],
): Set<string> {
  return new Set(
    transactions.flatMap((transaction) =>
      transaction.counterpartyName && PAYROLL.test(transaction.narrative)
        ? [transaction.counterpartyName.trim()]
        : [],
    ),
  );
}
