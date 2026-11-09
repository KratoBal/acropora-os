import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createJsonScrubber } from "./json-scrubber.js";
import { createPseudonymizer } from "./pseudonymizer.js";
import { createTextScrubber } from "./text-scrubber.js";

/*
  THE JSON SCRUBBER (S2). WHAT TURNS THIS RED: a structured personal value (name, e-mail, phone, tax number, street, account)
  that survives under its key; a business value (a product name, an amount, a city, a postal code) that changes; a company
  name replaced while the owner's decision is open (or kept when `pseudonymize` is asked); a credential or IP key left in; the
  input changed; an e-mail or known name hidden in an unlisted key left in; a different fake from the one the engine makes for
  the same value; an extra rule that is not tried first.
*/
const engine = createPseudonymizer(
  "proba-kulcs-nem-valodi-0123456789-abcdef-xyz",
);
const text = createTextScrubber(engine, ["Teszt Elek"]);
const scrub = (value: unknown, options = {}) =>
  createJsonScrubber(engine, text, options).scrubJson(value);

const SNAPSHOT = {
  buyer: {
    name: "Teszt Elek",
    type: "PERSON",
    email: "Teszt.Elek@Example.com",
    phone: "+36 30 123 4567",
    taxNumber: "8123456789",
    address: {
      street: "Teszt utca 12.",
      zip: "1234",
      city: "Budapest",
      country: "HU",
    },
  },
  items: [
    { name: "Vízkezelő szer 250 ml", quantity: 2, unitPrice: 1990.5, vat: 27 },
  ],
  note: "Visszahívni: Teszt Elek, tel. +36 20 765 4321",
  paid: false,
  discount: null,
};

describe("structured values", () => {
  it("replaces a person's structured values with the engine's fakes and keeps the business data", () => {
    const out = scrub(SNAPSHOT) as typeof SNAPSHOT;
    assert.equal(out.buyer.name, engine.personName("Teszt Elek"));
    assert.equal(out.buyer.email, engine.email("Teszt.Elek@Example.com"));
    assert.equal(out.buyer.phone, engine.phone("+36 30 123 4567"));
    assert.equal(out.buyer.taxNumber, engine.personalTaxId("8123456789"));
    assert.equal(
      out.buyer.address.street,
      engine.streetAddress("Teszt utca 12."),
    );
    assert.deepEqual(
      {
        zip: out.buyer.address.zip,
        city: out.buyer.address.city,
        country: out.buyer.address.country,
        type: out.buyer.type,
      },
      { zip: "1234", city: "Budapest", country: "HU", type: "PERSON" },
    );
    assert.deepEqual(out.items, SNAPSHOT.items);
    assert.equal(out.paid, false);
    assert.equal(out.discount, null);
  });

  it("scrubs an unlisted key's string with the text scrubber (a known name and a phone inside a note)", () => {
    const out = scrub(SNAPSHOT) as typeof SNAPSHOT;
    assert.equal(
      out.note,
      `Visszahívni: ${engine.personName("Teszt Elek")}, tel. ${engine.phone("+36 20 765 4321")}`,
    );
  });

  it("does not change its input, and gives the same output twice", () => {
    const before = JSON.stringify(SNAPSHOT);
    const first = scrub(SNAPSHOT);
    assert.equal(JSON.stringify(SNAPSHOT), before);
    assert.deepEqual(scrub(SNAPSHOT), first);
  });
});

