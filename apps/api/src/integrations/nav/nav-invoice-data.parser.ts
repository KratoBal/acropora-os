import { child, children, value, type XmlNode } from "./nav-xml.util.js";

// A queryInvoiceData válaszban base64+opcionális gzip formában érkező
// "szakmai" számla-XML (NAV invoiceData.xsd) feldolgozása. Csak a
// bevételezéshez ténylegesen szükséges mezőket olvassuk ki - a számla
// teljes üzleti tartalmát (pl. ÁFA-mentesség indoklása, elektronikus
// számla hash, stb.) nem tároljuk el.
//
// Nyitott pont: kizárólag az egyszeri <invoice> alakot kezeli, a
// <batchInvoice> (egy adatszolgáltatásban több számla) esetet nem - ez a
// NAV dokumentáció szerint ritka eset, egy technikai felhasználó jellemzően
// számlánként küld adatot.

export interface ParsedNavInvoiceLine {
  lineNumber: number;
  description: string;
  quantity: string;
  unit: string;
  unitPrice?: string;
  lineNetAmount: string;
  /** Az ÁFA-kulcs százalékban (pl. "27"), ha a NAV normál kulcsot adott vissza (nem mentesség/kívül eső). */
  vatRatePercent?: string;
}

export interface ParsedNavInvoiceAddress {
  postalCode: string;
  city: string;
  line1: string;
  country: string;
}

export interface ParsedNavInvoiceData {
  supplierTaxNumber?: string;
  supplierName: string;
  supplierAddress?: ParsedNavInvoiceAddress;
  supplierBankAccountNumber?: string;
  currency: string;
  exchangeRate?: string;
  invoiceIssueDate?: string;
  invoiceDeliveryDate?: string;
  paymentDate?: string;
  lines: ParsedNavInvoiceLine[];
}

const UNIT_LABELS: Record<string, string> = {
  PIECE: "db",
  KILOGRAM: "kg",
  TON: "t",
  LITRE: "l",
  KWH: "kWh",
  DAY: "nap",
  HOUR: "óra",
  MONTH: "hónap",
  YEAR: "év",
  CARTON: "karton",
  PACK: "csomag",
  METER: "m",
  LINEAR_METER: "fm",
  CUBIC_METER: "m3",
  MILLIGRAM: "mg",
  TONNE: "t",
  MILLILITER: "ml",
  BOX: "doboz",
};

function unitLabel(node: XmlNode | undefined): string {
  const ownUnit = value(node, "unitOfMeasureOwn");
  if (ownUnit) return ownUnit;
  const code = value(node, "unitOfMeasure");
  if (!code) return "db";
  return UNIT_LABELS[code] ?? code.toLowerCase();
}

function addressFromNode(
  node: XmlNode | undefined,
): ParsedNavInvoiceAddress | null {
  if (!node) return null;
  // A NAV DetailedAddressType-ja egy <simpleAddress> vagy <detailedAddress>
  // gyereket tartalmaz - mindkettőnél ugyanazok a mezőnevek szerepelnek
  // (postalCode/city/streetName/publicPlaceCategory/number), ezért a két
  // wrapper közül azt vesszük, amelyik ténylegesen jelen van.
  const wrapper =
    child(node, "detailedAddress") ?? child(node, "simpleAddress") ?? node;
  const postalCode = value(wrapper, "postalCode");
  const city = value(wrapper, "city");
  if (!postalCode || !city) return null;
  const streetName = value(wrapper, "streetName");
  const publicPlaceCategory = value(wrapper, "publicPlaceCategory");
  const houseNumber = value(wrapper, "number");
  const line1 =
    [streetName, publicPlaceCategory, houseNumber].filter(Boolean).join(" ") ||
    city;
  return {
    postalCode,
    city,
    line1,
    country: value(node, "countryCode") ?? "HU",
  };
}

function supplierTaxNumberFromNode(
  node: XmlNode | undefined,
): string | undefined {
  const detail = child(node, "supplierTaxNumber");
  const taxpayerId = value(detail, "taxpayerId");
  if (!taxpayerId) return undefined;
  const vatCode = value(detail, "vatCode");
  const countyCode = value(detail, "countyCode");
  return vatCode && countyCode
    ? `${taxpayerId}-${vatCode}-${countyCode}`
    : taxpayerId;
}

