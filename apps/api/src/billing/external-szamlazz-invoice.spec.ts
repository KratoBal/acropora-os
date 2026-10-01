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
  } = {},
) => `<?xml version="1.0" encoding="UTF-8"?>
<szamla xmlns="http://www.szamlazz.hu/szamla">
  <szallito><id>1</id><nev>Acropora Kft.</nev>
    <cim><irsz>1106</irsz><telepules>Budapest</telepules><cim>Pesti Gábor utca 35.</cim></cim>
    <adoszam>23916229-2-42</adoszam></szallito>
  <alap><id>4242</id><szamlaszam>ACRW-2026/00508</szamlaszam><gazdEsemAzon>1</gazdEsemAzon><forras>34</forras>
    <tipus>${over.tipus ?? "SZ"}</tipus><eszamla>${over.eszamla ?? "1"}</eszamla>
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
    <totalossz><netto>23000.0</netto><afa>6210.0</afa><brutto>29210.0</brutto></totalossz></osszegek>
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
    });
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
});
