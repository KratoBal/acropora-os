import {
  INCOMING_READING_FIELDS,
  type IncomingReadingField,
  type IncomingReadingSource,
  type IncomingReadingValues,
} from "@acropora/types";

import { hungarianTaxBase } from "../../purchasing/nav-incoming-invoices/nav-incoming-invoice.types.js";

/**
 * AUTOMATIKUS JÓVÁHAGYÁS: AMIKOR EGY „ELLENŐRIZENDŐ” OLVASATOT NEM KELL EMBERNEK
 * VÉGIGKATTINTANIA (Balázs, 2026-10-21: „most jelenleg 39 számlát kellene kézzel
 * jóváhagynom ... vannak benne olyanok, amikkel nincs gond”; acrobot 34633, és
 * Balázs 14:19 UTC „2 mehet”, 34636).
 *
 * KÉT ALAP, és mindkettőnél egy FÜGGETLEN forrás erősíti meg a számlát; egy
 * gyanús vagy hiányzó adat nem jóváhagyás, hanem kihagyás, megnevezett okkal:
 *
 *   NAV        magyar szállító: a NAV-ban ugyanez a szám ugyanazzal az
 *              adószám-törzzsel áll, és a bruttója egyezik (ha az olvasat
 *              tud bruttót). A hiányzó mezőket a NAV-adat tölti ki, „NAV”
 *              forrásjellel; egy kiolvasott, de a NAV-tól eltérő összeg kihagyás.
 *   BANK       minden más (külföldi szállító): minden kötelező mező kiolvasva,
 *              a bruttó NEM a párosításból jön (az önmagához mérés lenne), és
 *              a párosított terhelések összege pontosan a bruttó: a számla
 *              devizájában, vagy a bank által közölt eredeti összegben (a
 *              közlemény „1.703,08 EUR” része), ha a terhelés forintos.
 */

/** Amit a NAV egy bejövő számláról tud (`NavIncomingInvoice`). */
export interface NavConfirmation {
  navInvoiceNumber: string;
  supplierTaxNumber: string;
  supplierName: string;
  invoiceIssueDate: string;
  invoiceDeliveryDate: string | null;
  currency: string;
  netAmount: string | null;
  vatAmount: string | null;
  /** CREATE, MODIFY vagy STORNO: a módosítás és a storno az eredeti számra hivatkozik */
  operation: "CREATE" | "MODIFY" | "STORNO";
  originalInvoiceNumber: string | null;
}

export interface AutoApprovalDebit {
  amount: string;
  currency: string;
  /** a bank által közölt eredeti összeg és deviza, ha a terhelés átváltott */
  original?: { amount: string; currency: string } | null;
}

export type AutoApproval =
  | {
      approve: true;
      basis: "NAV" | "BANK";
      values: IncomingReadingValues;
      sources: Partial<Record<IncomingReadingField, IncomingReadingSource>>;
    }
  | { approve: false; reason: string };

const MONEY_TOLERANCE = 0.02;
const HUF_TOLERANCE = 1;

const numberKey = (value: string) => value.replace(/\s/g, "").toUpperCase();
const money = (value: string | null) => (value === null ? null : Number(value));
const fixed = (value: number) => value.toFixed(2);

export function autoApproval(input: {
  values: IncomingReadingValues;
  /** a párosított dokumentum fajtája (`DocumentPairing.kind`) */
  kind: string;
  sources: Partial<Record<IncomingReadingField, IncomingReadingSource>>;
  debits: readonly AutoApprovalDebit[];
  /** a NAV-sorok ugyanezzel a számmal (bármilyen szállítóé: a szűrés itt történik) */
  nav: readonly NavConfirmation[];
  /** a kézi jóváhagyás ellenőrzése (`approvalProblems`): ugyanaz a mérce, nem egy második */
  problems: (values: IncomingReadingValues) => string[];
}): AutoApproval {
  const { values, sources } = input;
  /*
    CSAK SZÁMLA (barracuda #1790): egy díjbekérő minden mezője kiolvasható, és
    előre fizetésnél a terhelés pontosan annyi; jóváhagyva a végszámla mellett
    kétszer kerülne a könyvekbe. A lista (`mailboxOnlyPairings`) ma is csak
    INVOICE párosítást ad ide; ez a sor a döntés saját feltétele, nem egy
    másik helyen álló szűrőé.
  */
  if (input.kind !== "INVOICE")
    return { approve: false, reason: "díjbekérő vagy nem számla: kézi döntés" };
  const base =
    hungarianTaxBase(values.supplierTaxNumber) ??
    hungarianTaxBase(values.supplierEuTaxNumber);
  if (base) return byNav(values, sources, base, input.nav, input.problems);
  // the bank basis is for a FOREIGN supplier only (Balázs, 34636): a row with no tax number at all is no proof of
  // anything, and a Hungarian invoice whose tax number was not read waits for a person or for the NAV
  if (!values.supplierEuTaxNumber?.trim())
    return {
      approve: false,
      reason:
        "nincs adószám: sem magyar (NAV), sem külföldi (banki) alapon nem hagyható jóvá",
    };
  return byBank(values, sources, input.debits, input.problems);
}

