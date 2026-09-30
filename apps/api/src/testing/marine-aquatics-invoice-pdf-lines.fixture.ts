/**
 * A Marine Aquatics-számlák PDF-jének SOROKRA bontott szövege, ahogy a
 * `pdfTextLines` adja: a cellák " | " jellel elválasztva. A szerkezet és a
 * nehéz esetek a valódi dokumentumoké (2026-04..09, 5 számla, 1 előleg-
 * elszámoló számla, 1 szállítási számla és 1 díjbekérő,
 * `exchange/beszallitok/marine-aquatics`); a vevő, a cím, a bankadat, a vevő
 * adószáma, a számlaszámok és az összegek kitaláltak. Az ELADÓ közösségi
 * adószáma a valódi (nyilvános cégadat, minden számlán szerepel): az illesztő
 * erről ismer rá. A tételek neve nyilvános katalógusnév.
 *
 * A mért nehéz esetek: a sorok közti pontozott vonal, a kód és egység nélküli
 * szállítási sor, a kóddal de egység nélküli szállítási sor, a szóközzel
 * tagolt ezres ("1 000,00"), az egész euróra kerekített végösszeg (a
 * sorok 0,20-szal többet adnak ki), az előleg-beszámítás negatív sora, és a
 * vevő saját adószáma ugyanabban az alakban, mint az eladóé.
 */
const SELLER_HEAD = [
  "MARINE AQUATICS s.r.o.",
  "mobile: +420-000000000",
  "Kitalalt 1 | Identif. No.: | 02622386",
  "www: marine-aquatics.eu",
  "00000 Kitalalt | Tax identity: | CZ02622386",
  "e-mail: info@marine-aquatics.eu",
];

const CUSTOMER = [
  "Customer",
  "Kitalalt Kft.",
  "Kitalalt utca 1",
  "Payment: | Payment order",
  "1111 Budapest",
];

const RULE = ".".repeat(120);

export const MARINE_AQUATICS_PDF_LINES = [
  ...SELLER_HEAD,
  "INVOICE - TAX DOCUMENT | 32699001",
  "Order No.: | 19001",
  ...CUSTOMER,
  "Remarks: | Online order from 1st SEP",
  "Hungary",
  "Date | Symbol",
  "Invoice date: | 01.09.2026 | variable: | 32699001 | Identif. No.: | 00-00-000000",
  "Recipient",
  "Tax identity: | HU99999999",
  "Due date: | 04.09.2026",
  "Account No. | CSPO",
  "CZ0000000000000000000000 | KITALALT",
  "Hungary",
  "Unit price | VAT in",
  "Item description | Catalog.number | Unit Qty | excl. VAT | Discount | VAT % | EUR | Total",
  RULE,
  "MarcoRock CUT natural rock (1kg) | MR-CUT1 | 20,00 | kg | 9,20 | 0 | % | 0 | 0,00 | 184,00",
  RULE,
  "PolypLab Medic Treatment (30ml) | POLYPLAB-MEDIC | 3,00 | pcs | 26,30 | 0 | % | 0 | 0,00 | 78,90",
  RULE,
  "AF Poly Glue (250ml) | AF Poly Glue 250 | 3,00 | pcs | 7,40 | 0 | % | 0 | 0,00 | 22,20",
  RULE,
  "Maxspect Jump LED - 32-LEDs aq. lighting (30W) | MJ-L130R | 12,00 | pcs | 83,50 | 0 | % | 0 | 0,00 | 1 002,00",
  RULE,
  "DPD - ZONE I (Export) trans - HUNGARY | 1,00 | 21,10 | 0 | % | 0 | 0,00 | 21,10",
  "Price | VAT | Total",
  "Discount %: | 0,00",
  "0 | % | 1 308,00 | 0,00 | 1 308,00",
  `${".".repeat(80)} | Total amount: | 1 308,00 | EUR`,
  "VAT Rate | 12 | % | 0,00 | 0,00 | 0,00",
  "Advance payment: | 0,00",
  "VAT Rate | 21 | % | 0,00 | 0,00 | 0,00",
  "TOTAL | 1 308,00 | 0,00 | 1 308,00 | Total due: | 1 308,00",
  "Note: The amounts are rounded.",
  "Official stamp",
  "Economic system | Money S3",
  "Printed by: Kitalalt, 01.09.2026 | www.money.cz | Page: 1",
  "=== oldal vege ===",
];

