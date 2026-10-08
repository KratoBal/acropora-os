import {
  szamlazzDocumentTotals,
  szamlazzLineAmounts,
  type BillingDocumentType,
  type InvoiceFormat,
} from "@acropora/types";

import type { BillingDocumentForIssue } from "./billing-document-szamlazz.adapter.js";
import type { BillingDocumentRow } from "./billing-documents.repository.js";

/**
 * A KIÁLLÍTÁS BEMENETE EGY VÁZLATBÓL (Számlázás v0.1; szerződés:
 * agents/nautilus/megosztas/szamlazas-kiallitas-lista-reszletek-vegpontok.md).
 *
 * A SORÖSSZEGEKET EZ SZÁMOLJA, NEM A TÁROLT ÉRTÉKET KÜLDI (murena 25170,
 * acrobot 25171): a vázlat 4 tizedesen tárol, a Számlázz.hu-ra a mért szabály
 * szerint (#1275) 2 tizedes megy. Minden sor `szamlazzLineAmounts`-szal megy ki
 * a mennyiségből, az egységárból és a kulcsból; a kedvezmény-sor mennyisége
 * "1", egységára a tárolt negatív nettó. Így a felület, ami ugyanezt a
 * függvényt hívja, pontosan azt a végösszeget mutatja, amit a számla kiír.
 *
 * TISZTA FÜGGVÉNY: nincs adatbázis és hálózat; a szolgáltatás ebből épít kérést,
 * és a kiállítás után ugyanezeket az összegeket írja vissza a sorokra.
 */

export interface BuyerSnapshot {
  name: string;
  country: string;
  zip: string;
  city: string;
  address: string;
  taxNumber: string | null;
  euTaxNumber: string | null;
  email: string | null;
}

export interface SentLineAmounts {
  lineId: string;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
}

export type IssueInput =
  | {
      ok: true;
      document: BillingDocumentForIssue;
      buyer: BuyerSnapshot;
      lines: SentLineAmounts[];
      /** A Számlázz.hu kerekítése szerinti végösszeg (a válasz hiányában ez áll). */
      totals: { netAmount: string; vatAmount: string; grossAmount: string };
      zeroForintLineIds: string[];
    }
  | { ok: false; code: IssueInputError; message: string };

export type IssueInputError =
  | "BILLING_ISSUE_NO_CUSTOMER"
  | "BILLING_ISSUE_NO_ADDRESS"
  | "BILLING_ISSUE_NO_LINES"
  | "BILLING_ISSUE_LINE_INVALID"
  | "BILLING_ISSUE_NO_FULFILLMENT_DATE";

