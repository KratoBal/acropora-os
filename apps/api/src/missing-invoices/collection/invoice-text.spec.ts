import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeName } from "../missing-invoice-matching.js";
import {
  bankReference,
  cardPaymentMatch,
  customerIds,
  largestMoney,
  type CardDebit,
  looksLikeBankAccount,
  looksLikeInvoice,
  looksLikeOtherDocument,
  looksLikeProforma,
  looksLikeProformaLetter,
  looksLikeReminder,
  otherDocumentFileName,
  readInvoiceText,
  hasNoTextLayer,
  knownNumberInText,
  labelledTotal,
  withKnownNumber,
  withLabelledTotal,
  type KnownInvoiceNumber,
} from "./invoice-text.js";

/**
 * SZINTETIKUS SOROK: a valódi mintán mért kalibráció a következő szelet. Ezek
 * a tesztek azt tartják, amit a szabály tud, nem azt, hogy a valóságban mennyit
 * talál.
 */
describe("looksLikeInvoice", () => {
  it("takes the invoice word on its own, not inside the bank account word", () => {
    assert.equal(looksLikeInvoice("SZÁMLA\nSorszám: SZ-1"), true);
    assert.equal(looksLikeInvoice("Invoice #123"), true);
    assert.equal(
      looksLikeInvoice("Szerződés\nBankszámlaszám: 11773016-11111018"),
      false,
    );
    assert.equal(looksLikeProforma("DÍJBEKÉRŐ\nSorszám: D-1"), true);
    assert.equal(looksLikeProforma("Számla\nSorszám: SZ-1"), false);
  });

  /*
    A CÍM DÖNT (acrobot 27064, mérve 2026-10-06 élesen, a sorok az UNAS aláírt
    e-számlájából). MI PIROSÍT: ha a lejjebb álló „Díjbekérő” oszlopfejléc
    díjbekérővé teszi a magát számlának mondó dokumentumot; ha a címben álló
    díjbekérő szó nem dönt; ha cím nélkül a régi teljes-szöveges szabály kiesik.
  */
  it("lets the title decide: an invoice that names its pro forma in a column is still an invoice", () => {
    const unas = [
      "FIZETVE | Számla",
      "Sorszám: | UO-418953/2026",
      "Eladó: | Vevő:",
      "UNAS Online Kft. | Acropora Kft.",
      "Bank: | CIB Bank",
      "Bankszámla: | 10700426-46856700-51100005",
      "Teljesítés | Kelt | Fizetési határidő | Oldal | Díjbekérő",
    ].join("\n");
    assert.equal(looksLikeProforma(unas), false);
    // a cím díjbekérőnek mondja magát: az dönt (Amblard, „Facture provisoire”)
    assert.equal(
      looksLikeProforma(
        "F2602896 $ Facture provisoire $ 485,40\nInvoice n°: | Billing address",
      ),
      true,
    );
    // cím nélkül a teljes szöveg dönt, mint eddig
    assert.equal(
      looksLikeProforma(
        [
          "Szállító Kft.",
          "Sorszám: D-7",
          ...Array(10).fill("tétel"),
          "Díjbekérő",
        ].join("\n"),
      ),
      true,
    );
    // a „Bankszámla” cella nem cím
    assert.equal(
      looksLikeProforma("Bankszámla: | 1170\nSorszám: D-8\nDíjbekérő"),
      true,
    );
  });
});

describe("readInvoiceText", () => {
  const SUPPLIER = "Eladó: Szállító Kft. Adószám: 12345678-2-42";
  const US = "Vevő: Acropora Kft. Adószám: 23916229-2-13";

  it("takes the supplier's NAV number from the text, whatever the layout, when no label says otherwise", () => {
    assert.deepEqual(
      readInvoiceText([SUPPLIER, US, "Kelt: 2026.08.03.", "KS26/09229"], {
        navNumbers: (base) =>
          base === "12345678" ? ["KS26/09229", "KS26/0922"] : [],
      }),
      {
        invoiceNumber: "KS26/09229",
        numberFrom: "NAV",
        supplierTaxNumber: "12345678-2-42",
      },
    );
  });

  it("lets the labelled number decide when the text lists other invoices of the supplier (the MVM bill)", () => {
    const lines = [
      SUPPLIER,
      US,
      "Számla sorszáma: 845114371429",
      "Korábbi számlák sorszáma és végösszege",
      "846602789443 | 267.429",
    ];
    const both = ["846602789443", "845114371429"];
    assert.deepEqual(readInvoiceText(lines, { navNumbers: () => both }), {
      invoiceNumber: "845114371429",
      numberFrom: "NAV",
      supplierTaxNumber: "12345678-2-42",
    });
    // a saját száma még nincs a NAV-ban, a hivatkozott régi igen: az nem találat
    assert.deepEqual(
      readInvoiceText(lines, { navNumbers: () => ["846602789443"] }),
      {
        invoiceNumber: "845114371429",
        numberFrom: "LABEL",
        supplierTaxNumber: "12345678-2-42",
      },
    );
  });

  /*
    A MÓDOSÍTÓ SZÁMLA AZ EREDETI SZÁMÁT IS VISELI (kártya 37b8643d, mérve
    2026-10-06 élesen, a sorok a KS2605898.pdf és a 4934_26_szamla.pdf
    szövegéből). A régi kód az „Eredeti számla száma” címkéből az EREDETI
    számot adta, a NAV megerősítette, és a módosító az eredetivel vonódott össze.
  */
  it("never takes the referenced original's number for a modifying invoice's own (the Fluidra credit note)", () => {
    const lines = [
      "KS26/05898 | 2/1. oldal",
      SUPPLIER,
      US,
      "KS26/05898 | 60 napos átutalás",
      "Eredeti számla száma: KS26/05848 Teljesítés kelte: 2026.06.15.",
      "Fizetendő: | -76.096 | Ft",
    ];
    const hints = { fileName: "KS2605898.pdf" };
    // az eredeti a NAV-ban van, a módosító még nincs: nem az eredeti a válasz
    assert.deepEqual(
      readInvoiceText(lines, { ...hints, navNumbers: () => ["KS26/05848"] }),
      {
        invoiceNumber: "KS2605898",
        numberFrom: "FILE_NAME",
        supplierTaxNumber: "12345678-2-42",
      },
    );
    // ha már mindkettő a NAV-ban van, a saját száma az egyetlen találat
    assert.deepEqual(
      readInvoiceText(lines, {
        ...hints,
        navNumbers: () => ["KS26/05848", "KS26/05898"],
      }),
      {
        invoiceNumber: "KS26/05898",
        numberFrom: "NAV",
        supplierTaxNumber: "12345678-2-42",
      },
    );
  });

  it("reads the own number of a modifying invoice when the original stands under its own label (the Menet-Trend case)", () => {
    const lines = [
      SUPPLIER,
      US,
      "Számlaszám: | 4934/26",
      "Módosított számla: | 4867/26",
      "Fizetendő | : | -167 478 Ft",
    ];
    assert.deepEqual(
      readInvoiceText(lines, { navNumbers: () => ["4867/26"] }),
      {
        invoiceNumber: "4934/26",
        numberFrom: "LABEL",
        supplierTaxNumber: "12345678-2-42",
      },
    );
    // a hivatkozás címkéje a sorszám-címkét sem adja át az eredetinek
    assert.deepEqual(
      readInvoiceText(
        [
          SUPPLIER,
          US,
          "Helyesbített számla sorszáma: 4867/26",
          "Sorszám: 4934/26",
        ],
        { navNumbers: () => ["4867/26"] },
      ),
      {
        invoiceNumber: "4934/26",
        numberFrom: "LABEL",
        supplierTaxNumber: "12345678-2-42",
      },
    );
  });

  it("reads the number next to its label, and never a bank account for one", () => {
    assert.deepEqual(
      readInvoiceText([
        SUPPLIER,
        US,
        "Bankszámlaszám: 11709002-20624460-00000000",
        "Számla sorszáma: SZ-2026/00123",
      ]),
      {
        invoiceNumber: "SZ-2026/00123",
        numberFrom: "LABEL",
        supplierTaxNumber: "12345678-2-42",
      },
    );
    assert.equal(
      readInvoiceText(["Számlaszám: 11709002-20624460-00000000"]).invoiceNumber,
      null,
    );
    // a címke önálló szó: a „bankszámlaszám” utáni érték nem számlaszám
    assert.equal(
      readInvoiceText(["Bankszámlaszám: 12345678"]).invoiceNumber,
      null,
    );
  });

  it("takes a number from the file name only when the text holds it too", () => {
    assert.deepEqual(
      readInvoiceText([SUPPLIER, "FoxPost számla", "FX01015386"], {
        fileName: "FX01015386.pdf",
      }).invoiceNumber,
      "FX01015386",
    );
    assert.equal(
      readInvoiceText([SUPPLIER, "számla"], { fileName: "FX01015386.pdf" })
        .invoiceNumber,
      null,
    );
  });

  it("prefers the full Hungarian tax number to an id fragment that looks European (FleetCor)", () => {
    assert.equal(
      readInvoiceText([
        "Ügyfélazonosító: HU00008659",
        "Kibocsátó: FleetCor Hungary Kft. Adószám: 25103272-2-42",
        "Vevő: Acropora Kft. Adószám: 23916229-2-42",
      ]).supplierTaxNumber,
      "25103272-2-42",
    );
  });

  it("does not take a bank code or a word for a VAT number", () => {
    assert.equal(
      readInvoiceText([
        "BIC: DRESDEFF510",
        "ORDER CONFIRMATION",
        "VAT: DE152405660",
      ]).supplierTaxNumber,
      "DE152405660",
    );
  });
});