/** The account invoice: the proforma's prepayment settled by a negative row. */
export const MARINE_AQUATICS_ACCOUNT_INVOICE_LINES = [
  ...SELLER_HEAD,
  "INVOICE - TAX DOCUMENT | 32699002",
  "Order No.: | 19002",
  ...CUSTOMER,
  "Remarks: | Email order from",
  "Hungary",
  "Invoice date: | 06.09.2026 | variable: | 32699002 | Identif. No.: | 00-00-000000",
  "Tax identity: | HU99999999",
  "Due date: | 09.09.2026",
  "Unit price | VAT in",
  "Item description | Catalog.number | Unit Qty | excl. VAT | Discount | VAT % | EUR | Total",
  RULE,
  "AI Nero 5 - powerhead (~11300l/h /~30W) | AI-NERO5 | 2,00 | pcs | 179,70 | 0 | % | 0 | 0,00 | 359,40",
  RULE,
  "PRE-PAYMENT 52699001 (TAX KIT0000000) | 1,00 | -359,40 | 0 | % | 0 | 0,00 | -359,40",
  "Price | VAT | Total",
  "Discount %: | 0,00",
  "0 | % | 359,40 | 0,00 | 359,40",
  "Advance payment: | 359,40",
  "TOTAL | 359,40 | 0,00 | 359,40 | Total due: | 0,00",
  "=== oldal vege ===",
];

/** The shipping invoice: an empty order number, a coded row without a unit. */
export const MARINE_AQUATICS_SHIPPING_INVOICE_LINES = [
  ...SELLER_HEAD,
  "INVOICE - TAX DOCUMENT | 32699003",
  "Order No.:",
  ...CUSTOMER,
  "Remarks: | Email order from 5th SEP - shipping extras",
  "Hungary",
  "(DPD/RABEN)",
  "Invoice date: | 06.09.2026 | variable: | 32699003 | Identif. No.: | 00-00-000000",
  "Tax identity: | HU99999999",
  "Due date: | 10.09.2026",
  "Unit price | VAT in",
  "Item description | Catalog.number | Unit Qty | excl. VAT | Discount | VAT % | EUR | Total",
  RULE,
  "DPD transportation up to 18kg - HUNGARY | DPD HU18 | 1,00 | 9,90 | 0 | % | 0 | 0,00 | 9,90",
  RULE,
  "RABEN pallet shipping | 1,00 | 92,00 | 0 | % | 0 | 0,00 | 92,00",
  "Price | VAT | Total",
  "TOTAL | 102,00 | 0,00 | 102,00 | Total due: | 102,00",
  "=== oldal vege ===",
];

/** The proforma: the same table, no dotted rules, the currency on its own row. */
export const MARINE_AQUATICS_PROFORMA_LINES = [
  ...SELLER_HEAD,
  "PROFORMA INVOICE | 52699001",
  "Order No.: | 19002",
  ...CUSTOMER,
  "Remarks: | Email inquiry from 4th SEP",
  "Hungary",
  "Invoice date: | 04.09.2026 | variable: | 52699001 | Identif. No.: | 00-00-000000",
  "Tax identity: | HU99999999",
  "Due date: | 07.09.2026",
  "Unit price",
  "Item description | Catalog.number | Unit Qty | excl. VAT | Discount | VAT % | VAT | Total",
  "AI Nero 5 - powerhead (~11300l/h /~30W) | AI-NERO5 | 2,00 | pcs | 179,70 | 0 | % | 0 | 0,00 | 359,40",
  "RABEN pallet shipping | 1,00 | 190,00 | 0 | % | 0 | 0,00 | 190,00",
  "Currency: EUR | Price | VAT | Total",
  "VAT Rate | 0 | % | 549,40 | 0,00 | 549,40",
  "Total amount: | 550,00 | EUR",
  "TOTAL | 550,00 | 0,00 | 550,00 | Total due: | 550,00",
  "=== oldal vege ===",
];
