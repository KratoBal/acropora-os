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
  sources: Partial<Record<IncomingReadingField, IncomingReadingSource>>;
  debits: readonly AutoApprovalDebit[];
  /** a NAV-sorok ugyanezzel a számmal (bármilyen szállítóé: a szűrés itt történik) */
  nav: readonly NavConfirmation[];
  /** a kézi jóváhagyás ellenőrzése (`approvalProblems`): ugyanaz a mérce, nem egy második */
  problems: (values: IncomingReadingValues) => string[];
}): AutoApproval {
  const { values, sources } = input;
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
  const rows = nav.filter(
    (row) =>
      numberKey(row.navInvoiceNumber) === number &&
      hungarianTaxBase(row.supplierTaxNumber) === base,
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

  const filled: IncomingReadingValues = { ...values };
  const filledSources = { ...sources };
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