describe("cardPaymentMatch: a NAV-less invoice and the card payment(s) it was paid with (acrobot 25666, 25673, 25691)", () => {
  const word = (name: string) =>
    normalizeName(name)
      .split(" ")
      .find((w) => w.length >= 4) ?? null;
  // a valos Hetzner-szamla sorai (2026-08-05, 081001079225)
  const hetzner = [
    "Hetzner Online GmbH • Industriestr. 25 • 91710 Gunzenhausen • Germany",
    "Acropora Kft. | Tel.: +49 9831 505-0",
    "VAT Reg. No.: HU23916229",
    "Invoice no.: 081001079225",
    "Total | € 7.04 | € 0.00 | € 7.04",
  ];
  // a valos Kia Charge-szamla sorai (2026-07, KHU00014089)
  const kia = [
    "Digital Charging Solutions GmbH Mies-van-der-Rohe-Straße 6 D-80807 München",
    "Acropora Kft. | HÉA azonosító szám DE312237805",
    "Havi díj ebből 2026. júl. 1. - 2026. júl. 31. | 1518,00 HUF | 1518,00 HUF",
    "Összes töltés száma | 1 | 34,625 kWh | 7607,00 HUF | 7607,00 HUF",
    "Teljes összeg* | 9125,00 HUF | 9125,00 HUF",
  ];
  let n = 0;
  const card = (
    counterpartyName: string,
    amount: string,
    original: CardDebit["original"] = null,
    bookingDate = "2026-08-07",
  ): CardDebit => ({
    id: `k${++n}`,
    bookingDate,
    counterpartyName,
    amount,
    currency: "HUF",
    original,
  });
  const dcs = (amount: string, bookingDate = "2026-08-07") =>
    card("Digital Charging Solut", amount, null, bookingDate);

  it("takes the payment whose partner word and amount (the original or the booked one) are in the text", () => {
    const h = card("HETZNER ONLINE GMBH", "2690", {
      amount: "7.04",
      currency: "EUR",
    });
    assert.deepEqual(
      cardPaymentMatch(
        hetzner,
        [
          h,
          card("HETZNER ONLINE GMBH", "17113", {
            amount: "46.64",
            currency: "EUR",
          }),
          card("Tesla Hungary Korlatol", "2449"),
        ],
        word,
      ),
      {
        amount: "7.04",
        currency: "EUR",
        partner: "HETZNER ONLINE GMBH",
        debitIds: [h.id],
      },
    );
  });

  it("takes nothing when the amount, the partner word, or the uniqueness is missing, or the partner is us", () => {
    const hetznerCard = (amount: string) =>
      card("HETZNER ONLINE GMBH", "999", { amount, currency: "EUR" });
    assert.equal(
      cardPaymentMatch(hetzner, [hetznerCard("7.05")], word, "2026-08-05"),
      null,
    );
    assert.equal(
      cardPaymentMatch(
        hetzner,
        [
          card("Tesla Hungary Korlatol", "999", {
            amount: "7.04",
            currency: "EUR",
          }),
        ],
        word,
        "2026-08-05",
      ),
      null,
    );
    // két egyenlő fizetés: a végösszeghez is kettő illik, nem választunk
    assert.equal(
      cardPaymentMatch(
        hetzner,
        [hetznerCard("7.04"), hetznerCard("7.04")],
        word,
        "2026-08-05",
      ),
      null,
    );
    // a saját átvezetésünk neve minden nekünk szóló számlán ott van
    assert.equal(
      cardPaymentMatch(
        hetzner,
        [card("ACROPORA KFT EUR", "999", { amount: "7.04", currency: "EUR" })],
        word,
        "2026-08-05",
      ),
      null,
    );
  });

  it("Kia July: the monthly fee is another month's payment, so the total (the largest money, not the kWh) decides", () => {
    const july = dcs("9125", "2026-08-07");
    const june = dcs("1518", "2026-07-06");
    // az első út kettőt talál; dátum nélkül nem dönt
    assert.equal(cardPaymentMatch(kia, [june, july], word), null);
    assert.deepEqual(cardPaymentMatch(kia, [june, july], word, "2026-08-01"), {
      amount: "9125.00",
      currency: "HUF",
      partner: "Digital Charging Solut",
      debitIds: [july.id],
    });
  });

  it("Kia August: the total is the sum of two card payments", () => {
    const august = [
      "Digital Charging Solutions GmbH",
      "Acropora Kft.",
      "Havi díj | 1518,00 HUF",
      "Teljes összeg* | 40086,00 HUF | 40086,00 HUF",
    ];
    const a = dcs("21279", "2026-09-10");
    const b = dcs("18807", "2026-09-10");
    const other = dcs("6840", "2026-09-12");
    assert.deepEqual(
      cardPaymentMatch(august, [a, b, other], word, "2026-09-01")?.debitIds,
      [a.id, b.id],
    );
    // a dátumablakon kívül (a számla előtt több mint 15 nappal) nem illik
    assert.equal(
      cardPaymentMatch(
        august,
        [dcs("21279", "2026-08-10"), dcs("18807", "2026-08-10")],
        word,
        "2026-09-01",
      ),
      null,
    );
    // ha két különböző halmaz is kiadja, nem döntünk
    assert.equal(
      cardPaymentMatch(
        august,
        [a, b, dcs("21279", "2026-09-11"), dcs("18807", "2026-09-12")],
        word,
        "2026-09-01",
      ),
      null,
    );
  });

  it("the largest money needs its currency on the same line (Anthropic: a tax number above an EUR line)", () => {
    assert.deepEqual(largestMoney("VAT HU23916229\nEUR 180.00\n34,625 kWh"), {
      cents: 18000,
      currency: "EUR",
    });
  });

  it("a monthly summary is tied to its total, never to its largest line (Parkl, 2026-08)", () => {
    const parkl = [
      "Parkl Digital Technologies Kft.",
      "Acropora Kft.",
      "2026.08.04 | parkolás | 11 170",
      "2026.08.20 | parkolás | 6 900",
      "Fizetendő összesen: 21 699 HUF",
    ];
    const payment = (amount: string, day: string) =>
      card("SIMPLEP*PARKL.NET", amount, null, day);
    // a fizetések a számla előtt: a végösszeghez nincs ablakbeli halmaz
    assert.equal(
      cardPaymentMatch(
        parkl,
        [
          payment("11170", "2026-08-05"),
          payment("6900", "2026-08-21"),
          payment("3629", "2026-08-25"),
        ],
        word,
        "2026-09-01",
      ),
      null,
    );
  });
});

