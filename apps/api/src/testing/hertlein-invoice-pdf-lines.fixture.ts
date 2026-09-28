/**
 * A Hertlein-számla PDF-jének SOROKRA bontott szövege, ahogy a
 * `pdfTextLines` adja: a cellák " | " jellel elválasztva. A szerkezet a
 * valódi számláké (#1199 A-008, 45 számla), a vevő adatai és minden szám
 * kitalált; a tételsorok termékneve nyilvános katalógusnév.
 */
export const HERTLEIN_PDF_LINES = [
  "Hertlein Aquaristik e.Kfr.",
  "Hertlein Aquaristik e.Kfr., Langenzenner Str. 10, | 90599 Dietenhofen",
  "Kitalalt Vevo Kft",
  "HU-9999 Kitalalt | Rechnung Nr. : | 990002",
  "Kunden Nr. : | 99999",
  "Rechnungsdatum: | 25.09.2026",
  "Ihre Ust-IdNr.: | HU99999999",
  "Seite : | 1 von 2",
  "Rechnung",
  "Artikelnr | Bezeichnung | Menge Einzelpreis | G-Preis €",
  "Shop-Bestellung vom 24.09.2026",
  "81593 | Dupla Marin Coral Plugs 10 St., SB | 3,00 | 4,50 | 13,50",
  "fm15025 | Fauna Marin ELEMENTALS Trace Mn - Mangan | 4,00 | 13,50 | 54,00",
  "- 250 ml",
  "e3591100 | Eheim rapidCleaner 58 cm | 3,00 | 9,20 | 10% | 24,84",
  "ELVOO 1000 Easy-Life Voogle 1000 ml | 2,00 | 9,95 | 19,90",
  "MRROSSM ARKA myReef Rocks 9-12 cm, 20 kg | 1,00 | 47,00 | 47,00",
  "Übertrag | 159,24",
  "=== oldal vege ===",
  "Seite : | 2 von 2",
  "Artikelnr | Bezeichnung | Menge Einzelpreis | G-Preis €",
  "36273000 | Jebao EP-5.000 Förderpumpe inkl. Controller | 1,00 | 1.070,25 | 1.070,25",
  "z1 | Frachtkosten (anteilig) | 1,00 | 80,00 | 80,00",
  "Summe in €: | 1.309,49",
  "Rechnungsbetrag € | 1.309,49",
  "Zahlbar innerhalb | 7 Tagen bis zum 02.10.2026 ohne Abzüge",
  "Anschrift | Kontaktdaten | Bankverbindung",
  "Hertlein Aquaristik e.Kfr. | Telefon: 0000-0000000 | Kitalalt Bank",
  "Langenzenner Str. 10 | USt-ID: DE 123456789 | BIC XXXXDEXX",
  "=== oldal vege ===",
];
