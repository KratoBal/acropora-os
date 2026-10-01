import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SzamlazzFeedParseError } from "../missing-invoices/szamlazz-feed-xml.js";
import {
  IncomingTestInvoice,
  projectIncomingInvoice,
} from "./incoming-szamlazz-invoice.js";

/*
  EGY BEJÖVŐ SZÁMLA a szamlabe.xsd szerint (exchange/szamlazz-xsd, 2026-10-01; a
  mezők sorrendje és fészkelése az XSD-é, a nevek és számok kitaláltak). Euró,
  árfolyammal, két tétellel, két ÁFA-sorral és két kifizetéssel: mind a négy
  ismétlődő elem, és a megosztott fa-olvasó `child()` segédje ismétlésnél dob.
*/
const szamlabe = (
  over: {
    devizanem?: string;
    kelt?: string;
    teszt?: string;
    kifizetesek?: string;
    szallitoNev?: string;
    alapVeg?: string;
  } = {},
) => `<?xml version="1.0" encoding="UTF-8"?>
<szamlabe xmlns="http://www.szamlazz.hu/szamlabe">
  <szallito><id>1</id>${over.szallitoNev ?? "<nev>Korall Import GmbH</nev>"}
    <cim><orszag>AT</orszag><irsz>1010</irsz><telepules>Wien</telepules><cim>Ringstraße 1.</cim></cim>
    <adoszam>12345678-2-41</adoszam><adoszameu>ATU12345678</adoszameu>
    <bank><nev>Minta Bank</nev><bankszamla>AT61 1904 3002 3457 3201</bankszamla></bank></szallito>
  <alap><id>5150</id><szamlaszam>KI-2026/77</szamlaszam><gazdEsemAzon>1</gazdEsemAzon><tipus>HS</tipus>
    <eszamla>0</eszamla><hivszamlaszam>KI-2026/70</hivszamlaszam><hivdijbekszam>DB-2026/3</hivdijbekszam>
    <kelt>${over.kelt ?? "2026-09-28"}</kelt><telj>2026-09-25</telj><fizh>2026-10-12</fizh>
    <fizmod>Átutalás</fizmod><fizmodunified>átutalás</fizmodunified><keszpenz>false</keszpenz>
    <rendelesszam>PO-881</rendelesszam><nyelv>de</nyelv><devizanem>${over.devizanem ?? "EUR"}</devizanem>
    <devizabank>MNB</devizabank><devizaarf>391.25</devizaarf><megjegyzes>Szállítás két részletben</megjegyzes>
    <penzforg>false</penzforg><kata>false</kata><katafokonyv>false</katafokonyv>
    <teszt>${over.teszt ?? "false"}</teszt>${over.alapVeg ?? "<sztornozott>true</sztornozott>"}</alap>
  <vevo><nev>Acropora Kft.</nev>
    <cim><irsz>1106</irsz><telepules>Budapest</telepules><cim>Pesti Gábor utca 35.</cim></cim>
    <adoszam>23916229-2-42</adoszam><lokacio>1</lokacio></vevo>
  <tetelek>
    <tetel><nev>Élő korall</nev><mennyiseg>3</mennyiseg><mennyisegiegyseg>db</mennyisegiegyseg>
      <nettoegysegar>20</nettoegysegar><afakulcs>27</afakulcs><netto>60</netto><afa>16.2</afa>
      <brutto>76.2</brutto><sztetordering>1</sztetordering></tetel>
    <tetel><nev>Szállítás</nev><mennyiseg>1</mennyiseg><mennyisegiegyseg>db</mennyisegiegyseg>
      <nettoegysegar>10</nettoegysegar><afakulcs>AAM</afakulcs><netto>10</netto><afa>0</afa>
      <brutto>10</brutto><sztetordering>2</sztetordering></tetel>
  </tetelek>
  <osszegek>
    <afakulcsossz><afakulcs>27</afakulcs><netto>60</netto><afa>16.2</afa><brutto>76.2</brutto></afakulcsossz>
    <afakulcsossz><afakulcs>AAM</afakulcs><netto>10</netto><afa>0</afa><brutto>10</brutto></afakulcsossz>
    <totalossz><netto>70</netto><afa>16.2</afa><brutto>86.2</brutto></totalossz></osszegek>
  ${
    over.kifizetesek ??
    `<kifizetesek>
    <kifizetes><datum>2026-09-30</datum><jogcim>átutalás</jogcim><osszeg>50</osszeg>
      <megjegyzes>első részlet</megjegyzes><banktranzid>9001</banktranzid></kifizetes>
    <kifizetes><datum>2026-10-02</datum><jogcim>átutalás</jogcim><osszeg>36.2</osszeg></kifizetes>
  </kifizetesek>`
  }
</szamlabe>`;

