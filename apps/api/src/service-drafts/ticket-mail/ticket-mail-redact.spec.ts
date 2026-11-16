import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hasReadableText, redactForAi } from "./ticket-mail-redact.js";

/**
 * THE REDACTION BEFORE ANY TEXT GOES TO THE AI (card ec7b947b, S3b). WHAT TURNS RED: a name we know, an address, a link, a phone number, an account
 * or tax number or a long number reaching the output; a greeting's or a closing's name left in; a measurement, a short number, a date or an
 * ordinary word replaced (the text would lose its meaning); a lower case word taken for a name; the counts wrong. Invented data only.
 */
const run = (text: string, names: string[] = [], subject = "") =>
  redactForAi({ subject, text, knownNames: names });

describe("redactForAi: contact data", () => {
  it("replaces an e-mail address and a link, in the subject too", () => {
    const r = run(
      "Írj a hiba@pelda.hu címre, vagy nézd: https://pelda.example/jegy?id=7 és www.masik.example/x",
      [],
      "Re: hiba@pelda.hu",
    );
    assert.equal(r.text, "Írj a [E-MAIL] címre, vagy nézd: [LINK] és [LINK]");
    assert.equal(r.subject, "Re: [E-MAIL]");
    assert.equal(r.counts.emails, 2);
    assert.equal(r.counts.links, 2);
  });

  it("replaces Hungarian and international phone numbers in their usual writings", () => {
    for (const phone of [
      "+36 30 123 4567",
      "+36301234567",
      "06 30 123 4567",
      "06-30-123-4567",
      "0036 1 234 5678",
      "+36 (30) 123-4567",
      "+44 20 7946 0958",
    ])
      assert.equal(
        run(`Hívj: ${phone}, köszi`).text,
        "Hívj: [TELEFON], köszi",
        phone,
      );
  });

  it("replaces tax numbers, bank accounts and IBANs", () => {
    assert.equal(run("Adószám: 12345678-1-42").text, "Adószám: [SZÁM]");
    assert.equal(
      run("Számla: 11773016-11111018-00000000").text,
      "Számla: [SZÁM]",
    );
    assert.equal(
      run("IBAN: HU42 1177 3016 1111 1018 0000 0000").text,
      "IBAN: [SZÁM]",
    );
  });

  it("replaces a long run of digits (an order number, a serial) and counts it", () => {
    const r = run(
      "Rendelés 2026111699 és sorozatszám 123456, de a 3-as medence és 12345 nem... mégis",
    );
    assert.equal(r.text.includes("2026111699"), false);
    assert.equal(r.text.includes("123456"), false);
    assert.equal(r.counts.numbers >= 3, true);
  });
});

describe("redactForAi: what must stay", () => {
  it("keeps measurements, short numbers, dates, temperatures and ordinary words", () => {
    const text =
      "A 3-as medence 12 literes tartálya 26 °C-on, 2026.11.16-án, 0,5 mg/l értékkel csöpög; a 2 szivattyú 400 W.";
    assert.equal(run(text).text, text);
  });

  it("CONTROL: a lower case word that looks like a name is a word, not a name", () => {
    assert.equal(
      run("Az új szabó szerelő nagy hibát talált", ["Szabó Anna", "Nagy Péter"])
        .text,
      "Az új szabó szerelő nagy hibát talált",
    );
  });

  it("CONTROL: a short token and a company form in a name are not names", () => {
    const r = run("A Kft és a Zrt nem név, Ági sem 3 betűs kivétel", [
      "Kovács Kft",
      "Té Zrt",
      "Ági",
    ]);
    assert.equal(r.text.startsWith("A Kft és a Zrt nem név"), true);
  });
});

