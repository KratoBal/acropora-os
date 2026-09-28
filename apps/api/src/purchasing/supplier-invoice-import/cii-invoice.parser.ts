import type {
  SupplierInvoiceImportLine,
  SupplierInvoiceImportResult,
} from "@acropora/types";

import { parseXml, type XmlNode } from "../../integrations/nav/nav-xml.util.js";
import {
  countryFromVatId,
  isChargeDescription,
  normalizeVatId,
  round2,
  unitLabel,
} from "./supplier-invoice-import.common.js";
import { SupplierInvoiceImportError } from "./supplier-invoice-import.error.js";

/**
 * A CII (UN/CEFACT Cross Industry Invoice) számla olvasása: ez a ZUGFeRD, a
 * Factur-X és az XRechnung CII-változatának közös alakja. BESZÁLLÍTÓFÜGGETLEN:
 * semmi nem tudja benne, ki állította ki a számlát.
 *
 * AMIT SOHA NEM OLVAS: a vevő (`BuyerTradeParty`), az eladó kapcsolattartója
 * (`DefinedTradeContact`: név, telefon, e-mail) és a bankadat
 * (`PayeePartyCreditorFinancialAccount`). A beolvasás egy számla SORAIT tölti
 * elő; a számla többi személyes vagy pénzügyi adata nem kell hozzá, és ami
 * nincs kiolvasva, az nem is szivároghat tovább.
 *
 * A névtér-előtag (`rsm:`, `ram:`, `udt:`) számlánként eltérhet, ezért minden
 * elemet a helyi neve alapján keresünk.
 */

const localName = (name: string) => name.slice(name.indexOf(":") + 1);

function kid(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((item) => localName(item.name) === name);
}

function kids(node: XmlNode | undefined, name: string): XmlNode[] {
  return node?.children.filter((item) => localName(item.name) === name) ?? [];
}

function path(
  node: XmlNode | undefined,
  ...names: string[]
): XmlNode | undefined {
  return names.reduce<XmlNode | undefined>((at, name) => kid(at, name), node);
}

function text(node: XmlNode | undefined, ...names: string[]): string | null {
  const found = path(node, ...names);
  const value = found?.text.replace(/\s+/g, " ").trim();
  return value ? value : null;
}

function amount(node: XmlNode | undefined, ...names: string[]): number | null {
  const raw = text(node, ...names);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** CII `DateTimeString` in format 102 (YYYYMMDD) -> YYYY-MM-DD. */
function date(node: XmlNode | undefined, ...names: string[]): string | null {
  const raw = text(node, ...names, "DateTimeString");
  const match = raw?.match(/^(\d{4})(\d{2})(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** Credit note (381) and its corrected form (384 is a corrected invoice, allowed). */
const CREDIT_NOTE_TYPE_CODES = new Set(["381", "396", "532"]);

function readLine(item: XmlNode, index: number): SupplierInvoiceImportLine {
  const product = kid(item, "SpecifiedTradeProduct");
  const agreement = kid(item, "SpecifiedLineTradeAgreement");
  const billed = path(item, "SpecifiedLineTradeDelivery", "BilledQuantity");
  const description = text(product, "Name") ?? "";
  const quantity = billed ? Number(billed.text.trim()) : NaN;
  const lineNet =
    amount(
      item,
      "SpecifiedLineTradeSettlement",
      "SpecifiedTradeSettlementLineMonetarySummation",
      "LineTotalAmount",
    ) ?? 0;
  const net = amount(agreement, "NetPriceProductTradePrice", "ChargeAmount");
  const gross = amount(
    agreement,
    "GrossPriceProductTradePrice",
    "ChargeAmount",
  );
  // The editor keeps the price BEFORE discount plus a discount percent. With
  // a gross price on the line, the gap between gross and net is the discount.
  const unitNet = gross ?? net ?? (quantity > 0 ? lineNet / quantity : 0);
  const discountPercent =
    gross !== null && net !== null && gross > 0 && net < gross
      ? round2(((gross - net) / gross) * 100)
      : null;
  const globalId = kid(product, "GlobalID");
  const ean =
    globalId && /^\d{8,14}$/.test(globalId.text.trim())
      ? globalId.text.trim()
      : null;
  const lineId = Number(text(item, "AssociatedDocumentLineDocument", "LineID"));
  return {
    lineNumber: Number.isInteger(lineId) && lineId > 0 ? lineId : index + 1,
    supplierSku: text(product, "SellerAssignedID"),
    ean,
    description,
    quantity: Number.isFinite(quantity) ? quantity : 0,
    unit: unitLabel(billed?.attributes?.unitCode),
    // four decimals, as CII carries unit prices ("4.5000")
    unitNet: Math.round(unitNet * 10000) / 10000,
    discountPercent,
    lineNet,
    isCharge: isChargeDescription(description),
  };
}

export function parseCiiInvoiceXml(xml: string): SupplierInvoiceImportResult {
  let root: XmlNode;
  try {
    root = parseXml(xml);
  } catch {
    throw new SupplierInvoiceImportError("XML_INVALID");
  }
  if (localName(root.name) !== "CrossIndustryInvoice")
    throw new SupplierInvoiceImportError("XML_NOT_CII");

  const document = kid(root, "ExchangedDocument");
  const typeCode = text(document, "TypeCode");
  if (typeCode && CREDIT_NOTE_TYPE_CODES.has(typeCode))
    throw new SupplierInvoiceImportError("CREDIT_NOTE");

  const transaction = kid(root, "SupplyChainTradeTransaction");
  const seller = path(
    transaction,
    "ApplicableHeaderTradeAgreement",
    "SellerTradeParty",
  );
  const settlement = kid(transaction, "ApplicableHeaderTradeSettlement");

  const vatRegistration = kids(seller, "SpecifiedTaxRegistration")
    .map((registration) => kid(registration, "ID"))
    .find((id) => id?.attributes?.schemeID === "VA");
  const vatId = normalizeVatId(vatRegistration?.text);

  const lines = kids(transaction, "IncludedSupplyChainTradeLineItem").map(
    readLine,
  );
  if (lines.length === 0) throw new SupplierInvoiceImportError("NO_LINES");

  const warnings: string[] = [];
  if (typeCode && typeCode !== "380")
    warnings.push(
      `A dokumentum típuskódja ${typeCode}, nem a szokásos számla (380).`,
    );

  return {
    format: "XML",
    supplier: {
      name: text(seller, "Name"),
      vatId,
      country:
        text(seller, "PostalTradeAddress", "CountryID") ??
        countryFromVatId(vatId),
    },
    invoiceNumber: text(document, "ID"),
    invoiceDate: date(document, "IssueDateTime"),
    dueDate: date(settlement, "SpecifiedTradePaymentTerms", "DueDateDateTime"),
    currency: text(settlement, "InvoiceCurrencyCode"),
    netTotal: amount(
      settlement,
      "SpecifiedTradeSettlementHeaderMonetarySummation",
      "LineTotalAmount",
    ),
    lines,
    warnings,
  };
}
