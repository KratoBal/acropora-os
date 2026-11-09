import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ANONYMIZATION_KINDS,
  ANONYMIZATION_REGISTER,
} from "../anonymization-register.js";
import {
  check9731,
  createPseudonymizer,
  FAKE_EMAIL_DOMAIN,
  findCollisions,
  ibanCheckDigits,
  MIN_KEY_BYTES,
  PSEUDONYMIZED_KINDS,
} from "./pseudonymizer.js";
import { FAMILY_NAMES, GIVEN_NAMES } from "./pseudonym-names.js";

/*
  THE PSEUDONYMIZATION ENGINE (S1). WHAT TURNS THIS RED: a fake that is not the same on a second call, or is the same under
  another key (the key must matter); a key under 32 bytes accepted; an e-mail outside the undeliverable domain, or two
  distinct addresses sharing a fake; a phone number whose separators, length or area code change; an IBAN or a Hungarian
  account number that fails its own checks; a personal tax id outside the 10-digit shape or off its check digit; a street,
  name or parcel number of the wrong form; a collision that `findCollisions` does not find; a register kind with the
  `pseudonymize` action that no engine method serves.

  THE VALIDATORS BELOW ARE WRITTEN INDEPENDENTLY of the engine (a BigInt mod 97, a plain loop for the 9-7-3-1 blocks), and they
  are first calibrated on the registry's published example HU42117730161111101800000000: a validator that accepts nothing,
  or everything, would make every assertion about the engine mean nothing.
*/
const KEY = "proba-kulcs-nem-valodi-0123456789-abcdef-xyz";
const OTHER_KEY = "masik-proba-kulcs-nem-valodi-9876543210-zyx";
const engine = createPseudonymizer(KEY);

const mod97Valid = (iban: string): boolean => {
  const compact = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(compact)) return false;
  const moved = compact.slice(4) + compact.slice(0, 4);
  const numeric = [...moved]
    .map((c) => (/\d/.test(c) ? c : String(c.charCodeAt(0) - 55)))
    .join("");
  return BigInt(numeric) % 97n === 1n;
};

/** True when the weighted 9-7-3-1 sum of the digits is a multiple of ten. */
const blockOk = (digits: string): boolean => {
  const weights = [9, 7, 3, 1];
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1)
    sum += Number(digits[i]) * weights[i % 4]!;
  return sum % 10 === 0;
};

const huBbanOk = (bban: string): boolean =>
  /^\d{24}$/.test(bban) &&
  blockOk(bban.slice(0, 8)) &&
  (/^0{8}$/.test(bban.slice(16))
    ? blockOk(bban.slice(8, 16))
    : blockOk(bban.slice(8)));

const REGISTRY_EXAMPLE = "HU42117730161111101800000000";

describe("the validators (calibration on the registry's published example)", () => {
  it("accept the example, and reject it with one digit changed", () => {
    assert.ok(mod97Valid(REGISTRY_EXAMPLE));
    assert.ok(!mod97Valid("HU43" + REGISTRY_EXAMPLE.slice(4)));
    assert.ok(
      !mod97Valid(
        REGISTRY_EXAMPLE.slice(0, 20) + "9" + REGISTRY_EXAMPLE.slice(21),
      ),
    );
    assert.ok(huBbanOk(REGISTRY_EXAMPLE.slice(4)));
    assert.ok(!huBbanOk("117730171111101800000000"));
    // the engine's own helpers agree with the independent ones on the example
    assert.equal(ibanCheckDigits("HU", REGISTRY_EXAMPLE.slice(4)), "42");
    assert.equal(check9731("1177301"), "6");
  });
});

describe("the key and determinism", () => {
  it("refuses a key shorter than 32 bytes, and accepts exactly 32", () => {
    assert.throws(
      () => createPseudonymizer("x".repeat(MIN_KEY_BYTES - 1)),
      /at least 32 bytes/,
    );
    assert.doesNotThrow(() => createPseudonymizer("x".repeat(MIN_KEY_BYTES)));
  });

  it("gives the same fake for the same input, and another one for another key", () => {
    const other = createPseudonymizer(OTHER_KEY);
    const calls: [string, (p: typeof engine) => string][] = [
      ["email", (p) => p.email("teszt.elek@example.com")],
      ["name", (p) => p.personName("Teszt Elek")],
      ["phone", (p) => p.phone("+36 30 123 4567")],
      ["tax", (p) => p.companyTaxNumber("12345678-2-42")],
      ["taxId", (p) => p.personalTaxId("8123456789")],
      ["iban", (p) => p.iban(REGISTRY_EXAMPLE)],
      ["street", (p) => p.streetAddress("Teszt utca 12.")],
      ["parcel", (p) => p.parcelNumber("AB123456789")],
    ];
    for (const [label, call] of calls) {
      assert.equal(call(engine), call(createPseudonymizer(KEY)), label);
      assert.notEqual(call(engine), call(other), label);
    }
  });
});