/** "27.00" -> "27", "5.50" -> "5.5": a Számlázz.hu `afakulcs` alakja. */
export function vatRateText(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

/**
 * EGY TÁROLT SOR ÖSSZEGEI, AHOGY A SZÁMLÁZZ.HU-RA MENNEK: a kedvezmény-sor
 * mennyisége "1", egységára a tárolt negatív nettó. A kiállítás és a lista
 * ugyanezt hívja, hogy a listában álló bruttó az legyen, amit a számla kiír.
 */
export function szamlazzAmountsOfLine(
  line: {
    kind: string;
    quantity: { toString(): string };
    unitNet: { toString(): string };
    netAmount: { toString(): string };
    vatRatePercent: { toString(): string };
  },
  currency: string,
) {
  const discount = line.kind === "DISCOUNT";
  return szamlazzLineAmounts({
    quantity: discount ? "1" : line.quantity.toString(),
    unitNet: discount ? line.netAmount.toString() : line.unitNet.toString(),
    vatRatePercent: line.vatRatePercent.toString(),
    currency,
  });
}

const day = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;

function billingAddress(row: BillingDocumentRow) {
  const addresses = row.customer?.addresses ?? [];
  // ugyanaz a választás, mint a vázlat részleteinél (murena addressOf-ja)
  return (
    addresses.find((a) => a.type === "BILLING" && a.isDefault) ??
    addresses.find((a) => a.type === "BILLING") ??
    addresses.find((a) => a.isDefault) ??
    addresses[0] ??
    null
  );
}

export function buildIssueInput(row: BillingDocumentRow): IssueInput {
  const customer = row.customer;
  if (!customer)
    return {
      ok: false,
      code: "BILLING_ISSUE_NO_CUSTOMER",
      message: "A bizonylathoz nincs partner rendelve.",
    };
  const address = billingAddress(row);
  if (!address)
    return {
      ok: false,
      code: "BILLING_ISSUE_NO_ADDRESS",
      message:
        "A partnernek nincs számlázási címe; a Számlázz.hu cím nélkül nem állít ki bizonylatot.",
    };
  if (row.lines.length === 0)
    return {
      ok: false,
      code: "BILLING_ISSUE_NO_LINES",
      message: "A bizonylaton nincs tétel.",
    };
  const fulfillmentDate = day(row.fulfillmentDate);
  if (!fulfillmentDate)
    return {
      ok: false,
      code: "BILLING_ISSUE_NO_FULFILLMENT_DATE",
      message: "A teljesítés dátuma kötelező a kiállításhoz.",
    };

  const positions = new Map(
    row.lines.map((line) => [line.id, line.position ?? 0]),
  );
  const lines: SentLineAmounts[] = [];
  const forIssue: BillingDocumentForIssue["lines"][number][] = [];
  for (const line of row.lines) {
    const discount = line.kind === "DISCOUNT";
    const amounts = szamlazzAmountsOfLine(line, row.currency);
    if (!amounts.ok)
      return {
        ok: false,
        code: "BILLING_ISSUE_LINE_INVALID",
        message: `A(z) „${line.description}” tétel összege nem számolható (${amounts.error}).`,
      };
    lines.push({
      lineId: line.id,
      netAmount: amounts.netAmount,
      vatAmount: amounts.vatAmount,
      grossAmount: amounts.grossAmount,
    });
    forIssue.push({
      position: line.position ?? 0,
      kind: line.kind,
      parentPosition: line.parentLineId
        ? (positions.get(line.parentLineId) ?? null)
        : null,
      description: line.description,
      code: null,
      quantity: discount ? 1 : Number(line.quantity),
      unit: line.unit ?? "db",
      unitNet: discount ? Number(amounts.netAmount) : Number(line.unitNet),
      vatRate: vatRateText(line.vatRatePercent.toString()),
      netAmount: Number(amounts.netAmount),
      vatAmount: Number(amounts.vatAmount),
      grossAmount: Number(amounts.grossAmount),
      comment: line.comment,
    });
  }

  const buyer: BuyerSnapshot = {
    name: customer.companyName?.trim() || customer.displayName,
    country: address.country,
    zip: address.postalCode,
    city: address.city,
    address: [address.line1, address.line2].filter(Boolean).join(", "),
    taxNumber: customer.taxNumber,
    // the community tax number goes in <adoszamEU>, never in <adoszam>
    euTaxNumber: customer.euTaxNumber,
    email: customer.email,
  };
  const totals = szamlazzDocumentTotals(lines, row.currency);
  const zeroForintLineIds = totals.zeroForintLines.map(
    (index) => lines[index]!.lineId,
  );

  return {
    ok: true,
    document: {
      id: row.id,
      documentType: row.documentType as BillingDocumentType,
      invoiceFormat: row.invoiceFormat as InvoiceFormat | null,
      fulfillmentDate,
      dueDate: day(row.dueDate),
      paymentMethod: row.paymentMethod,
      currency: row.currency,
      language: row.language,
      note: row.note,
      reference: row.reference,
      // a díjbekérő-hivatkozás a proformaInvoiceId-n át jön; v0.1-ben nincs kötve
      proformaNumber: null,
      buyer: {
        name: buyer.name,
        // az `orszag` alakját a doksi nem mondja meg: nem küldjük, a snapshot tárolja
        country: null,
        zip: buyer.zip,
        city: buyer.city,
        address: buyer.address,
        email: buyer.email,
        taxNumber: buyer.taxNumber,
        euTaxNumber: buyer.euTaxNumber,
      },
      lines: forIssue,
    },
    buyer,
    lines,
    totals: {
      netAmount: totals.netAmount,
      vatAmount: totals.vatAmount,
      grossAmount: totals.grossAmount,
    },
    zeroForintLineIds,
  };
}
