/**
 * A Menzel-számla PDF-jének SOROKRA bontott szövege, ahogy a `pdfTextLines`
 * adja: a cellák " | " jellel elválasztva. A szerkezet és a nehéz esetek az
 * egyetlen valódi számláé (20260404, 2026-05-15, `exchange/beszallitok/menzel`),
 * a tételek annak egy része; a vevő, a kapcsolattartó, az ügyintéző, a
 * megbízás-hivatkozás és a vevő adószáma kitalált. A szállító SEPA
 * hitelező-azonosítója a valódi (nyilvános, minden terhelésen szerepel): az
 * illesztő erről ismer rá. A tételek neve nyilvános katalógusnév.
 *
 * Benne van minden mért nehéz eset: a kedvezmény-cella hol van, hol nincs; a
 * két cellára eső megnevezés ("Pachycerianthus spec. med | lila", "Ableger |
 * aus DE-"); a következő sorra törő név ("Symbiosegrundel", "E00923/23"); az
 * "(A)" jelölés saját cellában, a MwSt. előtt és a folytató sorban; a
 * CITES-szám sora; az "Übertrag" a laphatáron; a fejléc minden lapon.
 */
export const MENZEL_PDF_LINES = [
  "Kitalalt Kft.",
  "Herrn Kitalalt Vevo",
  "Kitalalt utca 1",
  "0000 KITALALT",
  "UNGARN",
  "Datum: | 15.05.2026",
  "Rechnungs-Nr.: | 20260404",
  "Mandatsreferenz: | 9999",
  "Sachbearbeiter/-in: | Kitalalt Ugyintezo",
  "USt-ID-Nr.: | HU99999999",
  "Gläubiger-Identifikationsnummer:",
  "Rechnung | DE60ZZZ00002702958",
  "zum Auftrag: | 15% Trade Fair Discount",
  "nachfolgend aufgeführte Waren und Dienstleistungen haben Sie gemäß unserer Lieferbedingungen erhalten. Alle Waren",
  "bleiben bis zur vollständigen Bezahlung unser Eigentum!",
  "Anzahl | Artnr. | Bezeichnung | MwSt. | Listenpreis | Rabatt | Einzelpreis | Gesamtpreis",
  "4 | 104-0100 | Conomurex luhuanus | 0% | 4,90 € | 15% | 4,17 € | 16,68 €",
  "2 | 108-0211-3 | Pachycerianthus spec. med | lila | 0% | 22,00 € | 15% | 18,70 € | 37,40 €",
  "2 | 007-0010-9 | Amblyeleotris aurora lg mit | 0% | 40,45 € | 15% | 34,38 € | 68,76 €",
  "Symbiosegrundel",
  "10 | 100-0070-2 | Lysmata amboinensis sm-med | 0% | 11,45 € | 15% | 9,73 € | 97,30 €",
  "Übertrag | 220,14 €",
  "=== oldal vege ===",
  "Rechnungs-Nr.: | 20260404 | Seite 2 von 3",
  "Anzahl | Artnr. | Bezeichnung | MwSt. | Listenpreis | Rabatt | Einzelpreis | Gesamtpreis",
  "Übertrag | 220,14 €",
  "3 | 123-0012-1a3u | Tridacna crocea 3-4cm -Ultra Grade- | 0% | 57,50 € | 57,50 € | 172,50 €",
  "g | (A) ab 3 Stück/p.St.",
  "Cites Nummer: DE-00219/26",
  '2 | 127-0040-4a | Menella spec. "lila" med-lg | (A) | 0% | 59,00 € | 59,00 € | 118,00 €',
  "1 | 120-0001-a | Cypastrea spp. AC Ableger | aus DE- | 0% | 39,00 € | 15% | 33,15 € | 33,15 €",
  "E00923/23",
  "3 | 400-0001-1 | OCEAMO Lab Classic | 0% | 22,90 € | 22,90 € | 68,70 €",
  "Meerwasseranalyse | (A)",
  "Übertrag | 612,49 €",
  "=== oldal vege ===",
  "Rechnungs-Nr.: | 20260404 | Seite 3 von 3",
  "Anzahl | Artnr. | Bezeichnung | MwSt. | Listenpreis | Rabatt | Einzelpreis | Gesamtpreis",
  "Übertrag | 612,49 €",
  "Summe | 612,49 €",
  "Zu zahlender Betrag | 612,49 €",
  "Diese Rechnung enthält steuerfreie innergemeinschaftliche Lieferungen nach §4 Nr. 1b UStG, daher ist keine",
  "Umsatzsteuer enthalten und ausgewiesen.",
  "=== oldal vege ===",
];