describe("redactForAi: names", () => {
  it("replaces every known name, first or last, with the Hungarian endings", () => {
    const r = run(
      "Kovács Anna szerint a szűrő csöpög. Annának szóltam, Kovácsékkal egyeztettem, és Péter is látta.",
      ["Kovács Anna", "Nagy Péter"],
    );
    assert.equal(
      r.text,
      "[NÉV] [NÉV] szerint a szűrő csöpög. [NÉV] szóltam, [NÉV] egyeztettem, és [NÉV] is látta.",
    );
    assert.equal(r.counts.names, 5);
  });

  it("matches a name only at the START of a word, and only with a short ending after it", () => {
    assert.equal(
      run("Mapéter és Kaanna", ["Péter", "Anna"]).text,
      "Mapéter és Kaanna",
    );
    assert.equal(
      run("Péterszentmihály lakója", ["Péter"]).text,
      "Péterszentmihály lakója",
    );
    // the safe side of the error: a longer name that starts with a known one is redacted as a name
    assert.equal(run("Péterfi jött", ["Péter"]).text, "[NÉV] jött");
  });

  it("takes the long vowel before an ending (Anna -> Annának, Béla -> Bélával)", () => {
    assert.equal(
      run("Annának és Bélával", ["Anna", "Béla"]).text,
      "[NÉV] és [NÉV]",
    );
  });

  it("replaces a name that follows a greeting even when it is not a known one", () => {
    assert.equal(
      run("Szia Gábor,\nA szivattyú zajos.").text,
      "Szia [NÉV],\nA szivattyú zajos.",
    );
    assert.equal(
      run("Kedves Tóth Éva!\nA lámpa kiégett.").text,
      "Kedves [NÉV]!\nA lámpa kiégett.",
    );
  });

  it("replaces the name under a closing", () => {
    assert.equal(
      run("A szűrő csöpög.\nÜdvözlettel,\nSzilágyi Dezső\nFőnök").text,
      "A szűrő csöpög.\nÜdvözlettel,\n[NÉV]\nFőnök",
    );
  });

  it("the names of the subject and the sender's own display name are covered when passed", () => {
    const r = run("Hiba a medencénél", ["Varga Béla"], "Varga Béla jelzése");
    assert.equal(
      r.subject,
      "[NÉV] [NÉV] jelzése".replace("[NÉV] [NÉV]", "[NÉV] [NÉV]"),
    );
  });

  it("a text with no name list and no pattern is only cleaned of contact data", () => {
    assert.equal(run("Csöpög a szűrő").text, "Csöpög a szűrő");
  });
});

describe("redactForAi: nothing of the original survives, and it is idempotent", () => {
  it("a mail full of personal data leaves no trace of it", () => {
    const mail =
      "Szia Anna,\nKovács Péter (+36 20 555 1234, peter.kovacs@pelda.hu) szerint a 3-as szűrő csöpög, lásd https://pelda.example/12345678. Adószám: 12345678-2-41.\nÜdv,\nBéla";
    const r = run(mail, ["Kovács Péter", "Szabó Béla"]);
    for (const trace of [
      "Anna",
      "Kovács",
      "Péter",
      "+36",
      "555",
      "peter.kovacs",
      "pelda",
      "12345678",
      "Béla",
    ])
      assert.equal(r.text.includes(trace), false, trace);
    assert.match(r.text, /3-as szűrő csöpög/);
  });

  it("redacting an already redacted text changes nothing", () => {
    const once = run("Hívd Kovács Annát: +36 30 123 4567, anna@pelda.hu", [
      "Kovács Anna",
    ]);
    const twice = run(once.text, ["Kovács Anna"]);
    assert.equal(twice.text, once.text);
    assert.equal(
      twice.counts.names + twice.counts.phones + twice.counts.emails,
      0,
    );
  });
});

describe("hasReadableText", () => {
  it("a mail that is only placeholders and short bits has nothing to read; one with words has", () => {
    assert.equal(hasReadableText("[NÉV] [TELEFON] [E-MAIL] 12"), false);
    assert.equal(hasReadableText("[NÉV] szerint csöpög a szűrő"), true);
    assert.equal(hasReadableText(""), false);
  });
});