describe("contracts, offers and customs declarations are not invoices (acrobot 25784)", () => {
  it("by the title: the kind alone, or the kind and its number", () => {
    for (const title of [
      "ADÁSVÉTELI SZERZŐDÉS",
      "Vállalkozási keretszerződés",
      "Árajánlat | AJ26-U60-01170",
      "Ajánlat",
      "Quotation #Q-2026/0412",
      "Megállapodás",
    ])
      assert.equal(
        looksLikeOtherDocument(["Acropora Kft.", title, "szöveg"], "a.pdf"),
        true,
        title,
      );
    // a megnevezés előtt más szó áll: ez már nem cím
    assert.equal(
      looksLikeOtherDocument(["Import árunyilatkozat alapján"], "a.pdf"),
      false,
    );
  });

  it("by the file name, also decomposed (NFD) or written as one camelCase word", () => {
    for (const name of [
      "Szerződés_FÁNK_Homokszűrő 2026 aláírásra.pdf",
      "Szerződés_FÁNK_Homokszűrő 2026 aláírásra.pdf".normalize("NFD"),
      "Árajánlat AJ26-U60-01170.pdf",
      "26HU123 árunyilatkozat.frx.pdf",
      "Angebot_4711.pdf",
      "mycarAjanlat_AMC297489479.pdf",
    ])
      assert.equal(otherDocumentFileName(name), true, name);
    for (const name of ["inv26007910.pdf", "Szamla_2026-09.pdf", null])
      assert.equal(otherDocumentFileName(name), false, String(name));
  });

  it("an invoice that names its offer or its contract is still an invoice", () => {
    assert.equal(
      looksLikeOtherDocument(
        [
          "SZÁMLA",
          "Számlaszám: KS26/08132",
          "Ajánlat száma: AJ26-U60-01170",
          "Szerződés: 2026/14",
          "Megállapodás:",
          "2026/15",
          "a szerződés szerinti díj",
        ],
        "KS26_08132.pdf",
      ),
      false,
    );
    // a cím csak az első sorokban számít
    const late = Array.from({ length: 20 }, (_, i) =>
      i === 15 ? "Árajánlat" : "SZÁMLA",
    );
    assert.equal(looksLikeOtherDocument(late, "szamla.pdf"), false);
  });

  it("a facture provisoire is a proforma", () => {
    assert.equal(looksLikeProforma("FACTURE PROVISOIRE N° 2026-118"), true);
  });
});

describe("a pro forma never goes to the letter classifier (acrobot 25840)", () => {
  it("by its header, its PI number (Cyrillic \u0420 too) or its file name", () => {
    // a Waterro-alak: a PDF a számot cirill \u0420-vel hozta
    const waterro = [
      "CONTRACT/PROFORMA-INVOICE",
      "number: | \u0420I-WR26-0104",
      "Seller: | SIA Waterro | Buyer: | Acropora Kft.",
    ];
    assert.equal(looksLikeProformaLetter(waterro, "doc.pdf"), true);
    assert.equal(
      looksLikeProformaLetter(
        ["CONTRACT", "number: | \u0420I-WR26-0104"],
        "doc.pdf",
      ),
      true,
    );
    assert.equal(
      looksLikeProformaLetter(["CONTRACT", "number: | PI-2026-17"], "doc.pdf"),
      true,
    );
    assert.equal(looksLikeProformaLetter(["Díjbekérő"], "a.pdf"), true);
    assert.equal(
      looksLikeProformaLetter(["x"], "PI-WR26-0104 Acropora.pdf"),
      true,
    );
    assert.equal(looksLikeProformaLetter(["x"], "Dijbekero_2026_09.pdf"), true);
    assert.equal(
      looksLikeProformaLetter(["x"], "Díjbekérő.pdf".normalize("NFD")),
      true,
    );
  });

  it("an invoice that names its pro forma later, or a PI inside a word, is not one", () => {
    const later = Array.from({ length: 20 }, (_, i) =>
      i === 14 ? "Előzmény: díjbekérő PI-2026-17, kiegyenlítve" : "SZÁMLA",
    );
    assert.equal(looksLikeProformaLetter(later, "szamla.pdf"), false);
    for (const line of ["API-2026-1", "PIPE-12 csőidom", "Pi-hole", "SPI-1"])
      assert.equal(
        looksLikeProformaLetter(["INVOICE", line], "inv.pdf"),
        false,
        line,
      );
    assert.equal(looksLikeProformaLetter(["INVOICE"], "PIPE-123.pdf"), false);
  });
});

describe("payment reminders and bank accounts (acrobot 25664)", () => {
  it("a reminder by its file name or its title, not by a word deep in a long text", () => {
    assert.equal(
      looksLikeReminder(["De Jong", "x", "y", "REMINDER"], "a.pdf"),
      true,
    );
    assert.equal(
      looksLikeReminder(
        ["Ügyfélszolgálat", "", "", "I. számú Fizetési emlékeztető"],
        null,
      ),
      true,
    );
    assert.equal(
      looksLikeReminder(["INVOICE"], "First_reminder_11069-26004529.pdf"),
      true,
    );
    assert.equal(looksLikeReminder(["INVOICE"], "Mahnung-2026-03.pdf"), true);
    // a szerződés 398. sorában: nem cím
    const contract = Array.from({ length: 400 }, (_, i) =>
      i === 397
        ? "felszólítás kézhezvételét követő nyolc (8) munkanapon belül"
        : "szöveg",
    );
    assert.equal(looksLikeReminder(contract, "Szerződés.pdf"), false);
    assert.equal(
      looksLikeReminder(
        ["INVOICE", "Invoice number 26007910"],
        "inv26007910.pdf",
      ),
      false,
    );
  });

  it("an IBAN or a Hungarian account is a bank account; invoice numbers are not", () => {
    for (const account of [
      "NL30RABO0322265428",
      "FR7630003004730002571158",
      "HU42 1170 9002 2062 4460 0000 0000",
      "11709002-20624460",
    ])
      assert.equal(looksLikeBankAccount(account), true, account);
    for (const number of [
      "26007910",
      "KS26/08132",
      "E-PAR-2026-46439",
      "FA00009139",
      "F2602896",
      "4042P0000640463",
    ])
      assert.equal(looksLikeBankAccount(number), false, number);
  });
});

/**
 * A FLEETCOR SZÁMLÁI (acrobot 26153, Balázs 2026-10-04: az októberi
 * E0401374511-et a rendszer nem látta). A sorok alakja a PDF-olvasó valódi
 * kimenete az exchange augusztusi mintáján (1328810_HU0000865961148_2026.pdf),
 * az összegek és a címek nélkül: a cellákat `|` választja el.
 *
 * MI PIROSÍT: ha a címke a `|` miatt nem talál (ekkor a fájlnév-tartalék a
 * tárgyból az ügyfél-azonosítót vinné, minden hónapban ugyanazt); ha az
 * ügyfél-azonosító számlaszám lehet; ha egy szétvágott vagy bankszámla-cella
 * számlaszámnak olvasódik.
 */