describe("e-mail", () => {
  it("is an undeliverable-domain address, folds case and spacing, and does not repeat across thousands of distinct inputs", () => {
    const fake = engine.email("Teszt.Elek@Example.com ");
    // the domain is PINNED as a literal (the plan, 3.2): a regex built from the constant would follow a change of the constant
    assert.equal(FAKE_EMAIL_DOMAIN, "teszt.acropora.invalid");
    assert.match(fake, /^u[a-z2-7]{12}@teszt\.acropora\.invalid$/);
    assert.equal(fake, engine.email("teszt.elek@example.com"));
    assert.equal(engine.email("  "), "");
    const inputs = Array.from(
      { length: 5000 },
      (_, i) => `felhasznalo${i}@example.com`,
    );
    assert.deepEqual(findCollisions(inputs, engine.email), []);
  });
});

describe("names", () => {
  it("come from the lists, in Hungarian order, and a full name matches its split columns", () => {
    const full = engine.personName("Teszt Elek");
    const [family, given] = full.split(" ");
    assert.ok(FAMILY_NAMES.includes(family!));
    assert.ok(GIVEN_NAMES.includes(given!));
    assert.equal(family, engine.familyName("Teszt"));
    assert.equal(given, engine.givenName("Elek"));
    assert.equal(engine.personName("  TESZT   elek "), full);
    assert.equal(engine.personName(""), "");
  });

  it("keeps a leading title, and a single word becomes a family name only", () => {
    assert.ok(engine.personName("Dr. Teszt Elek").startsWith("Dr. "));
    assert.equal(
      engine.personName("Dr. Teszt Elek").slice(4),
      engine.personName("Teszt Elek"),
    );
    assert.ok(FAMILY_NAMES.includes(engine.personName("Teszt")));
  });
});

describe("phone", () => {
  it("keeps the separators, the length and the area code, and replaces the subscriber digits", () => {
    for (const real of [
      "+36 30 123 4567",
      "+36-1-234-5678",
      "06301234567",
      "0036 20 765 4321",
      "(06 22) 555 123",
    ]) {
      const fake = engine.phone(real);
      assert.equal(fake.length, real.length, real);
      assert.deepEqual(
        [...fake].map((c) => (/\d/.test(c) ? "#" : c)),
        [...real].map((c) => (/\d/.test(c) ? "#" : c)),
        real,
      );
      assert.notEqual(fake, real, real);
    }
    assert.ok(engine.phone("+36 30 123 4567").startsWith("+36 30 "));
    assert.ok(engine.phone("+36-1-234-5678").startsWith("+36-1-"));
    assert.ok(engine.phone("0036 20 765 4321").startsWith("0036 20 "));
  });

  it("gives the same subscriber digits however the same number is written", () => {
    const a = engine.phone("+36 30 123 4567").replace(/\D/g, "");
    const b = engine.phone("06301234567").replace(/\D/g, "");
    assert.equal(a.slice(2), b.slice(1 + 1)); // 36 30 xxxxxxx versus 06 30 xxxxxxx
  });

  it("keeps a foreign country code and leaves a too-short number alone", () => {
    assert.ok(engine.phone("+43 660 1234567").startsWith("+43 "));
    assert.equal(engine.phone("12345"), "12345");
  });
});

describe("tax numbers", () => {
  it("replaces the 8-digit core of a company tax number and keeps the shape, the VAT code and the county code", () => {
    const fake = engine.companyTaxNumber("12345678-2-42");
    assert.match(fake, /^\d{8}-2-42$/);
    assert.notEqual(fake.slice(0, 8), "12345678");
    assert.ok(fake[0] !== "0");
    assert.equal(engine.companyTaxNumber("12345678242").length, 11);
  });

  it("gives an EU VAT number of Hungary the same core as the company tax number, and keeps another country's prefix", () => {
    assert.equal(
      engine.euTaxNumber("HU12345678").slice(2),
      engine.companyTaxNumber("12345678-2-42").slice(0, 8),
    );
    assert.match(engine.euTaxNumber("ATU12345678"), /^AT[A-Z0-9]{9}$/);
    assert.notEqual(engine.euTaxNumber("ATU12345678"), "ATU12345678");
  });

  it("makes a 10-digit personal tax id that starts with 8, falls in a plausible birth range and passes the mod-11 check", () => {
    for (let i = 0; i < 2000; i += 1) {
      const fake = engine.personalTaxId(String(8000000000 + i * 7919));
      assert.match(fake, /^8\d{9}$/);
      let sum = 0;
      for (let p = 0; p < 9; p += 1) sum += (p + 1) * Number(fake[p]);
      assert.equal(sum % 11, Number(fake[9]), fake);
      const days = Number(fake.slice(1, 6));
      assert.ok(days >= 26_000 && days <= 51_000, `${fake}: ${days}`);
    }
    assert.equal(
      engine.personalTaxId("8123456789"),
      engine.personalTaxId("8123456789"),
    );
    assert.notEqual(
      engine.personalTaxId("8123456789", 1),
      engine.personalTaxId("8123456789", 0),
    );
  });
});

