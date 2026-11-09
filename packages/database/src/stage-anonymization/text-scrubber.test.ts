import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPseudonymizer } from "./pseudonymizer.js";
import { createTextScrubber } from "./text-scrubber.js";

/*
  THE FREE-TEXT SCRUBBER (S2). WHAT TURNS THIS RED: a real e-mail, IBAN (valid or a typo'd Hungarian one), account number, tax
  number, prefixed phone number or dictionary name that survives in a text; a fake that differs from the engine's fake for the
  same value (the text and the column must agree); a bare ten-digit number, a date, an amount or an ordinary word replaced;
  a fake that is scanned again and replaced twice; a name inside an e-mail replaced on its own; a single-word surname matched;
  a name that differs only in case, accent, order or a Hungarian suffix not found.
*/
const engine = createPseudonymizer(
  "proba-kulcs-nem-valodi-0123456789-abcdef-xyz",
);
const NAMES = ["Teszt Elek", "Minta Réka", "Dr. Példa Béla"];
const scrubber = () => createTextScrubber(engine, NAMES);
const REGISTRY_IBAN = "HU42117730161111101800000000";

describe("patterns", () => {
  it("replaces an e-mail, with the engine's own fake", () => {
    const out = scrubber().scrubText(
      "Írt: Teszt.Elek@Example.com és más@pelda.hu.",
    );
    assert.equal(
      out,
      `Írt: ${engine.email("Teszt.Elek@Example.com")} és ${engine.email("más@pelda.hu")}.`,
    );
  });

  it("replaces a valid IBAN and a Hungarian one with a typo, but not a code that only looks like one", () => {
    const typo = "HU42117730161111101800000001";
    const out = scrubber().scrubText(
      `Utalás: ${REGISTRY_IBAN}, tévesen: ${typo}, külföldi: DE89 3704 0044 0532 0130 00, kód: AB12 CDEF GHIJ.`,
    );
    assert.ok(
      !out.includes(REGISTRY_IBAN) &&
        !out.includes(typo) &&
        !out.includes("DE89 3704"),
    );
    assert.ok(out.includes(engine.iban(REGISTRY_IBAN)));
    assert.ok(out.includes(engine.iban("DE89 3704 0044 0532 0130 00")));
    assert.ok(out.includes("kód: AB12 CDEF GHIJ."));
  });

  it("replaces a Hungarian account number (two and three blocks) and the tax numbers", () => {
    const out = scrubber().scrubText(
      "Számla: 11773016-11111018 és 11773016-11111018-00000000; adószám 12345678-2-42, HU12345678.",
    );
    assert.ok(out.includes(engine.bankAccountNumber("11773016-11111018")));
    assert.ok(
      out.includes(engine.bankAccountNumber("11773016-11111018-00000000")),
    );
    assert.ok(out.includes(engine.companyTaxNumber("12345678-2-42")));
    assert.ok(out.includes(engine.euTaxNumber("HU12345678")));
    assert.ok(!/11773016|12345678/.test(out));
  });

  it("replaces a personal tax id only next to the word, never a bare ten-digit number", () => {
    const out = scrubber().scrubText(
      "Adóazonosító jele: 8123456789. Rendelésszám 8123456789, jegy 8000000001.",
    );
    assert.ok(
      out.includes(`Adóazonosító jele: ${engine.personalTaxId("8123456789")}.`),
    );
    assert.ok(out.includes("Rendelésszám 8123456789, jegy 8000000001."));
  });

  it("replaces phone numbers written with a prefix, and leaves dates, amounts and unprefixed digits alone", () => {
    const text =
      "Hívja: +36 30 123 4567, 06 1 234 5678, +43 660 1234567. Dátum 2026-11-09, összeg 1 234 567 Ft, rendelés 1234567.";
    const out = scrubber().scrubText(text);
    assert.ok(out.includes(engine.phone("+36 30 123 4567")));
    assert.ok(out.includes(engine.phone("06 1 234 5678")));
    assert.ok(out.includes(engine.phone("+43 660 1234567")));
    assert.ok(
      out.includes("Dátum 2026-11-09, összeg 1 234 567 Ft, rendelés 1234567."),
    );
    assert.ok(!out.includes("123 4567"));
  });
});