/*
  A LABELLED VALUE THAT IS A COMPANY OR A DAY (card 096607af; production,
  2026-10-06: five of the 37 general-reader records carried our own tax
  number or a date as their invoice number). WHAT TURNS RED: our tax number,
  any Hungarian tax number or a date next to a number label is taken as the
  invoice number; the label's later, real value or the file name is then not
  reached; a real number that only CONTAINS digits like a date is refused.
*/
describe("a labelled value that is a company or a day is not the invoice number (card 096607af)", () => {
  it("our tax number or another company's beside the label is skipped for the label's next value", () => {
    assert.equal(
      readInvoiceText([
        "Díjbekérő",
        "Sorszám | 23916229-2-42",
        "Sorszám | DIJBKK-26-000218",
      ]).invoiceNumber,
      "DIJBKK-26-000218",
    );
    assert.equal(
      readInvoiceText(["Számla száma: 14114113-2-08"]).invoiceNumber,
      null,
    );
  });

  it("a date beside the label is not the number; the file name then decides", () => {
    const lines = ["Számla száma | 2026.05.05", "SZLA-2026-828 | 176 460 Ft"];
    assert.deepEqual(
      readInvoiceText(lines, { fileName: "SZLA-2026-828.pdf" }),
      {
        invoiceNumber: "SZLA-2026-828",
        numberFrom: "FILE_NAME",
        supplierTaxNumber: null,
      },
    );
    assert.equal(
      readInvoiceText(["Invoice number 2026/09/22"]).invoiceNumber,
      null,
    );
  });

  it("a real number with a year in it is still a number", () => {
    for (const number of ["2026/0912", "KS26/10722", "E-KBOSS-2026-503610"])
      assert.equal(
        readInvoiceText([`Számla száma: ${number}`]).invoiceNumber,
        number,
      );
  });
});

describe("the number from an underscore-joined file name (2026-10-06)", () => {
  // the shape of the stored Rechnung_400055181585.pdf: the number after a
  // bare "Nummer:" label, which is not one of the number labels
  const RECHNUNG = [
    "Magyarország | Rechnung",
    "UID-Nr.: 23916229-2-42",
    "Nummer: | 400055181585",
    "Datum: | 31.07.2026",
  ];

  it("takes the part of the name that stands in the text", () => {
    assert.deepEqual(
      readInvoiceText(RECHNUNG, {
        fileName: "Rechnung_400055181585.pdf",
        subject: "Rechnung_400055181585",
      }),
      {
        invoiceNumber: "400055181585",
        numberFrom: "FILE_NAME",
        supplierTaxNumber: null,
      },
    );
  });

  it("keeps the whole token first when the text has it whole", () => {
    assert.equal(
      readInvoiceText(["Beleg INV_20261 | 12,00 EUR"], {
        fileName: "INV_20261.pdf",
      }).invoiceNumber,
      "INV_20261",
    );
  });

  it("never takes a date part for the number", () => {
    assert.equal(
      readInvoiceText(["Kelt: 2026-07-31", "Összesen 1 000 Ft"], {
        fileName: "Szamla_2026-07-31.pdf",
      }).invoiceNumber,
      null,
    );
  });

  // kártya 37b8643d: a SOPRO szkennelés (IMG_20260729_0002.pdf) száma a
  // szkennelés napja lett. MI PIROSÍT: ha az egybeírt dátum is szám lehet.
  it("never takes a scanner's compact date for the number, but keeps a real eight-digit one", () => {
    assert.equal(
      readInvoiceText(["Kelt: 2026.07.29.", "Összesen 1 000 Ft"], {
        fileName: "IMG_20260729_0002.pdf",
      }).invoiceNumber,
      null,
    );
    // ugyanez az alak, ami nem lehet nap (13. hónap): az számlaszám marad
    assert.equal(
      readInvoiceText(["Számla 20261329", "Összesen 1 000 Ft"], {
        fileName: "Rechnung_20261329.pdf",
      }).invoiceNumber,
      "20261329",
    );
  });
});

// task szamla-fajlnev-kotojel (acrobot 39130): two uploads of 2026-10-30 went to review without a number. The texts below
// are made up in the shape of such an online service's invoice: the number stands as a word, without its "Invoice-" prefix.
describe("the number from a hyphen-joined file name (2026-10-30)", () => {
  it("takes the run of the name that stands in the text as a word", () => {
    assert.deepEqual(
      readInvoiceText(
        ["Számla", "TT8G4RBM-0007 | 2026-10-30", "Összesen 15 900 Ft"],
        {
          fileName: "Invoice-TT8G4RBM-0007.pdf",
        },
      ),
      {
        invoiceNumber: "TT8G4RBM-0007",
        numberFrom: "FILE_NAME",
        supplierTaxNumber: null,
      },
    );
  });

  it("a second download's -2 is not part of the number, even with a year after the number in the text", () => {
    // squeezed together, the text reads ...OHCYTT2R00132026...: the -2 run would match there, a word does not
    assert.equal(
      readInvoiceText(
        ["Receipt", "OHCYTT2R-0013 | 2026-10-30", "Total 180.00 EUR"],
        {
          fileName: "Invoice-OHCYTT2R-0013-2.pdf",
        },
      ).invoiceNumber,
      "OHCYTT2R-0013",
    );
  });

  it("a single part still counts when it is the number, and a date-shaped name gives none", () => {
    assert.equal(
      readInvoiceText(["Nr 12345", "Total 1 000 Ft"], {
        fileName: "Invoice-12345.pdf",
      }).invoiceNumber,
      "12345",
    );
    assert.equal(
      readInvoiceText(["Kelt: 2026-10-30", "Összesen 1 000 Ft"], {
        fileName: "Szamla-2026-10-30.pdf",
      }).invoiceNumber,
      null,
    );
  });

  it("a piece of a date is no number, even when the text has it as a word; a year-led number still is", () => {
    assert.equal(
      readInvoiceText(
        ["Időszak: 2026-07", "Kelt: 07-31", "Összesen 1 000 Ft"],
        { fileName: "Szamla_2026-07-31.pdf" },
      ).invoiceNumber,
      null,
    );
    assert.equal(
      readInvoiceText(["Számla 2026-00123", "Összesen 1 000 Ft"], {
        fileName: "SZLA-2026-00123.pdf",
      }).invoiceNumber,
      "2026-00123",
    );
  });

  it("a run that is not a word of the text is no number", () => {
    assert.equal(
      readInvoiceText(["Számla", "Összesen 15 900 Ft"], {
        fileName: "Invoice-TT8G4RBM-0007.pdf",
      }).invoiceNumber,
      null,
    );
  });
});