/*
  A SZÁLLÍTÓNÉV A NAV-VAL (barracuda #1796/#1798, acrobot 34865). A NAV-egyezést a számlaszám és az adószám-törzs
  adja; a név harmadik, független kulcs. Az olvasó a nevet a PDF szövegéből is kiolvassa (első sor, "Eladó"
  cella), és egy rossz név addig a NAV-nál MARADT és jóváhagyódott, mert a NAV csak a hiányt töltötte. Mostantól:
  ha a kiolvasott név a NAV-étól ÉRDEMBEN eltér, a sor nem megy magától, az átnézésre marad; ha egyezik, a név
  a NAV-é lesz ("NAV" forrásjellel): a NAV a hivatalos alak.
  "Érdemben": ékezet-, kis/nagybetű- és írásjel-független szavak, a cégforma-szavak (Kft., Zrt., Korlátolt
  Felelősségű Társaság, GmbH, ...) nélkül; azonos, vagy az egyik a másik része (Elektro-Light / Elektro-Light
  Magyarország). Üres szó-halmaz nem egyezik.
*/
const LEGAL_WORDS = new Set([
  "kft",
  "zrt",
  "nyrt",
  "bt",
  "kkt",
  "rt",
  "ev",
  "gmbh",
  "ag",
  "ltd",
  "limited",
  "inc",
  "llc",
  "bv",
  "sarl",
  "srl",
  "oy",
  "korlatolt",
  "felelossegu",
  "tarsasag",
  "zartkoruen",
  "mukodo",
  "reszvenytarsasag",
  "betei",
  "kozkereseti",
  "egyeni",
  "vallalkozo",
]);

function nameWords(name: string): Set<string> {
  const folded = name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return new Set(
    (folded.match(/[\p{L}\p{N}]+/gu) ?? []).filter(
      (word) => !LEGAL_WORDS.has(word),
    ),
  );
}

/** Egyezik-e két szállítónév érdemben (lásd fent). */
export function sameSupplierName(read: string, nav: string): boolean {
  const a = nameWords(read);
  const b = nameWords(nav);
  if (a.size === 0 || b.size === 0) return false;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  return [...small].every((word) => large.has(word));
}