describe("names", () => {
  it("keeps a name that is not under a person-like key (a product, a warehouse), and a company's name while the decision is open", () => {
    const out = scrub({
      product: { name: "Vízkezelő szer" },
      customer: {
        name: "Példa Kft.",
        type: "COMPANY",
        taxNumber: "12345678-2-42",
      },
    }) as {
      product: { name: string };
      customer: { name: string; taxNumber: string };
    };
    assert.equal(out.product.name, "Vízkezelő szer");
    assert.equal(out.customer.name, "Példa Kft.");
    assert.equal(
      out.customer.taxNumber,
      engine.companyTaxNumber("12345678-2-42"),
    );
  });

  it("replaces a company's name when asked to, and a sole trader's name always", () => {
    const company = { customer: { name: "Példa Kft.", type: "COMPANY" } };
    assert.equal(
      (scrub(company, { companyNames: "pseudonymize" }) as typeof company)
        .customer.name,
      engine.personName("Példa Kft."),
    );
    const person = { customer: { name: "Minta Réka", customerType: "PERSON" } };
    assert.equal(
      (scrub(person) as typeof person).customer.name,
      engine.personName("Minta Réka"),
    );
  });

  it("matches a key whatever its case, accents and punctuation, and splits first and last names", () => {
    const out = scrub({
      Contact: {
        "E-mail": "a@b.hu",
        Telefon: "06301234567",
        Keresztnév: "Elek",
        Vezetéknév: "Teszt",
      },
    }) as {
      Contact: Record<string, string>;
    };
    assert.equal(out.Contact["E-mail"], engine.email("a@b.hu"));
    assert.equal(out.Contact["Telefon"], engine.phone("06301234567"));
    assert.equal(out.Contact["Keresztnév"], engine.givenName("Elek"));
    assert.equal(out.Contact["Vezetéknév"], engine.familyName("Teszt"));
  });
});

describe("accounts, parcels and addresses", () => {
  it("replaces an IBAN, a domestic account, a parcel number and a one-line address (zip and city kept)", () => {
    const out = scrub({
      iban: "HU42 1177 3016 1111 1018 0000 0000",
      bankAccount: "11773016-11111018",
      parcelNumber: "CL123456789",
      address: "1234 Budapest, Teszt utca 12.",
    }) as Record<string, string>;
    assert.equal(out.iban, engine.iban("HU42 1177 3016 1111 1018 0000 0000"));
    assert.equal(
      out.bankAccount,
      engine.bankAccountNumber("11773016-11111018"),
    );
    assert.equal(out.parcelNumber, engine.parcelNumber("CL123456789"));
    assert.equal(
      out.address,
      `1234 Budapest, ${engine.streetAddress("Teszt utca 12.")}`,
    );
  });
});

describe("text in a structured field (barracuda, #2320)", () => {
  // a phone, bank, tax or parcel key can hold text; no real character may reach the stage through it
  const keepsNoLetter = (real: string, fake: string): boolean =>
    [...fake].length === [...real].length &&
    [...real].every(
      (char, i) =>
        !/\p{L}/u.test(char) || (fake[i] !== char && /[A-Za-z]/.test(fake[i]!)),
    );

  it("replaces a text under a phone, account, IBAN, tax or parcel key letter for letter", () => {
    const input = {
      phone: "Kovács Péter titkárság",
      bankAccount: "Kovács Éva",
      iban: "csak délután, Éva",
      taxNumber: "Példa Kft",
      parcelNumber: "Őrült Ürge",
    };
    const out = scrub(input) as Record<string, string>;
    for (const [key, real] of Object.entries(input)) {
      assert.notEqual(out[key], real, key);
      assert.ok(
        keepsNoLetter(real, out[key]!),
        `${key}: ${real} -> ${out[key]}`,
      );
    }
  });
});

describe("deleted keys, arrays and extra rules", () => {
  it("deletes credential and network keys at any depth, and walks arrays", () => {
    const out = scrub({
      password: "x",
      list: [
        { apiKey: "k", ipAddress: "10.0.0.1", ok: 1 },
        { Token: "t", Authorization: "a", buyer: { email: "q@w.hu" } },
      ],
      ip: "1.2.3.4",
    }) as { list: Record<string, unknown>[]; password?: string; ip?: string };
    assert.equal("password" in out, false);
    assert.equal("ip" in out, false);
    assert.deepEqual(out.list[0], { ok: 1 });
    assert.deepEqual(out.list[1], { buyer: { email: engine.email("q@w.hu") } });
  });

  it("tries an extra rule before the defaults, and a rule may delete a key", () => {
    const out = scrub(
      { email: "a@b.hu", legacyId: "azonosito-7" },
      {
        extraRules: [
          { test: (k: string) => k === "email", apply: () => "FIX" },
          { test: (k: string) => k === "legacyid", apply: () => undefined },
        ],
      },
    ) as Record<string, string>;
    assert.equal(out.email, "FIX");
    assert.equal("legacyId" in out, false);
  });

  it("returns a scalar and an empty string as they are", () => {
    assert.equal(scrub(42), 42);
    assert.equal(scrub(null), null);
    assert.deepEqual(scrub({ email: "" }), { email: "" });
  });
});