describe("table cells and customer ids (FleetCor, 2026-10-04)", () => {
  const FLEETCOR = [
    "Ügyfélazonosító szám | HU00008659 | ACROPORA KFT. | Számla - Eredeti példány",
    "Számlakiállítás napja | 01.08.2026 | PESTI GÁBOR UTCA 35.",
    "Számla száma | E0401352892 | 1106 BUDAPEST | Számla kiállító",
    "Közvetlen terhelési hivatkozás | HU | FleetCor Hungary Kft.",
    "FleetCor Hungary Kft. | Ügyfél adószáma | 23916229-2-42 | Dózsa György út 84/B Budapest H-1068 HU",
    "Dózsa György út 84/B H-1068 Budapest | Cégjegyzékszám | 01 09 984032 | Adószám | 25103272-2-42",
  ];
  const HINTS = {
    fileName: "1328810_HU0000865961148_2026.pdf",
    subject:
      "Az Ön üzemanyagkártya számlája elkészült, ügyfélazonosítószám: HU00008659",
  };

  it("reads the number after a label even when a cell separator stands between", () => {
    assert.deepEqual(readInvoiceText(FLEETCOR, HINTS), {
      invoiceNumber: "E0401352892",
      numberFrom: "LABEL",
      supplierTaxNumber: "25103272-2-42",
    });
  });

  it("the NAV number wins once NAV has it, the labelled one agrees", () => {
    const reading = readInvoiceText(FLEETCOR, {
      ...HINTS,
      navNumbers: (base) => (base === "25103272" ? ["E0401352892"] : []),
    });
    assert.equal(reading.numberFrom, "NAV");
    assert.equal(reading.invoiceNumber, "E0401352892");
  });

  it("a customer id from the subject is never the invoice number", () => {
    const withoutLabel = FLEETCOR.filter(
      (line) => !line.startsWith("Számla száma"),
    );
    assert.deepEqual(customerIds(withoutLabel), new Set(["HU00008659"]));
    assert.equal(readInvoiceText(withoutLabel, HINTS).invoiceNumber, null);
  });

  // acrobot 26157: the FleetCor overview names no supplier tax number at all,
  // and the customer id looked European
  it("a customer id is not a tax number either", () => {
    assert.equal(
      readInvoiceText([
        "Számlaáttekintés",
        "Ügyfélazonosító szám | HU00008659 | ACROPORA KFT.",
      ]).supplierTaxNumber,
      null,
    );
    assert.equal(readInvoiceText(FLEETCOR).supplierTaxNumber, "25103272-2-42");
  });

  // acrobot 26158: the UNAS pro forma's bank branch took OUR tax number
  it("a tax number, ours above all, is never a bank reference", () => {
    const lines = [
      "Díjbekérő",
      "Adószám: | 14114113-2-08 | Adószám: | 23916229-2-42",
    ];
    const reading = readInvoiceText(lines);
    assert.equal(
      bankReference(lines, reading, {}, ["NAV ADO 23916229-2-42 ACROPORA"]),
      null,
    );
    assert.equal(
      bankReference(lines, reading, {}, ["UNAS 14114113-2-08"]),
      null,
    );
  });

  it("a value the reader split into cells is not a number (Stripe)", () => {
    // the hyphen of 53AEF736-256060 comes through as a NUL character
    assert.equal(
      readInvoiceText(["Invoice number | 53AEF736 | \u0000 | 256060"], {
        fileName: "Invoice.pdf",
      }).invoiceNumber,
      null,
    );
  });

  it("a bank account with spaces in its cell is not a number (OTP)", () => {
    assert.equal(
      readInvoiceText([
        "számla",
        "Ellenoldali számlaszám | 50453331 -10000843 -00000000",
      ]).invoiceNumber,
      null,
    );
  });
});

/*
  AZ ISMERT SZÁM SZÁLLÍTÓI ADÓSZÁM NÉLKÜL (acrobot 26885). A sorok a Tisza 97
  U26/03861-SZ PDF-jének mért alakja (2026-10-06, éles): a szám egy táblázat
  értéksorában áll, a szállító adószáma sehol, csak a miénk. MI PIROSÍT: ha
  ez nem ad számot és adószámot; ha egy szó RÉSZLETE, egy rövid szám, két
  különböző ismert szám, két szállító azonos száma vagy a saját adószámunk
  sora mégis számot ad; ha egy címkézett, eltérő számot felülír.
*/
describe("a known number when the text names no supplier tax number (Tisza 97)", () => {
  const TISZA = [
    "Számla",
    "BUDAPEST BANK 10104167-11770300-01004002 | Adószám: | 23916229-2-42",
    "Fizetés módja | Teljesítés | ideje | Számla kelte | Fizetési határidő | Számla sorszáma",
    "Átutalás 8 nap | 2026.10.05 | 2026.10.05 | 2026.10.13 | U26/03861-SZ",
    "Számlaérték összesen: | 73 139,00 Ft",
  ];
  const KNOWN: KnownInvoiceNumber[] = [
    { number: "U26/03861-SZ", supplierTaxNumber: "14880568-2-43" },
    { number: "U26/01266-SZ", supplierTaxNumber: "14880568-2-43" },
    { number: "E-KBOSS-2026-560251", supplierTaxNumber: "13917358-2-42" },
  ];

  it("finds the number in the table row and brings its supplier's tax number", () => {
    assert.deepEqual(knownNumberInText(TISZA, KNOWN), KNOWN[0]);
  });

  it("completes the file-name reading into a NAV reading", () => {
    assert.deepEqual(
      withKnownNumber(
        {
          invoiceNumber: "03861-SZ",
          numberFrom: "FILE_NAME",
          supplierTaxNumber: null,
          bankReference: "03861-SZ",
        },
        TISZA,
        KNOWN,
      ),
      {
        invoiceNumber: "U26/03861-SZ",
        numberFrom: "NAV",
        supplierTaxNumber: "14880568-2-43",
        bankReference: "03861-SZ",
      },
    );
  });

  it("a number the PDF split into two words still counts", () => {
    const split = TISZA.map((line) =>
      line.replace("U26/03861-SZ", "U26/ 03861-SZ"),
    );
    assert.deepEqual(knownNumberInText(split, KNOWN), KNOWN[0]);
  });

  it("a number inside a longer word does not count", () => {
    const inside = TISZA.map((line) =>
      line.replace("U26/03861-SZ", "XU26/03861-SZ7"),
    );
    assert.equal(knownNumberInText(inside, KNOWN), null);
  });

  it("a date and a short number do not count, though both stand as words", () => {
    // each is a word of the text: "2026.10.05" (eight digits) and "139,00"
    const dateOnly = [
      { number: "2026.10.05", supplierTaxNumber: "11111111-2-11" },
    ];
    const shortOnly = [{ number: "13900", supplierTaxNumber: "11111111-2-11" }];
    assert.equal(knownNumberInText(TISZA, dateOnly), null);
    assert.equal(knownNumberInText(TISZA, shortOnly), null);
  });

  it("two different known numbers in the text decide nothing", () => {
    const two = [...TISZA, "Hivatkozás: U26/01266-SZ"];
    assert.equal(knownNumberInText(two, KNOWN), null);
  });

  it("the same number from two suppliers decides nothing", () => {
    const twice = [
      ...KNOWN,
      { number: "U26/03861-SZ", supplierTaxNumber: "22222222-2-22" },
    ];
    assert.equal(knownNumberInText(TISZA, twice), null);
  });

  it("a row under our own tax number is never the supplier", () => {
    const ours = [
      { number: "U26/03861-SZ", supplierTaxNumber: "23916229-2-42" },
    ];
    assert.equal(knownNumberInText(TISZA, ours), null);
  });

  it("a reading that already has a supplier tax number is left as it is", () => {
    const read = {
      invoiceNumber: "X-1",
      numberFrom: "LABEL" as const,
      supplierTaxNumber: "12345678-2-42",
    };
    assert.equal(withKnownNumber(read, TISZA, KNOWN), read);
  });

  it("a labelled, different number wins over a known one in the text", () => {
    const read = {
      invoiceNumber: "U26/09999-SZ",
      numberFrom: "LABEL" as const,
      supplierTaxNumber: null,
    };
    assert.equal(withKnownNumber(read, TISZA, KNOWN), read);
  });

  it("a labelled, same number gets the supplier's tax number", () => {
    const read = {
      invoiceNumber: "U26/03861-SZ",
      numberFrom: "LABEL" as const,
      supplierTaxNumber: null,
    };
    assert.equal(
      withKnownNumber(read, TISZA, KNOWN).supplierTaxNumber,
      "14880568-2-43",
    );
  });
});

