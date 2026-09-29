/**
 * A De Jong Marinelife-számla PDF-jének SOROKRA bontott szövege, ahogy a
 * `pdfTextLines` adja: a cellák " | " jellel elválasztva. A szerkezet és a
 * nehéz esetek a valódi számláké (#1199 P-026, 2019-2026, 98 PDF); a vevő, a
 * cím, a bankadat, az adószámok és a számok kitaláltak, a tételek neve
 * nyilvános katalógusnév. A cégnév a valódi számlán kép, szövegként csak a
 * levélcím domainje áll ott.
 */
export const DEJONG_PDF_LINES = [
  "Kitalalt utca 1",
  "0000 AA | KITALALT",
  "The Netherlands",
  "Kitalalt Vevo Kft.",
  "Mail: | info@dejongmarinelife.nl",
  "Kitalalt ut 9",
  "9999 | Budapest",
  "Hungary",
  "VAT No. | HU99999999",
  "VAT No.: | NL999999999B01",
  "Invoice",
  "Invoice No. | : | 99008847 | Due Date | : | 07-10-2026",
  "Customer Code | : | 99999 | Page | : | 1 / 2",
  "Invoice Date | : | 23-09-2026 | Your Ref. | : | 000000001",
  "Qty | Item Code | Description | HS Code | Price | Disc. | Amount",
  "1 | AI-PUCKPHD | Prime HD Led Puck | 94054990 | € | 53,10 | 0,00% | € | 53,10",
  // a code longer than its column wraps; the description comes in two cells
  "2 | PHILIPS-2020-CONTROL | Philips CoralCare - Controller EU/UK (new | model) | 85437090 | € | 80,00 | 0,00% | € | 160,00",
  "LER",
  "2 | FAUNA-14230 | Balling Light Calcium-Mix | - 2 kg | 28272000 | € | 15,85 | 0,00% | € | 31,70",
  // price and discount in ONE cell, and no HS code cell
  "2 | NS-WSK-EU | WAV Starter Kit | € | 428,16 10,00% | € | 770,69",
  "Cites Nr:26NL999999/11",
  "Subtotal | € | 1.015,49",
  "=== oldal vege ===",
  "Page | : 2 / 2",
  "Qty | Item Code | Description | HS Code | Price | Disc. | Amount",
  "Transport | € | 1.015,49",
  // the code joined with its text, then an HS code cell
  "1 | DJM-075012-T-BIO-BOX Bio-based plastic bag XXS (12x30) - Box 1000 pcs. | 39239000 | € | 140,00 | 0,00% | € | 140,00",
  // a mark next to the code, and a surcharge written as a negative discount
  "2 | AO-PAR-010152 ! | Ostorhinchus parvulus | 03011900 | € | 14,50 | -5,00% | € | 30,45",
  // no code: a dot in the code cell
  "1 | . | Rhina ancylostoma | € | 15.000,0 | 0,00% | € | 15.000,00",
  // a charge whose text never says "shipping": the code does
  "1 | SC-090012 | Schenker 1/2 pallet | € | 60,00 | 0,00% | € | 60,00",
  "Subtotal | Amount excl. VAT | VAT % | VAT amount | Total to be paid",
  "€ | 16.245,94 | € | 16.245,94 | 0,0% | € | 0,00 | € | 16.245,94",
  "Please pay this invoice before 07-10-2026",
  "=== oldal vege ===",
];
