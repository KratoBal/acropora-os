import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  matchMonth,
  mergeManualUploads,
  type CandidateDocument,
  type MatchableDebit,
} from "./missing-invoice-matching.js";

/*
  A KÉZZEL PÁROSÍTOTT, OLVASHATATLAN FELTÖLTÉS ÉS A SZÁMLA SORA (7ff26bc9). Az
  esetek a 2026-10-02-i éles száraz futás 14 kézi párosításából valók. MI
  PIROSÍT: ha a Tesla-pár nem vonódik össze (akkor a bejövő számla fizetetlen
  marad); ha a KBOSS-pár összevonódik (két külön számla, azonos összeggel és
  partnerrel); ha egy kétértelmű, egy más terheléshez párosított vagy egy
  OLVASHATÓ feltöltés összevonódik; ha a Telekom összevonódik, holott a
  3. szabály partner-próbája nem illeszti.

  Kifejezett azonosítók, nem számláló: a sorrendet semmi nem mozdítja el.
*/
const D = (v: string | number) => new Prisma.Decimal(v);

const debit = (
  id: string,
  overrides: Partial<MatchableDebit> = {},
): MatchableDebit => ({
  id,
  bookingDate: "2026-09-14",
  amount: D(4400),
  currency: "HUF",
  original: null,
  counterpartyName: "Tesla Inc",
  counterpartyAccount: null,
  narrative: "",
  category: "DOMESTIC_SUPPLIER",
  ...overrides,
});

const feed = (
  id: string,
  overrides: Partial<CandidateDocument> = {},
): CandidateDocument => ({
  id,
  source: "SZAMLAZZ",
  number: "4042V0000011711",
  date: "2026-09-10",
  gross: D(4400),
  currency: "HUF",
  supplierName: "Tesla Hungary Kft.",
  supplierAccounts: [],
  kind: "INVOICE",
  payee: "COMPANY",
  hasOriginal: true,
  identities: ["sha:feed", "inv:4042v0000011711|tesla hungary kft."],
  ...overrides,
});

/** Olvashatatlan feltöltés: a száma a fájlnév, bruttó és `inv:` azonosság nélkül. */
const upload = (
  id: string,
  fileName: string,
  overrides: Partial<CandidateDocument> = {},
): CandidateDocument => ({
  id,
  source: "UPLOAD",
  number: fileName,
  date: "2026-09-14",
  gross: null,
  currency: "HUF",
  supplierName: "",
  supplierAccounts: [],
  kind: "INVOICE",
  payee: "UNKNOWN",
  hasOriginal: true,
  identities: [`sha:${id}`],
  ...overrides,
});

const TESLA_UPLOAD = "tesla_invoice4f06695c-8ac5-4358-9265-54171c226486 2.pdf";