/*
  A CÍMKÉS VÉGÖSSZEG (kártya 37b8643d). A sorok a valódi PDF-ek alakja, mérve
  2026-10-06 élesen (KS2605898.pdf, 4934_26_szamla.pdf, KS2605848.pdf).
  MI PIROSÍT: ha az előjel elveszik (a módosító pozitív bruttót kapna); ha két
  különböző címkés értékből egyet választ; ha pénznem nélkül is dönt; ha a
  „Kft.” vége forintnak számít.
*/
describe("labelledTotal", () => {
  it("keeps the minus sign of a modifying invoice, on the same line and after a separator", () => {
    assert.deepEqual(labelledTotal(["Fizetendő: | -76.096 | Ft"]), {
      gross: "-76096",
      currency: "HUF",
    });
    assert.deepEqual(
      labelledTotal([
        "Bruttó összes | : | -167 478 Ft",
        "Fizetendő | : | -167 478 Ft",
      ]),
      { gross: "-167478", currency: "HUF" },
    );
    assert.deepEqual(labelledTotal(["Fizetendő: | 1.027.376 | Ft"]), {
      gross: "1027376",
      currency: "HUF",
    });
  });

  it("takes the amount from the next line when the label stands alone, with decimals", () => {
    assert.deepEqual(labelledTotal(["Invoice total", "€ 180,00"]), {
      gross: "180",
      currency: "EUR",
    });
    assert.deepEqual(labelledTotal(["Amount due: $20.50 USD"]), {
      gross: "20.5",
      currency: "USD",
    });
  });

  it("takes the next line only after a label that stands alone, not after a sentence (niceshops R49010000026240667)", () => {
    // the lines of the PDF as pdfTextLines gives them (acrobot 49361): the sentence's "számla összege" is a label, and
    // its next line is the address, whose numbers made a second labelled value and lost the real total
    assert.deepEqual(
      labelledTotal([
        "Rechnungsbetrag inkl. USt.: | 338.018 Ft",
        "(€ 931,10)",
        "A számla összege előreutalással ki lett fizetve.",
        "Tulajdonos: niceshops GmbH, 3DJake, Saaz 99, 8341 Paldau, Ausztria | E-mail: magyar@3djake.com |",
      ]),
      { gross: "338018", currency: "HUF" },
    );
  });

  it("still takes the next line after a label with a colon or a short note", () => {
    assert.deepEqual(
      labelledTotal(["Rechnungsbetrag inkl. USt.:", "338.018 Ft"]),
      {
        gross: "338018",
        currency: "HUF",
      },
    );
    assert.deepEqual(labelledTotal(["Végösszeg (HUF)", "12 700"]), {
      gross: "12700",
      currency: "HUF",
    });
  });

  it("takes the next line after a table header with more words, not only after a bare label (barracuda, #2484)", () => {
    for (const header of [
      "Fizetendő végösszeg",
      "Fizetendő összesen",
      "Végösszeg (bruttó)",
      "Rechnungsbetrag brutto",
      "Gesamtbetrag in Euro",
    ])
      assert.deepEqual(
        labelledTotal([header, "12 700 Ft"]),
        { gross: "12700", currency: "HUF" },
        header,
      );
  });

  it("does not take the next line after a sentence, by its end or by its words", () => {
    // the real total stands on its own line; a sentence that took the address below it as its value would make a
    // second, different labelled value, and the tie would lose the total
    for (const sentence of [
      "A számla összege előreutalással ki lett fizetve.",
      "A számla összege átutalással kerül kiegyenlítésre",
      "A számla összege kifizetve.",
    ])
      assert.deepEqual(
        labelledTotal([
          "Fizetendő: 338.018 Ft",
          sentence,
          "Saaz 99, 8341 Paldau",
        ]),
        { gross: "338018", currency: "HUF" },
        sentence,
      );
  });

  it("reads a bare Total at the start of the summary row, the last value being the gross (Hetzner, card f7ece26b)", () => {
    // the measured shape of the Hetzner invoice, the digits made up: the header row names the columns, and the
    // summary row (printed twice on the invoice) carries net, VAT and gross
    const summary = "Total | € 46.64 | € 0.00 | € 46.64";
    assert.deepEqual(
      labelledTotal([
        "Service | Period | Total (excl. VAT) | Tax | Total",
        "Project Acropora OS | 2026-08 | € 46.64 | € 0.00 | € 46.64",
        summary,
        summary,
      ]),
      { gross: "46.64", currency: "EUR" },
    );
    assert.deepEqual(labelledTotal(["Total: 12 700 Ft"]), {
      gross: "12700",
      currency: "HUF",
    });
  });

  it("uses a bare Total only when no other label gave a value (murena, #2486: two good grosses were lost)", () => {
    // the measured shape, the values made up: the text layer gives net, VAT and gross each on a "Total | ..." row
    const rows = ["Total | 100,00 €", "Total | 27,00 €", "Total | 127,00 €"];
    assert.deepEqual(labelledTotal([...rows, "Amount due: 127,00 €"]), {
      gross: "127",
      currency: "EUR",
    });
    // without another label the three different Total rows still decide nothing
    assert.equal(labelledTotal(rows), null);
  });

  it("does not take a Total that is not the grand total, or a Total inside the line", () => {
    for (const line of [
      "Total (excl. VAT): € 100.00",
      "Total VAT: € 27.00",
      "Total net | € 100.00",
      "Subtotal | € 100.00",
      "Line total | € 100.00",
    ])
      assert.equal(labelledTotal([line]), null, line);
  });

  it("does not decide between two different labelled values", () => {
    assert.equal(
      labelledTotal(["Végösszeg: 37 500 Ft", "Fizetendő: 7 972 Ft"]),
      null,
    );
  });

  it("does not decide without a currency, and a currency code inside a word is no currency", () => {
    assert.equal(labelledTotal(["Szállító Kft.", "Végösszeg: 12 700"]), null);
    // a dokumentum egyetlen pénzneme dönt, ha a címke sorában nincs; az
    // „EUROPA” a szállító neve, nem euró
    assert.deepEqual(
      labelledTotal([
        "EUROPA AQUA Kft.",
        "Nettó: 10 000 Ft",
        "Végösszeg: 12 700",
      ]),
      { gross: "12700", currency: "HUF" },
    );
  });
});

describe("withLabelledTotal", () => {
  const reading = {
    invoiceNumber: "SZ-1",
    numberFrom: "LABEL" as const,
    supplierTaxNumber: "12345678-2-42",
  };
  it("adds the labelled total, but never over a card payment or a gross from the source", () => {
    const lines = ["Fizetendő: 12 700 Ft"];
    assert.deepEqual(withLabelledTotal(reading, lines), {
      ...reading,
      gross: "12700",
      currency: "HUF",
    });
    const card = {
      ...reading,
      cardPayment: {
        amount: "12000",
        currency: "HUF",
        partner: "Szállító",
        debitIds: ["d1"],
      },
    };
    assert.deepEqual(withLabelledTotal(card, lines), card);
    const feed = { ...reading, gross: "13000", currency: "HUF" };
    assert.deepEqual(withLabelledTotal(feed, lines), feed);
  });
});

