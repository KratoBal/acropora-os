import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeName } from "../missing-invoice-matching.js";
import {
  cardPaymentMatch,
  type CardDebit,
  looksLikeInvoice,
  looksLikeProforma,
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

describe("cardPaymentMatch: a NAV-less invoice and the card payment it was paid with (acrobot 25666, 25673)", () => {
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
    "Teljes összeg* | 9125,00 HUF | 9125,00 HUF",
  ];
  const card = (
    counterpartyName: string,
    amount: string,
    original: CardDebit["original"] = null,
  ): CardDebit => ({ counterpartyName, amount, currency: "HUF", original });

  it("takes the payment whose partner word and amount (the original or the booked one) are in the text", () => {
    assert.deepEqual(
      cardPaymentMatch(
        hetzner,
        [
          card("HETZNER ONLINE GMBH", "2690", {
            amount: "7.04",
            currency: "EUR",
          }),
          card("HETZNER ONLINE GMBH", "17113", {
            amount: "46.64",
            currency: "EUR",
          }),
          card("Tesla Hungary Korlatol", "2449"),
        ],
        word,
      ),
      { amount: "7.04", currency: "EUR", partner: "HETZNER ONLINE GMBH" },
    );
    assert.deepEqual(
      cardPaymentMatch(
        kia,
        [
          card("Digital Charging Solut", "9125", {
            amount: "25.1",
            currency: "EUR",
          }),
        ],
        word,
      ),
      { amount: "9125", currency: "HUF", partner: "Digital Charging Solut" },
    );
  });

  it("takes nothing when the amount, the partner word, or the uniqueness is missing, or the partner is us", () => {
    const hetznerCard = (amount: string) =>
      card("HETZNER ONLINE GMBH", "999", { amount, currency: "EUR" });
    assert.equal(cardPaymentMatch(hetzner, [hetznerCard("7.05")], word), null);
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
      ),
      null,
    );
    assert.equal(
      cardPaymentMatch(
        hetzner,
        [hetznerCard("7.04"), hetznerCard("7.04")],
        word,
      ),
      null,
    );
    // NYITOTT (PR): a Kia Charge júliusi számláján a havi díj (1518) egy másik
    // hónap teljes fizetése is; két fizetés illik, tehát nem választunk. A
    // „nagyobb nyer” feloldás a havi összesítő számlán (Parkl) a legnagyobb
    // TÉTELT választaná a végösszeg helyett, ezért nincs benne.
    assert.equal(
      cardPaymentMatch(
        [...kia, "Havi díj | 1518,00 HUF | 1518,00 HUF"],
        [
          card("Digital Charging Solut", "1518"),
          card("Digital Charging Solut", "9125"),
        ],
        word,
      ),
      null,
    );
    // a saját átvezetésünk neve minden nekünk szóló számlán ott van
    assert.equal(
      cardPaymentMatch(
        hetzner,
        [card("ACROPORA KFT EUR", "999", { amount: "7.04", currency: "EUR" })],
        word,
      ),
      null,
    );
    // a Kia Charge augusztusi számlája két terhelés ÖSSZEGE: egyik sem illik
    assert.equal(
      cardPaymentMatch(
        ["Digital Charging Solutions GmbH", "Teljes összeg* | 40086,00 HUF"],
        [
          card("Digital Charging Solut", "21279"),
          card("Digital Charging Solut", "18807"),
        ],
        word,
      ),
      null,
    );
  });
});