describe("IP addresses (barracuda, #2322)", () => {
  it("replaces an IPv4 and an IPv6 address in a copied log line with a documentation-range address, and keeps what is not an address", () => {
    const out = scrubber().scrubText(
      "A kérés a 81.182.10.20 címről jött, v6: 2a01:4f8:1c1b:5d3a::1 és fe80:0:0:0:1:2:3:4. Verzió 1.2.3, idő 10:30:45, 999.1.1.1, 12.34.56.78.90.",
    );
    assert.ok(!/81\.182\.10\.20|2a01:4f8|fe80:0:0/.test(out));
    assert.ok(out.includes(engine.ipAddress("81.182.10.20")));
    assert.ok(out.includes(engine.ipAddress("fe80:0:0:0:1:2:3:4")));
    assert.ok(
      out.includes("Verzió 1.2.3, idő 10:30:45, 999.1.1.1, 12.34.56.78.90."),
    );
    assert.match(
      engine.ipAddress("81.182.10.20"),
      /^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/,
    );
    assert.match(
      engine.ipAddress("2a01:4f8::1"),
      /^2001:db8::[0-9a-f]+:[0-9a-f]+$/,
    );
  });

  it("gives the same address the same fake, counts it, and leaves the original out of the stats", () => {
    const s = scrubber();
    const out = s.scrubText("a 81.182.10.20, majd megint 81.182.10.20");
    assert.equal(
      out,
      `a ${engine.ipAddress("81.182.10.20")}, majd megint ${engine.ipAddress("81.182.10.20")}`,
    );
    assert.equal(s.stats.ip, 2);
  });
});

describe("names", () => {
  it("replaces a dictionary name with the fake of that person, whatever the case, accents, order or Hungarian suffix", () => {
    const fake = engine.personName("Teszt Elek");
    const s = scrubber();
    assert.equal(s.scrubText("Hívta Teszt Elek."), `Hívta ${fake}.`);
    assert.equal(s.scrubText("hívta TESZT ELEK"), `hívta ${fake}`);
    assert.equal(
      s.scrubText("Minta Reka jelezte, teszt elek is"),
      `${engine.personName("Minta Réka")} jelezte, ${fake} is`,
    );
    assert.equal(s.scrubText("Elek Teszt aláírta"), `${fake} aláírta`);
    assert.equal(s.scrubText("Teszt Eleknek átadták"), `${fake}nek átadták`);
    assert.equal(s.scrubText("Példa Béla"), engine.personName("Példa Béla"));
  });

  it("does not match a single word, a name with a long tail, or two words that are not next to each other", () => {
    const s = scrubber();
    for (const text of [
      "Teszt volt itt.",
      "Elek volt itt.",
      "Teszt, Elek",
      "Teszt és Elek",
      "Teszt Elekmindenmás",
    ]) {
      assert.equal(s.scrubText(text), text, text);
    }
  });

  it("does not scan a fake again: a fake that equals another real name is replaced once", () => {
    const x = "Teszt Elek";
    const f = engine.personName(x);
    const both = createTextScrubber(engine, [x, f]);
    assert.equal(both.scrubText(`Hívta ${x}.`), `Hívta ${f}.`);
  });

  it("takes the first of two overlapping matches and skips the other (a VAT-like start inside an e-mail)", () => {
    const text = "Cím: HU12345678@pelda.hu";
    assert.equal(
      scrubber().scrubText(text),
      `Cím: ${engine.email("HU12345678@pelda.hu")}`,
    );
  });

  it("ignores a dictionary entry of one word, and one of more than five", () => {
    const s = createTextScrubber(engine, ["Egyedül", "a b c d e f"]);
    assert.equal(s.scrubText("Egyedül a b c d e f"), "Egyedül a b c d e f");
  });
});

describe("counts", () => {
  it("counts the replacements by kind, and never holds a value", () => {
    const s = scrubber();
    s.scrubText("a@b.hu +36 30 123 4567 Teszt Elek 12345678-2-42");
    assert.deepEqual(s.stats, {
      email: 1,
      iban: 0,
      bankAccount: 0,
      taxNumber: 1,
      personalTaxId: 0,
      phone: 1,
      ip: 0,
      name: 1,
    });
    assert.ok(Object.values(s.stats).every((n) => typeof n === "number"));
  });

  it("returns an empty text as it is", () => {
    assert.equal(scrubber().scrubText(""), "");
  });
});
