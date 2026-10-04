import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeName } from "../missing-invoice-matching.js";
import {
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
