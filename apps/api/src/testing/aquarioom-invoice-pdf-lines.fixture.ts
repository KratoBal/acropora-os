/**
 * Az Aquarioom-számla PDF-jének SOROKRA bontott szövege, ahogy a
 * `pdfTextLines` adja: a cellák " | " jellel elválasztva. A szerkezet és a
 * nehéz esetek a valódi számláké (2026-06..09, 5 számla és 5 díjbekérő,
 * `exchange/aquarioom/nyers`); a vevő, a cím, a bankadat, a vevő adószáma és
 * az összegek kitaláltak. Az ELADÓ közösségi adószáma a valódi (nyilvános
 * cégadat, minden számlán szerepel): az illesztő erről ismer rá. A tételek
 * neve nyilvános katalógusnév.
 *
 * Benne van minden mért nehéz eset: a rendelésszám-sor, a kódtörés ("AA-" +
 * "SATO270D"), a megnevezés-törés, a díjmentes csere (üres sor, "Free - SAV"
 * megjegyzés, 0,00-s alkatrész), a lapváltás, a "Carriage" a végösszegek
 * között, a befizetett előleg utáni 0,00-s "Grand Total", és a számla után a
 * SZÁLLÍTÓLEVÉL ugyanazokkal a tételekkel.
 */
export const AQUARIOOM_PDF_LINES = [
  "AQUARIOOM",
  "1 rue Kitalalt - 00000 KITALALT",
  "TVA Intra. : FR67529301244 - Code NAF : 4649Z",
  "Invoice",
  "Invoice No. : | FA00001234",
  "Date : | 30/09/2026",
  "Customer No. : | ACROPORA",
  "Kitalalt Kft.",
  "Reference | Description | Qty | Unit Price | Amount | VAT",
  "CDE | AQUARIOOM Order n° 12345 | 0,00 | 0,00 | 0,00 | 0,00",
  'A-FBN4 | 4" Nylon Filter Bag | 5 | 2,00 | 10,00 | 0,00',
  "AA- | Smart ATO NANO G2 | 2 | 50,00 | 100,00 | 0,00",
  "SATO270D",
  "F-EDSP | Flipper Edge Standard 2 in 1 Magnetic Cleaner with 2 blade Puffer | 1 | 40,00 | 40,00 | 0,00",
  "Limited Edition",
  "M-RSX200 | Maxspect RSX 200W | 1 | 1 000,00 | 1 000,00 | 0,00",
  "0,00 | 0,00 | 0,00 | 0,00",
  "Free - SAV 875 | 0,00 | 0,00 | 0,00 | 0,00",
  "M-GP3016CE | Maxspect Gyre 350 Cloud Edition - Motor | 1 | 0,00 | 0,00 | 0,00",
  "1 sur 2",
  "Bankverbindung",
  "IBAN : | FR0000000000000000000000000",
  "=== oldal vege ===",
  "Invoice",
  "Invoice No. : | FA00001234",
  "Reference | Description | Qty | Unit Price | Amount | VAT",
  "Rate | Total exc. VAT | Amount",
  "Total | 1 150,00 €",
  "0,00 | 1 170,00",
  "Carriage | 20,00 €",
  "VAT Reg No. : HU99999999",
  "VAT exemption: article 262 ter I of the French General Tax Code | Total HT Net | 1 170,00 €",
  "VAT | 0,00 €",
  "Grand Total | 1 170,00 €",
  "Acomptes | 1 170,00 €",
  "Grand Total | 0,00 €",
  "2 sur 2",
  "=== oldal vege ===",
  "AQUARIOOM",
  "TVA Intra. : FR67529301244 - Code NAF : 4649Z",
  "Delivery Note",
  "Delivery No. : | FA00001234",
  "Reference | Description | Qty | Control",
  "CDE | 0,00",
  "AQUARIOOM Order n° 12345",
  'A-FBN4 | 4" Nylon Filter Bag | 5',
  "AA- | Smart ATO NANO G2 | 2",
  "SATO270D",
  "M-RSX200 | Maxspect RSX 200W | 1",
  "1 sur 1",
  "=== oldal vege ===",
];

/**
 * UGYANEZ DÍJBEKÉRŐKÉNT: a táblázat azonos, a cím és a szám más, és nincs
 * befizetett előleg. Egy szállítás nélküli, egytételes rendelés, hogy a
 * "Carriage" nélküli végösszeg-olvasást is lefedje.
 */
export const AQUARIOOM_PROFORMA_LINES = [
  "AQUARIOOM",
  "TVA Intra. : FR67529301244 - EORI : FR529301244",
  "Proforma Invoice",
  "Proforma No. : | CM1234",
  "Date : | 28/09/2026",
  "Reference | Description | Qty | Unit Price | Amount | VAT",
  "CDE | AQUARIOOM Order n° 12346 | 0,00 | 0,00 | 0,00 | 0,00",
  "AS-FX104 | Kit of 50 discs FX104 (SpinTouch - Freshwater) | 1 | 300,00 | 300,00 | 0,00",
  "Rate | Total exc. VAT | Amount",
  "Total Net | 300,00 €",
  "VAT | 0,00 €",
  "Grand Total | 300,00 €",
  "Grand Total | 300,00 €",
  "Bank Account",
  "1 sur 1",
  "=== oldal vege ===",
];