function byNav(
  values: IncomingReadingValues,
  sources: Partial<Record<IncomingReadingField, IncomingReadingSource>>,
  base: string,
  nav: readonly NavConfirmation[],
  approvalProblems: (values: IncomingReadingValues) => string[],
): AutoApproval {
  if (!values.documentNumber)
    return { approve: false, reason: "nincs számlaszám" };
  const number = numberKey(values.documentNumber);
  const sameSupplier = nav.filter(
    (row) => hungarianTaxBase(row.supplierTaxNumber) === base,
  );
  /*
    A MÓDOSÍTOTT VAGY SZTORNÓZOTT SZÁMLA NEM MEGY MAGÁTÓL (barracuda #1790): a
    CREATE sor a módosítás után is ott áll, tehát egy sztornózott számla
    jóváhagyódna, vagy az üres összeg a módosítás ELŐTTI értékkel töltődne.
    A módosító és a sztornó számla az eredetire az `originalInvoiceNumber`
    mezőben hivatkozik.
  */
  if (
    sameSupplier.some(
      (row) =>
        row.operation !== "CREATE" &&
        numberKey(row.originalInvoiceNumber ?? "") === number,
    )
  )
    return {
      approve: false,
      reason: "a NAV-ban módosítás vagy sztornó hivatkozik rá: kézi döntés",
    };
  const rows = sameSupplier.filter(
    (row) =>
      row.operation === "CREATE" && numberKey(row.navInvoiceNumber) === number,
  );
  if (rows.length === 0)
    return {
      approve: false,
      reason: "a NAV-ban nincs ilyen számú számla ettől a szállítótól",
    };
  if (rows.length > 1)
    return { approve: false, reason: "a NAV-ban több ilyen számú számla áll" };
  const row = rows[0]!;
  if (row.netAmount === null || row.vatAmount === null)
    return { approve: false, reason: "a NAV-sorban nincs nettó vagy ÁFA" };
  const navNet = Number(row.netAmount);
  const navVat = Number(row.vatAmount);
  const navGross = navNet + navVat;
  const tolerance =
    row.currency.toUpperCase() === "HUF" ? HUF_TOLERANCE : MONEY_TOLERANCE;
  if (
    values.currency &&
    values.currency.toUpperCase() !== row.currency.toUpperCase()
  )
    return {
      approve: false,
      reason: `a deviza eltér a NAV-tól (${values.currency} és ${row.currency})`,
    };
  for (const [field, read, navValue] of [
    ["bruttó", money(values.grossAmount), navGross],
    ["nettó", money(values.netAmount), navNet],
    ["ÁFA", money(values.vatAmount), navVat],
  ] as const)
    if (read !== null && Math.abs(read - navValue) > tolerance)
      return {
        approve: false,
        reason: `a kiolvasott ${field} (${fixed(read)}) eltér a NAV-tól (${fixed(navValue)})`,
      };

  if (
    values.supplierName &&
    !sameSupplierName(values.supplierName, row.supplierName)
  )
    return {
      approve: false,
      reason: `a kiolvasott szállítónév („${values.supplierName.slice(0, 60)}”) eltér a NAV-tól („${row.supplierName.slice(0, 60)}”): kézi döntés`,
    };

  const filled: IncomingReadingValues = { ...values };
  const filledSources = { ...sources };
  // egyezésnél a név a NAV-é (hivatalos alak, "NAV" forrásjellel)
  if (filled.supplierName) {
    filled.supplierName = row.supplierName;
    filledSources.supplierName = "NAV";
  }
  const fill = <K extends IncomingReadingField>(
    field: K,
    value: IncomingReadingValues[K],
  ) => {
    if (filled[field] !== null || value === null) return;
    filled[field] = value;
    filledSources[field] = "NAV";
  };
  fill("supplierName", row.supplierName);
  fill("issueDate", row.invoiceIssueDate);
  fill("fulfillmentDate", row.invoiceDeliveryDate);
  fill("currency", row.currency.toUpperCase());
  fill("netAmount", fixed(navNet));
  fill("vatAmount", fixed(navVat));
  fill("grossAmount", fixed(navGross));
  const problems = approvalProblems(filled);
  if (problems.length) return { approve: false, reason: problems.join(" ") };
  return {
    approve: true,
    basis: "NAV",
    values: filled,
    sources: filledSources,
  };
}

function byBank(
  values: IncomingReadingValues,
  sources: Partial<Record<IncomingReadingField, IncomingReadingSource>>,
  debits: readonly AutoApprovalDebit[],
  approvalProblems: (values: IncomingReadingValues) => string[],
): AutoApproval {
  const problems = approvalProblems(values);
  if (problems.length) return { approve: false, reason: problems.join(" ") };
  if (sources.grossAmount === "PAIRING")
    return {
      approve: false,
      reason:
        "a bruttó a banki párosításból jön, nem a számláról: önmagához mérné",
    };
  if (debits.length === 0)
    return { approve: false, reason: "nincs párosított terhelés" };
  const currency = values.currency!.toUpperCase();
  const gross = Number(values.grossAmount);
  const paid = debits.map((debit) =>
    debit.currency.toUpperCase() === currency
      ? Math.abs(Number(debit.amount))
      : debit.original && debit.original.currency.toUpperCase() === currency
        ? Math.abs(Number(debit.original.amount))
        : null,
  );
  if (paid.some((amount) => amount === null))
    return {
      approve: false,
      reason: `a terhelés devizája nem ${currency}, és a bank nem közölt ${currency} összeget`,
    };
  const sum = paid.reduce<number>((total, amount) => total + amount!, 0);
  const tolerance = currency === "HUF" ? HUF_TOLERANCE : MONEY_TOLERANCE;
  if (Math.abs(sum - gross) > tolerance)
    return {
      approve: false,
      reason: `a terhelés (${fixed(sum)} ${currency}) nem egyezik a bruttóval (${fixed(gross)} ${currency})`,
    };
  return { approve: true, basis: "BANK", values, sources };
}

/** A mezők, amelyeket az automatikus jóváhagyás a NAV-ból töltött (a naplóba). */
export function navFilledFields(
  sources: Partial<Record<IncomingReadingField, IncomingReadingSource>>,
): IncomingReadingField[] {
  return INCOMING_READING_FIELDS.filter((field) => sources[field] === "NAV");
}