describe("mergeManualUploads", () => {
  it("the Tesla upload becomes an alias of its invoice row, and the manual pairing reaches the row", () => {
    const debits = [debit("d-tesla")];
    const documents = [feed("f-tesla"), upload("u-tesla", TESLA_UPLOAD)];
    const manual = new Map([["d-tesla", ["u-tesla"]]]);
    const merged = mergeManualUploads(documents, manual, debits);
    assert.deepEqual(
      merged.map((d) => [d.id, d.aliasIds ?? []]),
      [["f-tesla", ["u-tesla"]]],
    );
    // a párosítás a sorhoz jut: a kifizetett-jelölés ezt a sort keresi
    const outcome = matchMonth({ debits, documents: merged, manual }).get(
      "d-tesla",
    );
    assert.deepEqual(
      outcome?.documents.map((d) => d.id),
      ["f-tesla"],
    );
  });

  it("a NAV row without an original takes the upload as its original", () => {
    const [merged] = mergeManualUploads(
      [
        feed("n-tesla", { source: "NAV", hasOriginal: false }),
        upload("u-tesla", TESLA_UPLOAD),
      ],
      new Map([["d-tesla", ["u-tesla"]]]),
      [debit("d-tesla")],
    );
    assert.deepEqual(
      [merged!.originalId, merged!.hasOriginal],
      ["u-tesla", true],
    );
  });

  it("a file named by the invoice number merges with that row, whatever the bank calls the partner", () => {
    const merged = mergeManualUploads(
      [
        feed("n-tea", {
          source: "NAV",
          number: "E-SI-2026-51598",
          gross: D(20000),
          supplierName: "TEA MOBILITÁS Kft.",
        }),
        upload("u-tea", "E-SI-2026-51598.pdf"),
      ],
      new Map([["d-tea", ["u-tea"]]]),
      [
        debit("d-tea", {
          amount: D(20000),
          counterpartyName: "BARIONP*TEA",
          bookingDate: "2026-09-28",
        }),
      ],
    );
    assert.deepEqual(
      merged.map((d) => [d.id, d.aliasIds ?? []]),
      [["n-tea", ["u-tea"]]],
    );
  });

  it("KBOSS: same amount and partner, but the file names another number of the same series, so two invoices", () => {
    const documents = [
      feed("f-kboss", {
        number: "E-KBOSS-2026-560251",
        gross: D(11417),
        supplierName: "KBOSS.hu Kft.",
      }),
      upload("u-kboss", "E-KBOSS-2026-503610.pdf"),
    ];
    const merged = mergeManualUploads(
      documents,
      new Map([["d-kboss", ["u-kboss"]]]),
      [
        debit("d-kboss", {
          amount: D(11417),
          counterpartyName: "KBOSS.hu Kft.",
        }),
      ],
    );
    assert.deepEqual(
      merged.map((d) => d.id),
      ["f-kboss", "u-kboss"],
    );
  });

  it("Telekom stays: the rule-3 partner test does not match the bank's merchant name", () => {
    const merged = mergeManualUploads(
      [
        feed("f-telekom", {
          number: "5120260008253234",
          gross: D(61730),
          supplierName: "Magyar Telekom Nyrt.",
        }),
        upload("u-telekom", "94d52ceb-e2bd-3727-9276-33316ea5780b.pdf"),
      ],
      new Map([["d-telekom", ["u-telekom"]]]),
      [
        debit("d-telekom", {
          amount: D(61730),
          counterpartyName: "TelekomSzaml*003426827",
          bookingDate: "2026-09-07",
        }),
      ],
    );
    assert.equal(merged.length, 2);
  });

  const manual = new Map([["d-tesla", ["u-tesla"]]]);
  const debits = [debit("d-tesla")];

  it("stays when two rows would fit", () => {
    assert.equal(
      mergeManualUploads(
        [
          feed("f-1"),
          feed("f-2", { number: "4042V0000011799" }),
          upload("u-tesla", TESLA_UPLOAD),
        ],
        manual,
        debits,
      ).length,
      3,
    );
  });

  it("stays when the row is paired by hand to another debit: that is its invoice", () => {
    assert.equal(
      mergeManualUploads(
        [feed("f-tesla"), upload("u-tesla", TESLA_UPLOAD)],
        new Map([
          ["d-tesla", ["u-tesla"]],
          ["d-other", ["f-tesla"]],
        ]),
        [...debits, debit("d-other", { bookingDate: "2026-09-20" })],
      ).length,
      2,
    );
  });

  it("stays when the upload was read (an inv: identity): that is mergeSameInvoice's job", () => {
    assert.equal(
      mergeManualUploads(
        [
          feed("f-tesla"),
          upload("u-tesla", TESLA_UPLOAD, {
            identities: ["sha:u", "inv:mas-szam|tesla"],
          }),
        ],
        manual,
        debits,
      ).length,
      2,
    );
  });

  it("one upload paired to two debits merges only if the row fits both (the Sopro case shows as double paid)", () => {
    const sopro = {
      number: "KB-2855/2026",
      gross: D(172006),
      supplierName: "SOPRO HUNGÁRIA KFT",
    };
    const debits = [
      debit("d-1", {
        amount: D(172006),
        counterpartyName: "Sopro Hungária Kft.",
        bookingDate: "2026-09-28",
      }),
      debit("d-2", {
        amount: D(172006),
        counterpartyName: "SOPRO Hungária Kft.",
        bookingDate: "2026-09-29",
      }),
    ];
    const manual = new Map([
      ["d-1", ["u-sopro"]],
      ["d-2", ["u-sopro"]],
    ]);
    const merged = mergeManualUploads(
      [feed("f-sopro", sopro), upload("u-sopro", "IMG_20260915_00014.pdf")],
      manual,
      debits,
    );
    assert.deepEqual(
      merged.map((d) => [d.id, d.aliasIds ?? []]),
      [["f-sopro", ["u-sopro"]]],
    );
    const outcomes = matchMonth({ debits, documents: merged, manual });
    assert.deepEqual(
      [outcomes.get("d-1")?.state, outcomes.get("d-2")?.state],
      ["DOUBLE_PAID", "DOUBLE_PAID"],
    );
  });
  it("one upload paired to two debits stays if the row fits only one of them", () => {
    const merged = mergeManualUploads(
      [feed("f-tesla"), upload("u-tesla", TESLA_UPLOAD)],
      new Map([
        ["d-1", ["u-tesla"]],
        ["d-2", ["u-tesla"]],
      ]),
      [debit("d-1"), debit("d-2", { amount: D(9900) })],
    );
    assert.equal(merged.length, 2);
  });
});