function vatRatePercentFromNode(node: XmlNode | undefined): string | undefined {
  const vatRate = child(node, "lineVatRate");
  // vatPercentage NAV-oldalon 0-1 közti törtszám (pl. 0.27 = 27%); mentesség
  // (vatExemption), tárgyi hatályon kívüliség (vatOutOfScope) és egyéb
  // speciális esetekben nincs vatPercentage - ilyenkor a mező üresen marad,
  // a felhasználó kézzel adja meg a bevételező űrlapon.
  const raw = value(vatRate, "vatPercentage");
  if (!raw) return undefined;
  const fraction = Number(raw);
  if (!Number.isFinite(fraction)) return undefined;
  return (fraction * 100).toString();
}

function parseLine(node: XmlNode): ParsedNavInvoiceLine | null {
  const lineNumber = Number(value(node, "lineNumber") ?? "");
  const description = value(node, "lineDescription");
  const quantity = value(node, "quantity");
  const netAmount =
    value(child(node, "lineAmountsNormal"), "lineNetAmount") ??
    value(node, "lineNetAmount");
  if (!Number.isFinite(lineNumber) || !description || !quantity || !netAmount)
    return null;
  const unitPrice = value(node, "unitPrice");
  return {
    lineNumber,
    description,
    quantity,
    unit: unitLabel(node),
    unitPrice,
    lineNetAmount: netAmount,
    vatRatePercent: vatRatePercentFromNode(
      child(node, "lineAmountsNormal") ?? node,
    ),
  };
}

/// A leggyakoribb (módusz) tétel-ÁFA-kulcs egy szám nélküli, egyszerű
/// megoldás a vegyes-kulcsú NAV-számlák kezelésére: a PurchaseInvoice séma
/// jelenleg csak egyetlen, számla-szintű vatRate mezőt tárol (szándékosan,
/// lásd a belföldi kézi rögzítést), ezért a bevételező űrlapon ez kerül
/// előtöltésre - a felhasználó szükség esetén felülírhatja.
export function suggestedVatRatePercent(
  lines: readonly ParsedNavInvoiceLine[],
): string | undefined {
  const counts = new Map<string, number>();
  for (const line of lines) {
    if (!line.vatRatePercent) continue;
    counts.set(line.vatRatePercent, (counts.get(line.vatRatePercent) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [rate, count] of counts) {
    if (count > bestCount) {
      best = rate;
      bestCount = count;
    }
  }
  return best;
}

export function parseNavInvoiceData(root: XmlNode): ParsedNavInvoiceData {
  // A root vagy közvetlenül <Invoice>, vagy - a namespace-eltávolítás után -
  // ugyanígy nevezett elem; az invoiceMain/invoice úton keresztül érjük el a
  // tényleges üzleti adatokat.
  const invoiceMain = child(root, "invoiceMain");
  const invoice = child(invoiceMain ?? root, "invoice") ?? invoiceMain ?? root;
  const invoiceHead = child(invoice, "invoiceHead");
  const supplierInfo = child(invoiceHead, "supplierInfo");
  const invoiceDetail = child(invoiceHead, "invoiceDetail");
  const invoiceLines = child(invoice, "invoiceLines");

  const lines = children(invoiceLines, "line")
    .map(parseLine)
    .filter((line): line is ParsedNavInvoiceLine => line !== null);

  return {
    supplierTaxNumber: supplierTaxNumberFromNode(supplierInfo),
    supplierName: value(supplierInfo, "supplierName") ?? "",
    supplierAddress:
      addressFromNode(child(supplierInfo, "supplierAddress")) ?? undefined,
    supplierBankAccountNumber: value(supplierInfo, "supplierBankAccountNumber"),
    currency: value(invoiceDetail, "currencyCode") ?? "HUF",
    exchangeRate: value(invoiceDetail, "exchangeRate"),
    invoiceIssueDate:
      value(invoiceHead, "invoiceIssueDate") ??
      value(invoiceDetail, "invoiceIssueDate"),
    invoiceDeliveryDate: value(invoiceDetail, "invoiceDeliveryDate"),
    paymentDate: value(invoiceDetail, "paymentDate"),
    lines,
  };
}
