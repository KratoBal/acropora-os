import { createHash } from "node:crypto";

import {
  EU_COUNTRY_NAMES_HU,
  getDocumentCapabilities,
  isCardPayment,
  proposedIssueDueDate,
  szamlazzDocumentTotals,
  szamlazzLineAmounts,
  viesCountry,
  type BillingDocumentType,
  type BillingIssueSummary,
  type InvoiceFormat,
} from "@acropora/types";

import { Prisma } from "@acropora/database";

import { missingAddressParts } from "../customers/address-parts.js";
import {
  settlesPaidProforma,
  type BillingDocumentForIssue,
} from "./billing-document-szamlazz.adapter.js";
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
  | "BILLING_ISSUE_ADDRESS_INCOMPLETE"
  | "BILLING_ISSUE_NO_LINES"
  | "BILLING_ISSUE_LINE_INVALID"
  | "BILLING_ISSUE_LINE_NO_UNIT"
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

/**
 * A VÉGSZÁMLA KIÁLLÍTHATÓ-E MÉG (barracuda, #1672). A vázlat létrehozásakor az
 * előleg ép volt, de a kiállításig sztornózhatták (az OS-ben vagy a
 * Számlázz.hu felületén), és akkor egy sztornózott előleget vonnánk le.
 *
 * A bruttó nem lehet KISEBB az előlegénél: akkor a vevő fizetendője negatív.
 * EGYENLŐ lehet: a teljes összegű előleg után is végszámla jár, nulla
 * fizetendővel. Csak azonos pénznemnél mérhető; eltérőnél a Számlázz.hu dönt.
 *
 * `null`: nincs akadály; különben a kezelőnek szóló ok.
 */