// MI PIROSÍT: ha egy mező rossz helyről jönne (a szállító és a vevő cím-eleme
// egyforma nevű); ha egy ismétlődő elem második példánya elveszne; ha a hiányzó
// `kifizetesek` „nincs fizetve”-nek olvasódna a „nincs adat” helyett; ha a „Ft”
// nem HUF-ként, vagy az időzónás kelt nem napként jönne; ha a teszt-számla vagy
// egy kötelező mező nélküli számla fél sorként vetülne.
describe("projectIncomingInvoice", () => {
  it("reads every list and detail field from szamlabe.xsd, the repeated ones in order", () => {
    assert.deepEqual(projectIncomingInvoice(szamlabe()), {
      externalId: "5150",
      kindCode: "HS",
      documentNumber: "KI-2026/77",
      electronic: false,
      issueDate: "2026-09-28",
      fulfillmentDate: "2026-09-25",
      dueDate: "2026-10-12",
      paymentMethod: "Átutalás",
      currency: "EUR",
      exchangeRate: "391.25",
      exchangeBank: "MNB",
      supplierName: "Korall Import GmbH",
      supplierTaxNumber: "12345678-2-41",
      supplierEuTaxNumber: "ATU12345678",
      supplierAddress: "AT 1010 Wien Ringstraße 1.",
      supplierBankAccount: "AT61 1904 3002 3457 3201",
      buyerName: "Acropora Kft.",
      buyerTaxNumber: "23916229-2-42",
      netAmount: "70",
      vatAmount: "16.2",
      grossAmount: "86.2",
      lines: [
        {
          name: "Élő korall",
          quantity: "3",
          unit: "db",
          unitNet: "20",
          vatRate: "27",
          netAmount: "60",
          vatAmount: "16.2",
          grossAmount: "76.2",
        },
        {
          name: "Szállítás",
          quantity: "1",
          unit: "db",
          unitNet: "10",
          vatRate: "AAM",
          netAmount: "10",
          vatAmount: "0",
          grossAmount: "10",
        },
      ],
      vatSummary: [
        {
          vatRate: "27",
          netAmount: "60",
          vatAmount: "16.2",
          grossAmount: "76.2",
        },
        { vatRate: "AAM", netAmount: "10", vatAmount: "0", grossAmount: "10" },
      ],
      paymentsKnown: true,
      payments: [
        {
          date: "2026-09-30",
          title: "átutalás",
          amount: "50",
          note: "első részlet",
          bankTransactionId: "9001",
        },
        {
          date: "2026-10-02",
          title: "átutalás",
          amount: "36.2",
          note: null,
          bankTransactionId: null,
        },
      ],
      note: "Szállítás két részletben",
      orderNumber: "PO-881",
      referencedInvoiceNumber: "KI-2026/70",
      referencedProformaNumber: "DB-2026/3",
      cancelled: true,
    });
  });

  it("a missing kifizetesek element is unknown, not unpaid", () => {
    const projection = projectIncomingInvoice(
      szamlabe({ kifizetesek: "", alapVeg: "" }),
    );
    assert.deepEqual(
      [projection.paymentsKnown, projection.payments, projection.cancelled],
      [false, [], false],
    );
  });

  it("reads Ft as HUF and a zoned kelt as its day", () => {
    const projection = projectIncomingInvoice(
      szamlabe({ devizanem: "Ft", kelt: "2026-09-28+02:00" }),
    );
    assert.deepEqual(
      [projection.currency, projection.issueDate],
      ["HUF", "2026-09-28"],
    );
  });

  it("a test invoice is not projected, a supplier without a name is refused", () => {
    assert.throws(
      () => projectIncomingInvoice(szamlabe({ teszt: "true" })),
      IncomingTestInvoice,
    );
    assert.throws(
      () => projectIncomingInvoice(szamlabe({ szallitoNev: "" })),
      SzamlazzFeedParseError,
    );
  });
});