describe("bank accounts", () => {
  it("makes a Hungarian IBAN that passes mod 97 and the national blocks, and keeps the bank code and the grouping", () => {
    const samples = Array.from({ length: 500 }, (_, i) => {
      const bban = `117730${String(i % 100).padStart(2, "0")}1111${String((i * 31) % 10000).padStart(4, "0")}00000000`;
      const compact = `HU00${bban}`;
      return `HU${ibanCheckDigits("HU", bban)}${compact.slice(4)}`;
    });
    for (const real of samples) {
      assert.ok(mod97Valid(real), real);
      const fake = engine.iban(real);
      assert.ok(mod97Valid(fake), fake);
      assert.ok(huBbanOk(fake.slice(4)), fake);
      assert.equal(fake.slice(4, 7), "117");
      assert.equal(fake.length, 28);
    }
    const spaced = engine.iban("HU42 1177 3016 1111 1018 0000 0000");
    assert.match(spaced, /^HU\d\d( \d{4}){6}$/);
    assert.ok(mod97Valid(spaced));
  });

  it("makes a full 16-digit account (non-zero third block) pass the 16-digit check", () => {
    const account15 = "123456789012345";
    const bban = `11773016${account15}${check9731(account15)}`;
    const real = `HU${ibanCheckDigits("HU", bban)}${bban}`;
    assert.ok(mod97Valid(real) && huBbanOk(bban));
    const fake = engine.iban(real);
    assert.ok(mod97Valid(fake));
    assert.ok(huBbanOk(fake.slice(4)), fake);
    assert.ok(!/^0{8}$/.test(fake.slice(20)));
  });

  it("makes a non-Hungarian IBAN keep its country and length with valid mod-97 digits", () => {
    const real = "DE89370400440532013000";
    assert.ok(mod97Valid(real));
    const fake = engine.iban(real);
    assert.ok(mod97Valid(fake), fake);
    assert.equal(fake.slice(0, 2), "DE");
    assert.equal(fake.length, real.length);
    assert.notEqual(fake, real);
  });

  it("keeps a domestic account number's dashes and passes the national blocks; the IBAN of the same account agrees", () => {
    const two = engine.bankAccountNumber("11773016-11111018");
    assert.match(two, /^\d{8}-\d{8}$/);
    assert.ok(huBbanOk(two.replace("-", "") + "00000000"));
    const three = engine.bankAccountNumber("11773016-11111018-00000000");
    assert.match(three, /^\d{8}-\d{8}-0{8}$/);
    assert.equal(three.slice(0, 17), two);
    assert.equal(
      engine.iban(REGISTRY_EXAMPLE).slice(4),
      three.replace(/-/g, ""),
    );
    assert.equal(
      engine.bankAccountNumber("123"),
      engine.bankAccountNumber("123"),
    );
  });
});

describe("street address and parcel number", () => {
  it("builds 'name type number.' from the lists and drops the real house number and the floor", () => {
    const fake = engine.streetAddress("Teszt Elek utca 12. 3. em. 4. ajtó");
    assert.match(
      fake,
      /^.+ (utca|út|tér|körút|sétány|köz|dűlő|sor) \d{1,3}\.$/,
    );
    assert.equal(
      engine.streetAddress("teszt  elek UTCA 12. 3. em. 4. ajtó"),
      fake,
    );
    assert.equal(engine.streetAddress(" "), "");
  });

  it("substitutes a parcel number character class for character class", () => {
    const fake = engine.parcelNumber("CL-AB123456789 x");
    assert.equal(fake.length, "CL-AB123456789 x".length);
    assert.match(fake, /^[A-Z]{2}-[A-Z]{2}\d{9} [a-z]$/);
    assert.notEqual(fake, "CL-AB123456789 x");
  });
});

describe("collisions", () => {
  it("finds distinct real values that share a fake, by index, and does not count one value twice", () => {
    const values = ["a", "B", "b ", "c"];
    const found = findCollisions(values, (v) =>
      v.trim().toLowerCase() === "c"
        ? "X"
        : v.trim().toLowerCase() === "a"
          ? "X"
          : "Y",
    );
    assert.deepEqual(found, [{ fake: "X", indexes: [0, 3] }]);
    for (const group of found)
      for (const index of group.indexes) assert.equal(typeof index, "number");
  });
});

describe("the register", () => {
  it("has an engine route for every kind whose action is pseudonymize, and no route for a kind that does not exist", () => {
    const kinds = Object.entries(ANONYMIZATION_KINDS);
    assert.ok(kinds.length > 10, "the control: the kinds were read");
    const needing = kinds
      .filter(
        ([, kind]) =>
          kind.action === "pseudonymize" ||
          (kind as { naturalPersonRows?: string }).naturalPersonRows ===
            "pseudonymize",
      )
      .map(([name]) => name)
      .sort();
    assert.ok(
      needing.length >= 8,
      `only ${needing.length} pseudonymized kinds found`,
    );
    assert.deepEqual(Object.keys(PSEUDONYMIZED_KINDS).sort(), needing);
    assert.ok(
      Object.keys(ANONYMIZATION_REGISTER).length > 100,
      "the control: the register was read",
    );
  });
});