export function finalInvoiceIssueProblem(
  row: Pick<
    BillingDocumentRow,
    "documentType" | "currency" | "referencedInvoice"
  >,
  grossAmount: string,
  advanceCancelledOnSite: boolean,
): string | null {
  if (row.documentType !== "FINAL_INVOICE") return null;
  const advance = row.referencedInvoice;
  if (!advance?.invoiceNumber)
    return "A végszámlához nincs kiállított előlegszámla rendelve.";
  if ((advance.correctionInvoices ?? []).length > 0 || advanceCancelledOnSite)
    return `A(z) ${advance.invoiceNumber} előlegszámlát időközben sztornózták, ezért ez a végszámla nem állítható ki.`;
  if (
    advance.grossAmount !== null &&
    advance.currency === row.currency &&
    new Prisma.Decimal(grossAmount).lt(advance.grossAmount)
  )
    return `A végszámla bruttója (${grossAmount} ${row.currency}) kisebb, mint a levonandó előlegé (${advance.grossAmount.toString()} ${row.currency}): a végszámla tételei a teljes ellenérték, nem a maradék.`;
  return null;
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
  // HIANYOS CIM (os-ugyfel-akvarium-hianyos): az akvariumhoz felvitt ugyfelnek
  // csak a neve kotelezo, a cim reszei (iranyitoszam, varos, utca) uresen is
  // tarolodhatnak. A szamla kiallitasakor jelezzuk, MELYIK resz hianyzik, ne a
  // Szamlazz.hu elutasitasa utan, es ne az akvarium felvitelekor.
  const missingParts = missingAddressParts(address);
  if (missingParts.length > 0)
    return {
      ok: false,
      code: "BILLING_ISSUE_ADDRESS_INCOMPLETE",
      message: `A partner számlázási címe hiányos (hiányzik: ${missingParts.join(", ")}); egészítsd ki a partnernél, a Számlázz.hu hiányos cím nélkül nem állít ki bizonylatot.`,
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
    /*
      A TÉTEL-SOR EGYSÉGE KÖTELEZŐ (barracuda számla-sor söprése, L5; kártya c37ea343): eddig az üres egység csendben "db"-ként ment
      a Számlázz.hu-ra, így egy órában, kg-ban vagy alkalomban mért tétel "db"-ként állt a számlán. A kedvezmény-sor nem tétel: az
      egysége a Számlázz.hu-n nem jelenik meg, ott marad a "db".
    */
    if (!discount && !line.unit?.trim())
      return {
        ok: false,
        code: "BILLING_ISSUE_LINE_NO_UNIT",
        message: `A(z) „${line.description}” tételnek nincs mennyiségi egysége (például db, óra, kg, alkalom). Add meg a tételnél, és utána állítsd ki.`,
      };
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

  // AN EU BUYER (a community tax number, no Hungarian one; acrobot 28300):
  // `adoalany` 6, "business in the EU" by the docs, the country by its
  // Hungarian name, and `adoszamEU`, so the NAV report does not see a
  // domestic buyer or a private person. Everyone else goes as before, with
  // no community number either, even if one is stored (barracuda, 28303).
  const euBuyer = Boolean(customer.euTaxNumber) && !customer.taxNumber;
  const buyer: BuyerSnapshot = {
    name: customer.companyName?.trim() || customer.displayName,
    country: address.country,
    zip: address.postalCode,
    city: address.city,
    address: [address.line1, address.line2].filter(Boolean).join(", "),
    taxNumber: customer.taxNumber,
    // the community tax number goes in <adoszamEU>, never in <adoszam>
    euTaxNumber: euBuyer ? customer.euTaxNumber : null,
    // the invoice goes to the billing address, the ordering one only when there is none (Balázs, 2026-10-26)
    email: customerSendAddress(customer),
  };
  const countryCode = EU_COUNTRY_NAMES_HU[address.country]
    ? address.country
    : viesCountry(customer.euTaxNumber ?? "");
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
      // a díjbekérőből készült bizonylat a díjbekérő számát viszi
      // (`dijbekeroSzamlaszam`; számlázási brief, 2. pont)
      proformaNumber: row.proformaInvoice?.invoiceNumber ?? null,
      // a végszámla a levont előleg számát viszi (`elolegSzamlaszam`;
      // számlázási brief, 3. pont); máshol a hivatkozott sor nem előleg
      advanceNumber:
        row.documentType === "FINAL_INVOICE"
          ? (row.referencedInvoice?.invoiceNumber ?? null)
          : null,
      buyer: {
        name: buyer.name,
        // `orszag` is free text (XSD string): only for an EU buyer, by name
        country: euBuyer
          ? (EU_COUNTRY_NAMES_HU[countryCode ?? ""] ?? null)
          : null,
        vatSubject: euBuyer ? 6 : null,
        zip: buyer.zip,
        city: buyer.city,
        address: buyer.address,
        email: buyer.email,
        taxNumber: buyer.taxNumber,
        euTaxNumber: buyer.euTaxNumber,
        taxSubject: {
          type: customer.type ?? null,
          partnerMirror: Boolean(customer.partner),
        },
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

/** What the Számlázz.hu feed knows about a proforma's payment (`BillingDocumentsRepository.proformaPaymentFacts`). */
export interface ProformaPaymentFacts {
  paidAmount: Prisma.Decimal;
  grossAmount: Prisma.Decimal;
  currency: string;
  cancelled: boolean;
}

/** Another invoice of the same webshop order (`BillingDocumentsRepository.webshopOrderInvoices`). */
export interface WebshopOrderInvoiceFact {
  documentType: "INVOICE" | "ADVANCE_INVOICE" | "FINAL_INVOICE";
  status: "ISSUED" | "ISSUING";
  number: string | null;
  /** Cancelled by an issued OS storno, or on the Számlázz.hu site: it no longer counts. */
  cancelled: boolean;
}

const WEBSHOP_INVOICE_NAMES: Record<
  WebshopOrderInvoiceFact["documentType"],
  string
> = {
  INVOICE: "számla",
  ADVANCE_INVOICE: "előlegszámla",
  FINAL_INVOICE: "végszámla",
};

/**
 * NO WEBSHOP ORDER IS INVOICED TWICE (card d31a66a3, S1). An order is settled EITHER by one invoice for the whole of it, OR by
 * advance invoices and a final invoice: never both. So an invoice stops when the order already has another invoice, an advance
 * or a final invoice, and an advance or final invoice stops when the order already has its invoice. One being issued counts
 * (its result is not known yet); a cancelled one does not. Until now only the order's own fixed invoice id kept a second one
 * away, and only from the order page: a copy in the billing editor, or an advance made from the order's proforma, passed.
 */
export function webshopOverbillingProblem(
  documentType: string,
  others: readonly WebshopOrderInvoiceFact[],
): string | null {
  const blocking = others.filter(
    (other) =>
      !other.cancelled &&
      (documentType === "INVOICE" ||
        ((documentType === "ADVANCE_INVOICE" ||
          documentType === "FINAL_INVOICE") &&
          other.documentType === "INVOICE")),
  );
  if (
    !blocking.length ||
    !["INVOICE", "ADVANCE_INVOICE", "FINAL_INVOICE"].includes(documentType)
  )
    return null;
  const named = blocking
    .map(
      (other) =>
        `${WEBSHOP_INVOICE_NAMES[other.documentType]} ${other.number ?? (other.status === "ISSUING" ? "(kiállítás alatt)" : "(szám nélkül)")}`,
    )
    .join(", ");
  return `Ennek a webshop rendelésnek már van kiállított bizonylata (${named}). Egy rendelést vagy egy számla, vagy előleg- és végszámla rendez, a kettő együtt nem: ez a bizonylat nem állítható ki.`;
}

/** The webshop transfer that paid a proforma (`BillingDocumentsRepository.webshopTransferFacts`). */
export interface WebshopTransferFacts {
  amount: Prisma.Decimal;
  currency: string;
  /** The proforma was an advance one: the transfer paid part of the order. */
  advance: boolean;
}

/** The gross the issue sends and an amount, compared to the fillér (as the order page compares them). */
const sameFiller = (gross: string, amount: Prisma.Decimal) =>
  new Prisma.Decimal(gross).toDecimalPlaces(2).eq(amount.toDecimalPlaces(2));

/**
 * THE WEBSHOP ORDER A DOCUMENT BELONGS TO (barracuda on #2884, the S2 follow-up). Its own source, OR the source of the proforma it
 * settles. The billing editor saves a draft's type and source (`headerData`) but not its proforma link, and an issued proforma
 * cannot be edited: a webshop invoice draft relabelled as MANUAL still names the order's proforma, so every webshop guard
 * (over-invoicing, the transfer, the Autokassza feed, "paid") reads the order from there and the relabelling escapes none.
 */
export function webshopOrderOf(row: {
  sourceType: string | null;
  sourceId: string | null;
  proformaInvoice?: {
    sourceType?: string | null;
    sourceId?: string | null;
  } | null;
}): string | null {
  if (row.sourceType === "WEBSHOP_ORDER" && row.sourceId) return row.sourceId;
  const proforma = row.proformaInvoice;
  return proforma?.sourceType === "WEBSHOP_ORDER" && proforma.sourceId
    ? proforma.sourceId
    : null;
}

/**
 * Which transfer settles which document of a webshop order: the whole-order invoice a whole transfer (S1), the advance
 * invoice an advance one (S2). Any other document is settled by no transfer.
 */
function transferMatchesType(
  documentType: string,
  facts: WebshopTransferFacts,
): boolean {
  return documentType === "INVOICE"
    ? !facts.advance
    : documentType === "ADVANCE_INVOICE"
      ? facts.advance
      : false;
}

/**
 * IS THIS WEBSHOP INVOICE THE MONEY THAT CAME IN (card d31a66a3, S1; the advance invoice of an advance transfer, S2). A prepaid webshop order's invoice is made from its
 * proforma once the transfer is recorded in the OS: Számlázz.hu does not know about that payment (its Autokassza is off), so
 * the feed cannot say "paid" here, the OS receipt does. Paid only when the receipt paid THIS invoice's proforma, it was not
 * an advance, and it IS this invoice's own gross, to the fillér, in the same currency (barracuda on #2884: "covers" let an
 * invoice with a line deleted in the editor go out smaller and paid); anything else is not paid.
 */
export function invoicePaidByTransfer(
  row: BillingDocumentRow,
  facts: WebshopTransferFacts | null,
): boolean {
  // the whole-order invoice settles a whole transfer, the advance invoice an advance one (S2): never crosswise
  if (facts === null || !transferMatchesType(row.documentType, facts))
    return false;
  if (facts.currency.trim().toUpperCase() !== row.currency.trim().toUpperCase())
    return false;
  const input = buildIssueInput(row);
  if (!input.ok) return false;
  return sameFiller(input.totals.grossAmount, facts.amount);
}

/**
 * A WEBSHOP INVOICE SETTLING A TRANSFER-PAID PROFORMA, ON THE SHARED ISSUE (barracuda on #2884). The order page checks these
 * before it saves the draft, but the same draft can be issued from the billing editor, where nothing of the order page runs.
 * So the shared issue checks them too, for an INVOICE whose proforma the order's recorded transfer paid:
 * - an advance transfer is settled by advance and final invoices, not by this one;
 * - the invoice is the money that came in, to the fillér (a line deleted or added in the editor stops it, paid or not);
 * - a Számlázz.hu invoice of the order that the OS did not issue (`foreignFeedInvoices`) stops it, by its number.
 * Without such a transfer (no proforma, another source, no receipt for this proforma) nothing changes.
 */
export function webshopTransferInvoiceProblem(
  row: BillingDocumentRow,
  facts: WebshopTransferFacts | null,
  foreignFeedInvoices: readonly string[],
): string | null {
  if (
    (row.documentType !== "INVOICE" &&
      row.documentType !== "ADVANCE_INVOICE") ||
    facts === null
  )
    return null;
  if (!transferMatchesType(row.documentType, facts))
    return row.documentType === "INVOICE"
      ? "Ennek a rendelésnek előleg-díjbekérőjét fizették: arra előlegszámla és végszámla jár, nem ez a számla."
      : "Ennek a rendelésnek a teljes összegét utalták: arra a rendelés számlája jár, nem előlegszámla.";
  const input = buildIssueInput(row);
  if (!input.ok) return null;
  if (
    facts.currency.trim().toUpperCase() !== row.currency.trim().toUpperCase() ||
    !sameFiller(input.totals.grossAmount, facts.amount)
  )
    return `A számla bruttója (${input.totals.grossAmount} ${row.currency}) nem egyezik a rendelés beérkezett utalásával (${facts.amount.toFixed(2)} ${facts.currency}). A beérkezett összegre szóló számla nem szerkeszthető más összegre: állítsd ki a rendelés oldaláról, változatlanul.`;
  if (foreignFeedInvoices.length)
    return `A Számlázz.hu-n már van számla ehhez a rendeléshez, amit nem az OS állított ki (${foreignFeedInvoices.join(", ")}). Az OS nem állít ki mellé másikat: nézd meg a Számlázásban, ez-e a rendelés számlája.`;
  return null;
}

/** The balance that came in after a webshop advance (`BillingDocumentsRepository.webshopBalanceFacts`, card d31a66a3, S3). */
export interface WebshopBalanceFacts {
  amount: Prisma.Decimal;
  currency: string;
}

/** A webshop order's final invoice: its own WEBSHOP_ORDER source, with the advance invoice it deducts. */
const webshopFinal = (row: BillingDocumentRow) =>
  row.documentType === "FINAL_INVOICE" &&
  row.sourceType === "WEBSHOP_ORDER" &&
  !!row.sourceId &&
  !!row.referencedInvoice;

/** What the final invoice leaves to pay: its gross minus the advance it deducts (the Számlázz.hu deduction). */
const finalPayable = (row: BillingDocumentRow, gross: string) =>
  new Prisma.Decimal(gross).minus(row.referencedInvoice?.grossAmount ?? 0);

const money = (amount: Prisma.Decimal, currency: string) =>
  `${amount.toFixed(2)} ${currency}`;

/**
 * A WEBSHOP ORDER'S FINAL INVOICE ON THE SHARED ISSUE (card d31a66a3, S4; acrobot 62375). After an advance the final invoice is
 * issued once the balance came in, and what it leaves to pay (its gross minus the advance) must be that balance to the fillér:
 * the customer has paid it already, so a final invoice of another amount would be a storno candidate. On a difference (the
 * final invoice rounds per line, the advance per VAT rate) it stops and names both amounts and the difference; the person
 * settles it by hand. The billing editor's issue meets the same rule. Other documents pass.
 */
export function webshopFinalInvoiceProblem(
  row: BillingDocumentRow,
  balance: WebshopBalanceFacts | null,
): string | null {
  if (!webshopFinal(row)) return null;
  if (!balance)
    return "A webshop rendelés végszámlája a hátralék beérkezése után állítható ki: előbb rögzítsd a hátralékot a rendelés oldalán.";
  const input = buildIssueInput(row);
  if (!input.ok) return null;
  return finalBalanceMismatch(
    input.totals.grossAmount,
    row.referencedInvoice?.grossAmount ?? new Prisma.Decimal(0),
    row.currency,
    balance,
  );
}

/**
 * THE ONE COMPARISON OF A FINAL INVOICE AND THE BALANCE (S4), for the shared issue and the order page alike, so both say the
 * same: what the final invoice leaves to pay (its gross minus the advance) against the balance that came in, to the fillér.
 * `null`: they match.
 */
export function finalBalanceMismatch(
  finalGross: string,
  advanceGross: Prisma.Decimal | string,
  currency: string,
  balance: WebshopBalanceFacts,
): string | null {
  if (balance.currency.trim().toUpperCase() !== currency.trim().toUpperCase())
    return `A végszámla pénzneme (${currency}) nem a beérkezett hátraléké (${balance.currency}). A végszámla nem megy ki: rendezd kézzel.`;
  const advance = new Prisma.Decimal(advanceGross);
  const payable = new Prisma.Decimal(finalGross).minus(advance);
  if (sameFiller(payable.toFixed(2), balance.amount)) return null;
  return `A végszámla fizetendője (bruttó ${money(new Prisma.Decimal(finalGross), currency)} mínusz az előleg ${money(advance, currency)}) ${money(payable, currency)}, a beérkezett hátralék ${money(balance.amount, balance.currency)}; az eltérés ${money(payable.minus(balance.amount), currency)}. A végszámla nem megy ki: a vevő már fizetett, rendezd kézzel.`;
}

/** Is this webshop final invoice paid by the recorded balance (S4): what it leaves to pay is the balance to the fillér. */
export function finalPaidByBalance(
  row: BillingDocumentRow,
  balance: WebshopBalanceFacts | null,
): boolean {
  if (!webshopFinal(row) || !balance) return false;
  if (
    balance.currency.trim().toUpperCase() !== row.currency.trim().toUpperCase()
  )
    return false;
  const input = buildIssueInput(row);
  if (!input.ok) return false;
  return sameFiller(
    finalPayable(row, input.totals.grossAmount).toFixed(2),
    balance.amount,
  );
}

/**
 * THE ONE READING OF "THE PROFORMA THIS DOCUMENT SETTLES IS PAID", for the window, the preview and the issue alike: an advance
 * invoice by the Számlázz.hu feed (card 00926d89), a webshop order's invoice and advance invoice by the OS transfer receipt
 * (card d31a66a3, S1 and S2).
 */
export async function proformaPaidOf(
  row: BillingDocumentRow,
  documents: {
    proformaPaymentFacts(
      documentNumber: string,
    ): Promise<ProformaPaymentFacts | null>;
    webshopTransferFacts(
      orderId: string,
      proformaId: string,
    ): Promise<WebshopTransferFacts | null>;
    webshopBalanceFacts(orderId: string): Promise<WebshopBalanceFacts | null>;
  },
): Promise<boolean> {
  // a webshop order's final invoice: the recorded balance says "paid" (S4); it settles no proforma of its own
  if (webshopFinal(row) && row.sourceId)
    return finalPaidByBalance(
      row,
      await documents.webshopBalanceFacts(row.sourceId),
    );
  const proforma = row.proformaInvoice;
  if (!proforma?.invoiceNumber) return false;
  const order = webshopOrderOf(row);
  // a webshop order's advance invoice: the OS receipt says "paid" (the Autokassza is off, the feed is silent), else the feed
  if (
    row.documentType === "ADVANCE_INVOICE" &&
    order &&
    invoicePaidByTransfer(
      row,
      await documents.webshopTransferFacts(order, proforma.id),
    )
  )
    return true;
  if (row.documentType === "ADVANCE_INVOICE")
    return advancePaidByProforma(
      row,
      await documents.proformaPaymentFacts(proforma.invoiceNumber),
    );
  if (row.documentType === "INVOICE" && order)
    return invoicePaidByTransfer(
      row,
      await documents.webshopTransferFacts(order, proforma.id),
    );
  return false;
}

/**
 * IS THIS ADVANCE INVOICE FULLY COVERED BY ITS PROFORMA'S PAYMENT (card 00926d89, barracuda on #2638). `fizetve=true` states that the
 * invoice is SETTLED, so "the proforma has a payment on it" is not enough: the feed's paid amount must reach the advance invoice's own
 * gross (the totals the issue sends), in the same currency, and the proforma must not be cancelled. A part payment, another currency, a
 * cancelled proforma, no feed row and an unbuildable draft are all "not paid": the invoice goes out as it always did.
 */
export function advancePaidByProforma(
  row: BillingDocumentRow,
  facts: ProformaPaymentFacts | null,
): boolean {
  if (row.documentType !== "ADVANCE_INVOICE" || facts === null) return false;
  if (facts.cancelled) return false;
  if (facts.currency.trim().toUpperCase() !== row.currency.trim().toUpperCase())
    return false;
  const input = buildIssueInput(row);
  if (!input.ok) return false;
  return facts.paidAmount.gte(new Prisma.Decimal(input.totals.grossAmount));
}

/**
 * WHERE AN ISSUED INVOICE IS SENT: the buyer's billing e-mail, the ordering one only when there is none (Balázs,
 * 2026-10-26). The billing editor's issue and the TIG invoice's window both take it from here.
 */
export function customerSendAddress(customer: {
  billingEmail: string | null;
  email: string | null;
}): string | null {
  return customer.billingEmail?.trim() || customer.email;
}

/**
 * THE CONFIRMATION WINDOW'S VALUES (card 7ba97e0d), FROM THE SAME BUILDER AS THE ISSUE: `buildIssueInput` is what
 * the issue sends to Számlázz.hu, so the window cannot show one thing while the invoice carries another. A draft
 * that could not be issued is refused here with the same message the issue would give. The issue date proposed is
 * today in Budapest (Számlázz.hu would take the day of the request); the other two dates are the draft's, except a
 * due date before today: with `paymentDueDays` it is proposed from today (`proposedIssueDueDate`). Without them (the
 * issue's own re-check, which reads only the fingerprint and the two flags) the draft's due date stays.
 *
 * `sendTo`: where a caller sends the document instead of the buyer's address (the webshop proforma goes to the order's
 * e-mail). The window shows it, and the fingerprint covers IT, so a change of the address the window named stops the
 * issue, and a change of the unused billing address does not (barracuda on #2429). Left out: the buyer's address.
 */
export function billingIssueSummary(
  row: BillingDocumentRow,
  today: string,
  paymentDueDays?: number,
  sendTo?: string | null,
  /** The proforma this document settles is PAID (`proformaPaidOf`): the due date is the issue day (cards 00926d89, d31a66a3 S1). */
  proformaPaid?: boolean,
):
  | { ok: true; summary: BillingIssueSummary }
  | { ok: false; code: string; message: string } {
  const input = buildIssueInput(row);
  if (!input.ok) return input;
  const document = input.document;
  const { showsPaymentFields } = getDocumentCapabilities(document.documentType);
  const paymentMethod = showsPaymentFields ? document.paymentMethod : null;
  const email =
    (sendTo === undefined ? document.buyer.email : sendTo)?.trim() || null;
  const advancePaid = settlesPaidProforma({ ...document, proformaPaid });
  return {
    ok: true,
    summary: {
      buyerName: document.buyer.name,
      buyerAddress: [
        [document.buyer.zip, document.buyer.city].filter(Boolean).join(" "),
        document.buyer.address,
      ]
        .filter(Boolean)
        .join(", "),
      buyerTaxNumber: document.buyer.taxNumber,
      buyerEuTaxNumber: document.buyer.euTaxNumber,
      buyerEmail: email,
      issueDate: today,
      fulfillmentDate: document.fulfillmentDate,
      dueDate: !showsPaymentFields
        ? null
        : advancePaid
          ? today
          : paymentDueDays === undefined
            ? document.dueDate
            : proposedIssueDueDate(document.dueDate, today, paymentDueDays),
      paymentMethod,
      showsPaymentFields,
      dueDateFollowsIssueDate:
        showsPaymentFields && (isCardPayment(paymentMethod) || advancePaid),
      fingerprint: issueFingerprint(
        sendTo === undefined
          ? document
          : { ...document, buyer: { ...document.buyer, email } },
      ),
    },
  };
}

/**
 * THE SHOWN, NOT EDITABLE VALUES AS A DIGEST: what the buyer and the payment are. A change to the draft itself is
 * caught by `expectedUpdatedAt`; this catches the one that does not touch the draft (the partner's name, address, e-mail or
 * tax number edited while the window was open).
 */
export function issueFingerprint(
  document: Pick<BillingDocumentForIssue, "documentType" | "paymentMethod"> & {
    buyer: Pick<
      BillingDocumentForIssue["buyer"],
      | "name"
      | "country"
      | "zip"
      | "city"
      | "address"
      | "taxNumber"
      | "euTaxNumber"
      | "email"
    >;
  },
): string {
  const { buyer } = document;
  return createHash("sha256")
    .update(
      JSON.stringify([
        document.documentType,
        buyer.name,
        buyer.country,
        buyer.zip,
        buyer.city,
        buyer.address,
        buyer.taxNumber,
        buyer.euTaxNumber,
        // the window shows where it sends (S2): a changed address stops the issue too
        buyer.email,
        document.paymentMethod,
      ]),
    )
    .digest("hex");
}