/*
  A RÖVID ISMERT SZÁM, HA A FÁJLNÉV VAGY A TÁRGY IS KIMONDJA (acrobot 35521,
  J55388, 2026-10-22). A sorok szintetikusak, a mért alakot követik: egy
  oldalnyi szöveg, a szám tömörítve áll egy értéksorban, a szállító adószáma
  nincs benne. MI PIROSÍT: ha a szám a fájlnév/tárgy nélkül mégis kötődik; ha a
  fájlnév egy MÁSIK számot mond; ha öt jelnél rövidebb szám kötődik; ha két
  szállító azonos rövid száma dönt; ha a hat jegyű szám a nyolc jegyű
  szabályon túl mást is átenged.
*/
describe("a short known number the file name or subject names too (J55388)", () => {
  const GUMI = [
    "Számla",
    "Példa Gumi Kft. | 1111 Budapest, Minta utca 1.",
    "Sorszám: | Kelt: | Teljesítés: | Fizetési határidő:",
    "J55388 | 2026.10.22 | 2026.10.22 | 2026.10.30",
    "Fizetendő összesen: | 119 800 Ft",
  ];
  const KNOWN: KnownInvoiceNumber[] = [
    { number: "J55388", supplierTaxNumber: "10735442-2-13" },
    { number: "U26/01266-SZ", supplierTaxNumber: "14880568-2-43" },
  ];
  const BOTH = {
    fileName: "Számla J55388 - 2026-10-22.pdf",
    subject: "Számla J55388 - 22.10.2026",
  };

  it("takes the six-sign number when the file name and the subject say it too", () => {
    assert.deepEqual(knownNumberInText(GUMI, KNOWN, BOTH), KNOWN[0]);
  });

  it("takes it on the file name alone, and on the subject alone", () => {
    assert.deepEqual(
      knownNumberInText(GUMI, KNOWN, { fileName: BOTH.fileName }),
      KNOWN[0],
    );
    assert.deepEqual(
      knownNumberInText(GUMI, KNOWN, { subject: BOTH.subject }),
      KNOWN[0],
    );
  });

  it("does NOT take it without the hints: the eight-sign floor still holds", () => {
    assert.equal(knownNumberInText(GUMI, KNOWN), null);
    assert.equal(knownNumberInText(GUMI, KNOWN, {}), null);
    assert.equal(
      knownNumberInText(GUMI, KNOWN, {
        fileName: "Szamla.pdf",
        subject: "Számla",
      }),
      null,
    );
  });

  it("does not take it when the file name names ANOTHER number", () => {
    assert.equal(
      knownNumberInText(GUMI, KNOWN, { fileName: "Számla J55389.pdf" }),
      null,
    );
  });

  it("does not take it when the hint only contains the number inside a longer word", () => {
    assert.equal(
      knownNumberInText(GUMI, KNOWN, { fileName: "Számla XJ55388Y.pdf" }),
      null,
    );
  });

  it("keeps a five-sign floor: five signs pass, four do not, even with the hint", () => {
    const five = ["Számla", "A5538 | 2026.10.22"];
    assert.deepEqual(
      knownNumberInText(
        five,
        [{ number: "A5538", supplierTaxNumber: "10735442-2-13" }],
        {
          fileName: "Számla A5538.pdf",
        },
      ),
      { number: "A5538", supplierTaxNumber: "10735442-2-13" },
    );
    const four = ["Számla", "A538 | 2026.10.22"];
    assert.equal(
      knownNumberInText(
        four,
        [{ number: "A538", supplierTaxNumber: "10735442-2-13" }],
        {
          fileName: "Számla A538.pdf",
        },
      ),
      null,
    );
  });

  it("a date-shaped word of the file name does not count as a hint word", () => {
    // "2026-10-2" is a date in the name; as a known number it compacts to 2026102 (seven signs)
    const text = ["Számla", "2026102 | 2026.10.22"];
    const known = [{ number: "2026-10-2", supplierTaxNumber: "10735442-2-13" }];
    assert.equal(
      knownNumberInText(text, known, { fileName: "Számla 2026-10-2.pdf" }),
      null,
    );
    // the same seven signs written as a number do count
    assert.deepEqual(
      knownNumberInText(text, known, { fileName: "Számla 2026102.pdf" }),
      known[0],
    );
  });

  it("the same short number from two suppliers decides nothing, hint or not", () => {
    const twice = [
      ...KNOWN,
      { number: "J55388", supplierTaxNumber: "22222222-2-22" },
    ];
    assert.equal(knownNumberInText(GUMI, twice, BOTH), null);
  });

  it("two different known numbers in the text decide nothing", () => {
    const two = [...GUMI, "Hivatkozás: U26/01266-SZ"];
    assert.equal(
      knownNumberInText(two, KNOWN, {
        fileName: "Számla J55388 U26/01266-SZ.pdf",
      }),
      null,
    );
  });

  it("completes the reading into a NAV reading with the supplier's tax number", () => {
    assert.deepEqual(
      withKnownNumber(
        { invoiceNumber: null, numberFrom: null, supplierTaxNumber: null },
        GUMI,
        KNOWN,
        BOTH,
      ),
      {
        invoiceNumber: "J55388",
        numberFrom: "NAV",
        supplierTaxNumber: "10735442-2-13",
      },
    );
  });
});

/*
  A SZÖVEGRÉTEG NÉLKÜLI (BESZKENNELT) PDF (acrobot 35529): a tartalom nem mondja
  meg, hogy számla, ezért a gyűjtő a fájlnévre és a tárgyra hagyatkozik. MI
  PIROSÍT: ha egy üres vagy szinte üres olvasat szöveges rétegnek számít; ha egy
  rövid, de valódi számla (néhány sor) szövegréteg nélkülinek számít.
*/
describe("hasNoTextLayer", () => {
  it("is true for an empty reading, whitespace and a stray page number", () => {
    assert.equal(hasNoTextLayer([]), true);
    assert.equal(hasNoTextLayer(["", "   ", "\t"]), true);
    assert.equal(hasNoTextLayer(["1 / 2"]), true);
  });

  it("is false for a short but real invoice and for any page of prose", () => {
    assert.equal(
      hasNoTextLayer([
        "Számla",
        "J55388 | 2026.10.22",
        "Fizetendő: 119 800 Ft",
      ]),
      false,
    );
    assert.equal(
      hasNoTextLayer([
        "Ez egy oldal szöveg, amiből látszik, hogy van szövegréteg.",
      ]),
      false,
    );
  });

  it("counts signs, not lines: many blank-ish lines stay textless", () => {
    assert.equal(hasNoTextLayer(Array(50).fill(" ")), true);
  });
});

/*
  A HIVATKOZOTT ISMERT SZÁM NEM A DOKUMENTUM SAJÁT SZÁMA (niceshops második dokumentuma, task os-hianyzo-szamlak-unpaid). Kitalált
  szöveg és szám. MI PIROSÍT: egy jóváírás vagy helyesbítés, ami a korábbi, ismert számlát nevezi meg, annak a számát kapja sajátjául;
  ÉS a másik irány: ugyanaz a szám a dokumentum saját sorában (nem hivatkozásban) nem kötődik többé.
*/
describe("a known number in a reference is not the document's own number", () => {
  const KNOWN: KnownInvoiceNumber[] = [
    { number: "R49010000099990001", supplierTaxNumber: "11111111-2-41" },
  ];
  const read = {
    invoiceNumber: null,
    numberFrom: null,
    supplierTaxNumber: null,
  } as const;

  for (const [why, lines] of [
    [
      "a German reference on the same line",
      [
        "Gutschrift",
        "Bezug auf Rechnung R49010000099990001 vom 05.11.2026",
        "Betrag: 97 265 Ft",
      ],
    ],
    [
      "a labelled line above the number",
      [
        "Korrekturbeleg",
        "Zu Rechnung:",
        "R49010000099990001",
        "Betrag: 97 265 Ft",
      ],
    ],
    [
      "a Hungarian corrective invoice",
      [
        "Helyesbítő számla",
        "Az eredeti számla száma: R49010000099990001",
        "Összesen: 97 265 Ft",
      ],
    ],
    [
      "an English credit note",
      [
        "Credit note",
        "Original invoice R49010000099990001",
        "Total: 97 265 HUF",
      ],
    ],
  ] as const)
    it(`${why}: no hit, and the reading keeps no number`, () => {
      assert.equal(knownNumberInText(lines, KNOWN), null);
      assert.deepEqual(withKnownNumber({ ...read }, lines, KNOWN), read);
    });

  it("the same number on the document's own line is still found (the control nearest to the case)", () => {
    const lines = [
      "Rechnung",
      "Rechnungsnummer: R49010000099990001",
      "Betrag: 338 018 Ft",
    ];
    assert.deepEqual(knownNumberInText(lines, KNOWN), KNOWN[0]);
    assert.equal(
      withKnownNumber({ ...read }, lines, KNOWN).invoiceNumber,
      "R49010000099990001",
    );
  });

  it("named both in a reference and on its own line, the number counts", () => {
    const lines = [
      "Rechnung R49010000099990001",
      "Bezug auf Rechnung R49010000099990001",
    ];
    assert.deepEqual(knownNumberInText(lines, KNOWN), KNOWN[0]);
  });

  it("a label above without a colon is not a reference label: the number on the next line counts", () => {
    const lines = ["Gutschrift Nr", "R49010000099990001"];
    assert.deepEqual(knownNumberInText(lines, KNOWN), KNOWN[0]);
  });
});

