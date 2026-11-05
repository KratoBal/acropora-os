import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SzamlazzFeedParseError } from "../missing-invoices/szamlazz-feed-xml.js";
import {
  EXTERNAL_KIND_LABELS,
  projectExternalInvoice,
} from "./external-szamlazz-invoice.js";

/*
  EGY KIMENŐ SZÁMLA a szamla.xsd szerint (a mezők sorrendje és fészkelése az
  XSD-é; a nevek, számok kitaláltak). Két tétel: a `tetel` ismétlődik, és ezt a
  megosztott fa-olvasó `child()` segédje hibának venné, a vetítés tehát a
  gyerekeken megy végig.
*/
const szamla = (
  over: {
    devizanem?: string;
    kelt?: string;
    tipus?: string;
    vevoNev?: string;
    eszamla?: string;
    extraAlap?: string;
    kifizetesek?: string;
  } = {},
) => `<?xml version="1.0" encoding="UTF-8"?>
<szamla xmlns="http://www.szamlazz.hu/szamla">
  <szallito><id>1</id><nev>Acropora Kft.</nev>
    <cim><irsz>1106</irsz><telepules>Budapest</telepules><cim>Pesti Gábor utca 35.</cim></cim>
    <adoszam>23916229-2-42</adoszam></szallito>
  <alap><id>4242</id><szamlaszam>ACRW-2026/00508</szamlaszam><gazdEsemAzon>1</gazdEsemAzon><forras>34</forras>
    <tipus>${over.tipus ?? "SZ"}</tipus><eszamla>${over.eszamla ?? "3"}</eszamla>
    <kelt>${over.kelt ?? "2026-09-30"}</kelt><telj>2026-09-29</telj><fizh>2026-10-08</fizh>
    <fizmod>Átutalás</fizmod><fizmodunified>átutalás</fizmodunified><keszpenz>false</keszpenz>
    <nyelv>hu</nyelv><devizanem>${over.devizanem ?? "Ft"}</devizanem><penzforg>false</penzforg>
    <kata>false</kata><katafokonyv>false</katafokonyv><teszt>false</teszt>${over.extraAlap ?? ""}</alap>
  <vevo><nev>${over.vevoNev ?? "Teszt Akvárium Bt."}</nev>
    <cim><orszag>HU</orszag><irsz>1031</irsz><telepules>Budapest</telepules><cim>Minta utca 1.</cim></cim>
    <adoszam>12345678-2-41</adoszam><lokacio>1</lokacio><privatePersonIndicator>false</privatePersonIndicator></vevo>
  <tetelek>
    <tetel><nev>Akvárium szerviz</nev><mennyiseg>2.0</mennyiseg><mennyisegiegyseg>óra</mennyisegiegyseg>
      <nettoegysegar>10000.0</nettoegysegar><afakulcs>27</afakulcs><netto>20000.0</netto><afa>5400.0</afa>
      <brutto>25400.0</brutto><sztetordering>1</sztetordering></tetel>
    <tetel><nev>Szűrőbetét</nev><mennyiseg>1.0</mennyiseg><mennyisegiegyseg>db</mennyisegiegyseg>
      <nettoegysegar>3000.0</nettoegysegar><afakulcs>27</afakulcs><netto>3000.0</netto><afa>810.0</afa>
      <brutto>3810.0</brutto><sztetordering>2</sztetordering></tetel>
  </tetelek>
  <osszegek><afakulcsossz><afakulcs>27</afakulcs><netto>23000.0</netto><afa>6210.0</afa><brutto>29210.0</brutto></afakulcsossz>
    <totalossz><netto>23000.0</netto><afa>6210.0</afa><brutto>29210.0</brutto></totalossz></osszegek>${over.kifizetesek ?? ""}
</szamla>`;

