import type { Prisma } from "@acropora/database";
import type {
  NavIncomingInvoiceDetail,
  NavIncomingInvoiceStatus,
  NavIncomingInvoiceSummary,
} from "@acropora/types";

import type {
  ParsedNavInvoiceData,
  ParsedNavProductCode,
} from "../../integrations/nav/nav-invoice-data.parser.js";
import { eanCheckDigitValid } from "../../products/barcode.util.js";
import { ervenyesSorszam } from "../nav-line-source.js";
import { isChargeDescription } from "../supplier-invoice-import/supplier-invoice-import.common.js";

/// A NavIncomingInvoice.parsedData JSON mezőben tárolt pillanatkép alakja -
/// a queryInvoiceData válaszból parszolt üzleti adat (lásd
/// nav-invoice-data.parser.ts) plusz az akkor kiszámolt javasolt ÁFA-kulcs,
/// hogy ne kelljen minden lekérdezéskor újraszámolni.
export interface StoredNavInvoiceParsedData extends ParsedNavInvoiceData {
  suggestedVatRatePercent?: string;
}

export interface NavIncomingInvoiceRow {
  id: string;
  navInvoiceNumber: string;
  supplierTaxNumber: string;
  supplierName: string;
  invoiceIssueDate: Date;
  invoiceDeliveryDate: Date | null;
  paymentDate: Date | null;
  currency: string;
  invoiceNetAmount: Prisma.Decimal | null;
  invoiceVatAmount: Prisma.Decimal | null;
  insDate: Date;
  status: NavIncomingInvoiceStatus;
  parsedData: Prisma.JsonValue | null;
  errorCode: string | null;
  purchaseInvoiceId: string | null;
}

function parsedDataOf(
  row: NavIncomingInvoiceRow,
): StoredNavInvoiceParsedData | null {
  return row.parsedData as StoredNavInvoiceParsedData | null;
}

export function toNavIncomingInvoiceSummary(
  row: NavIncomingInvoiceRow,
): NavIncomingInvoiceSummary {
  return {
    id: row.id,
    navInvoiceNumber: row.navInvoiceNumber,
    supplierTaxNumber: row.supplierTaxNumber,
    supplierName: row.supplierName,
    invoiceIssueDate: row.invoiceIssueDate.toISOString(),
    invoiceDeliveryDate: row.invoiceDeliveryDate?.toISOString(),
    paymentDate: row.paymentDate?.toISOString(),
    currency: row.currency,
    invoiceNetAmount: row.invoiceNetAmount?.toString(),
    invoiceVatAmount: row.invoiceVatAmount?.toString(),
    insDate: row.insDate.toISOString(),
    status: row.status,
    purchaseInvoiceId: row.purchaseInvoiceId ?? undefined,
    errorCode: row.errorCode ?? undefined,
  };
}

/**
 * A tétel kódjaiból a javaslat két bemenete (supplierSku, ean).
 *
 * A NAV 3.0 séma (invoiceData.xsd `ProductCodeCategoryType`) EAN fajtát nem
 * ismer. A szállító saját cikkszáma az `OWN` ("A vállalkozás által képzett
 * termékkód"); EAN-t csak az `OTHER` ("Egyéb termékkód") hordozhat, ezért
 * onnan is csak akkor vesszük, ha az ellenőrző számjegye stimmel - egy
 * tetszőleges "egyéb" kódot nem nevezünk EAN-nek. A VTSZ, KN, TESZOR és a
 * többi hatósági osztályozó kód termékcsaládot jelöl, nem terméket.
 */
function codeInputsOf(codes: readonly ParsedNavProductCode[] | undefined): {
  supplierSku?: string;
  ean?: string;
} {
  const supplierSku = codes?.find((code) => code.category === "OWN")?.value;
  const ean = codes?.find(
    (code) =>
      code.category === "OTHER" && eanCheckDigitValid(code.value) === true,
  )?.value;
  return {
    ...(supplierSku ? { supplierSku } : {}),
    ...(ean ? { ean } : {}),
  };
}

/**
 * A magyar adószám törzsszáma (az első 8 jegy), vagy `null`.
 *
 * Ugyanaz a cég többféle alakban áll: a NAV hol csak a törzsszámot adja
 * (`14116380`), hol a teljes adószámot (`14116380-2-06`), a szállítói
 * törzsben pedig a közösségi alak is előfordulhat (`HU14116380`). Mindhárom
 * `14116380`. Más ország adószáma nem magyar törzsszám: `null`.
 */
export function hungarianTaxBase(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const compact = raw.replace(/[\s.-]/g, "").toUpperCase();
  const digits = compact.startsWith("HU") ? compact.slice(2) : compact;
  if (!/^\d+$/.test(digits)) return null;
  return digits.length === 8 || digits.length === 11
    ? digits.slice(0, 8)
    : null;
}

export function toNavIncomingInvoiceDetail(
  row: NavIncomingInvoiceRow,
): NavIncomingInvoiceDetail {
  const parsed = parsedDataOf(row);
  return {
    ...toNavIncomingInvoiceSummary(row),
    supplierAddress: parsed?.supplierAddress,
    supplierBankAccountNumber: parsed?.supplierBankAccountNumber,
    suggestedVatRatePercent: parsed?.suggestedVatRatePercent,
    lines: (parsed?.lines ?? []).map((line) => ({
      /*
        A MAR ELTAROLT szamlakban a hianyzo sorszam 0-kent all (a parser
        2026-09-28 elotti alakja irta), es a tarolt adatot nem irjuk at.
        Kiolvasaskor ugyanaz a szabaly szuri, mint a forras-parositast:
        a 0 itt is `null`, kulonben a web visszakuldene, es a DTO `@Min(1)`
        kapuja 400-zal utasitana el a mentest.
      */
      lineNumber: ervenyesSorszam(line.lineNumber),
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitPrice: line.unitPrice,
      lineNetAmount: line.lineNetAmount,
      vatRatePercent: line.vatRatePercent,
      /*
        A DIJSOR-SZABALY MINDEN SZALLITORA (Balazs, 2026-09-29 11:49 UTC): a
        fajlbol beolvasott szamlakon eddig is ez jelolte a szallitasi es fuvar
        sorokat, a NAV-bol jovokon semmi, ezert ott egy "Szallitasi dij" sor
        termek-javaslatot kert. KIOLVASASKOR szamoljuk, nem a parserben, igy a
        mar eltarolt NAV szamlakra is all.
      */
      isCharge: isChargeDescription(line.description),
      ...(line.productCodes ? { productCodes: line.productCodes } : {}),
      ...codeInputsOf(line.productCodes),
    })),
  };
}