/*
  A SAJÁT SZÁM CÍMKÉJE A JEL MELLETT (acrobot 48666, barracuda megjegyzése a #2458-on). Kitalált szöveg és szám. MI PIROSÍT: egy
  helyesbítő számla vagy egy jóváírás SAJÁT, címkézett száma nem kötődik (a címsor jele hivatkozásnak látszott), vagy az ismert
  eredeti szám miatt kétértelmű marad; ÉS a másik irány: egy erős hivatkozásban (eredeti, Bezug, zu Rechnung) álló idegen szám
  sajátként kötődik.
*/
describe("an own-number label beside the marker: the document's own number binds", () => {
  const SUPPLIER = "11111111-2-41";
  const ORIGINAL = {
    number: "R49010000099990001",
    supplierTaxNumber: SUPPLIER,
  };
  const CORRECTIVE = { number: "HX2026000123", supplierTaxNumber: SUPPLIER };
  const CREDIT = { number: "GS2026000777", supplierTaxNumber: SUPPLIER };

  it("a Hungarian corrective invoice binds its own number, though the original it names is known too", () => {
    const lines = [
      "Helyesbítő számla",
      "Helyesbítő számla sorszáma: HX2026000123",
      "Az eredeti számla száma: R49010000099990001",
    ];
    assert.deepEqual(
      knownNumberInText(lines, [ORIGINAL, CORRECTIVE]),
      CORRECTIVE,
    );
  });

  it("a Gutschrift binds its own number, though the invoice it refers to is known too", () => {
    const lines = [
      "Gutschrift Nr. GS2026000777",
      "Bezug auf Rechnung R49010000099990001",
    ];
    assert.deepEqual(knownNumberInText(lines, [ORIGINAL, CREDIT]), CREDIT);
  });

  it("the niceshops shape: an unknown own number and a known referenced one bind nothing", () => {
    const lines = [
      "Gutschrift Nr. GS-NEM-ISMERT-1",
      "Bezug auf Rechnung Nr. R49010000099990001",
    ];
    assert.equal(knownNumberInText(lines, [ORIGINAL]), null);
  });

  it("a strong reference stays a reference beside an own-number label", () => {
    for (const lines of [
      ["Az eredeti számla sorszáma: R49010000099990001"],
      ["Zu Rechnung Nr. R49010000099990001"],
    ])
      assert.equal(
        knownNumberInText(lines, [ORIGINAL]),
        null,
        String(lines[0]),
      );
  });

  it('an "Eredeti példány" header on the own number\'s line is no reference: with a second known number the text stays undecidable (barracuda, #2460)', () => {
    const ADVANCE = { number: "EL2026000555", supplierTaxNumber: SUPPLIER };
    const lines = [
      "SZÁMLA Eredeti példány Számla sorszáma: HX2026000123",
      "Előleg-számla: EL2026000555",
    ];
    // the old shape (the bare "eredeti" a strong reference) dropped the own number and bound the advance's
    assert.equal(knownNumberInText(lines, [CORRECTIVE, ADVANCE]), null);
    // alone, the own number on that line binds
    assert.deepEqual(knownNumberInText([lines[0]!], [CORRECTIVE]), CORRECTIVE);
  });

  it("a weak marker without a label still makes two known numbers undecidable", () => {
    const lines = ["Rechnung GS2026000777", "Storno R49010000099990001"];
    assert.equal(knownNumberInText(lines, [ORIGINAL, CREDIT]), null);
  });
});

/*
  A CSOPORTOKBA TÖRDELT BANKSZÁMLA NEM SZÁMLASZÁM (Niceshops / 3DJake, 2026-11-12). Kitalált számok, a valódi PDF sor-alakjával.
  MI PIROSÍT: a „Számlaszám: 1200 1008 …” lábléc első négyese számlaszám lesz (a két külön számla így egy dokumentummá vonódott
  össze); a „Rech.-Nr.” sor száma nem olvasódik; ÉS a másik irány: a „Számlaszám:” után álló VALÓDI számlaszám nem olvasódik.
*/
describe("a bank account written in groups is not an invoice number", () => {
  const FOOTER =
    "IBAN: HU99123456781234567812345678 | BIC: TESZTHUHB | Számlaszám: 1234 5678 1234 5678 1234 5678 |";

  it("the footer's grouped account is skipped, and the Rech.-Nr. line gives the number", () => {
    const read = readInvoiceText(
      [
        "Rechnung",
        "Rech.-Nr. | R49010000099990001",
        "Rech.-Datum | 05.11.2026",
        FOOTER,
      ],
      { fileName: "szamla.pdf" },
    );
    assert.equal(read.invoiceNumber, "R49010000099990001");
    assert.equal(read.numberFrom, "LABEL");
  });

  /*
    SORONKÉNT, PONTOS ÉRTÉKKEL (barracuda, #2464 CHANGES): egy notEqual("1234")
    a nyolcas csoportokra nem tud elbukni (ott az első token "12345678"), és egy
    ciklus az első bukásnál megáll. MI PIROSÍT: a négyes ág nélkül a 4x4 és a
    4x6 sor; a nyolcas ág nélkül a 8x2 és a 8x3 sor (köztük a niceshops-alak).
  */
  for (const [name, footer] of [
    ["4x4", "Számlaszám: 1234 5678 1234 5678"],
    ["4x6", FOOTER],
    ["8x2", "Számlaszám: 12345678 12345678"],
    ["8x3", "Számlaszám: 12345678 12345678 12345678"],
    ["8x3, the niceshops form", "Számlaszám: 12001008 01472511 00100004 |"],
  ] as const)
    it(`without any other number, a ${name} grouped account gives no number`, () => {
      assert.equal(
        readInvoiceText(["Számla", footer], { fileName: "x.pdf" })
          .invoiceNumber,
        null,
      );
    });

  it("a real invoice number after the same label is still read (the control nearest to the case)", () => {
    for (const [line, number] of [
      ["Számlaszám: 2026/001234", "2026/001234"],
      ["Számlaszám: ABC-1234", "ABC-1234"],
      ["Számlaszám: 1234 | Kelte: 2026.11.05", "1234"],
    ] as const)
      assert.equal(
        readInvoiceText(["Számla", line], { fileName: "x.pdf" }).invoiceNumber,
        number,
        line,
      );
  });
});