// MI PIROSÍT: ha egy mező rossz helyről jönne; ha a második tétel elveszne (a
// `child()` ismétlésnél dob); ha a „Ft” nem HUF-ként, vagy az időzónás kelt nem
// napként jönne; ha egy hiányzó kötelező mező fél számlát adna a listára.
describe("projectExternalInvoice", () => {
  it("reads the list and detail fields from szamla.xsd, every line in order", () => {
    assert.deepEqual(projectExternalInvoice(szamla()), {
      externalId: "4242",
      kindCode: "SZ",
      documentNumber: "ACRW-2026/00508",
      electronic: true,
      issueDate: "2026-09-30",
      fulfillmentDate: "2026-09-29",
      dueDate: "2026-10-08",
      paymentMethod: "Átutalás",
      paymentMethodUnified: "átutalás",
      orderNumber: null,
      currency: "HUF",
      customerName: "Teszt Akvárium Bt.",
      customerTaxNumber: "12345678-2-41",
      customerAddress: "1031 Budapest Minta utca 1.",
      netAmount: "23000.0",
      vatAmount: "6210.0",
      grossAmount: "29210.0",
      lines: [
        {
          name: "Akvárium szerviz",
          quantity: "2.0",
          unit: "óra",
          unitNet: "10000.0",
          vatRate: "27",
          netAmount: "20000.0",
          vatAmount: "5400.0",
          grossAmount: "25400.0",
        },
        {
          name: "Szűrőbetét",
          quantity: "1.0",
          unit: "db",
          unitNet: "3000.0",
          vatRate: "27",
          netAmount: "3000.0",
          vatAmount: "810.0",
          grossAmount: "3810.0",
        },
      ],
      cancelled: false,
      paymentsKnown: false,
      payments: [],
      paidAmount: "0.00",
      lastPaymentDate: null,
    });
  });

  // MI PIROSÍT: ha a kifizetés elveszne vagy rossz mezőből jönne; ha az összeg
  // nem a kifizetések összege, vagy a dátum nem a legkésőbbi; ha egy hibás
  // kifizetés csendben nullának számítana.
  it("reads the payments the re-sent invoice carries, their sum and the latest day (acrobot 25894)", () => {
    // az élesen látott alak: a Számlázz.hu saját banki párosítása, és egy utánvét
    const p = projectExternalInvoice(
      szamla({
        kifizetesek: `<kifizetesek>
    <kifizetes><datum>2026-09-28</datum><jogcim>átutalás</jogcim><osszeg>20000.0</osszeg>
      <megjegyzes>Automatikus banki tranzakció párosítás</megjegyzes><bankszamlaszam>11709002-20624460</bankszamlaszam>
      <banktranzid>77877311</banktranzid></kifizetes>
    <kifizetes><datum>2026-09-17+02:00</datum><jogcim>utánvét</jogcim><osszeg>9210.5</osszeg></kifizetes>
  </kifizetesek>`,
      }),
    );
    assert.deepEqual(p.payments, [
      {
        date: "2026-09-28",
        title: "átutalás",
        amount: "20000.0",
        note: "Automatikus banki tranzakció párosítás",
        bankTransactionId: "77877311",
      },
      {
        date: "2026-09-17",
        title: "utánvét",
        amount: "9210.5",
        note: null,
        bankTransactionId: null,
      },
    ]);
    assert.deepEqual(
      [p.paymentsKnown, p.paidAmount, p.lastPaymentDate],
      [true, "29210.50", "2026-09-28"],
    );
    assert.throws(
      () =>
        projectExternalInvoice(
          szamla({
            kifizetesek:
              "<kifizetesek><kifizetes><datum>2026-09-28</datum><jogcim>átutalás</jogcim><osszeg>sok</osszeg></kifizetes></kifizetesek>",
          }),
        ),
      SzamlazzFeedParseError,
    );
  });

  it("takes the schema's other forms: a dated timezone, a paper invoice, a storno flag, an unknown kind", () => {
    const p = projectExternalInvoice(
      szamla({
        kelt: "2026-09-30+02:00",
        eszamla: "0",
        tipus: "XY",
        devizanem: "eur",
        extraAlap: "<sztornozott>true</sztornozott>",
      }),
    );
    assert.deepEqual(
      [p.issueDate, p.electronic, p.kindCode, p.currency, p.cancelled],
      ["2026-09-30", false, "XY", "EUR", true],
    );
  });

  // MI PIROSÍT: ha a rendelésszám vagy az egységesített mód nem az `alap`-ból
  // jönne; ha a hiányzó rendelésszám üres szöveg lenne `null` helyett; ha az
  // egységesített mód átíródna (a döntés az osztályozóé, nem a vetítésé).
  it("reads the order number and the unified payment method as they stand (acrobot 25964)", () => {
    const xml = szamla({
      extraAlap: "<rendelesszam>47679-665706</rendelesszam>",
    }).replace(
      "<fizmodunified>átutalás</fizmodunified>",
      "<fizmodunified>egyéb</fizmodunified>",
    );
    const projection = projectExternalInvoice(xml);
    assert.deepEqual(
      [projection.orderNumber, projection.paymentMethodUnified],
      ["47679-665706", "egyéb"],
    );
    assert.equal(projectExternalInvoice(szamla()).orderNumber, null);
  });

  it("refuses a half invoice: a missing customer name, a broken date, a foreign root", () => {
    for (const bad of [
      szamla({ vevoNev: "" }),
      szamla({ kelt: "2026-02-30" }),
      szamla()
        .replace(/<szamla /, "<szamlabe ")
        .replace("</szamla>", "</szamlabe>"),
    ])
      assert.throws(() => projectExternalInvoice(bad), SzamlazzFeedParseError);
  });

  it("labels the eight documented kinds", () => {
    assert.deepEqual(Object.keys(EXTERNAL_KIND_LABELS).sort(), [
      "D",
      "ES",
      "HS",
      "JS",
      "SL",
      "SS",
      "SZ",
      "VS",
    ]);
  });

  /**
   * AZ `eszamla` EGÉSZ KÓD, NEM LOGIKAI MEZŐ (docs.szamlazz.hu/penzugyi-adatkapcsolat/kimeno-szamlak: 0 nem számla, 1 papír,
   * 2 és 3 e-számla; éles mérés 2026-11-05: két E-CRPR e-számla kódja 3 volt, és „Papír alapú” lett). MI PIROSÍT: ha az
   * `1` (papír) elektronikus; ha a 2 vagy a 3 papír; ha a `0` elektronikus; ha egy `true` vagy ismeretlen szöveg
   * elektronikus; ha a szám-előtag (E-) dönt a kód helyett.
   */
  it("reads eszamla as the invoice-format code: 2 and 3 are electronic, 0 and 1 and anything else are not", () => {
    const electronic = (eszamla: string, documentNumber?: string) =>
      projectExternalInvoice(
        documentNumber
          ? szamla({ eszamla }).replace("ACRW-2026/00508", documentNumber)
          : szamla({ eszamla }),
      ).electronic;
    for (const code of ["2", "3", " 3 "])
      assert.equal(electronic(code), true, code);
    for (const code of ["0", "1", "", "true", "igen"])
      assert.equal(electronic(code), false, code);
    // the code decides, the number prefix does not
    assert.equal(electronic("1", "E-CRPR-2026-14"), false);
    assert.equal(electronic("3", "ACRW-2026/00545"), true);
  });
});
