import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ADATKEZELES,
  JATEKSZABALYZAT,
  JOGI_DOKUMENTUMOK,
  dokumentumSzovege,
  jogiSzovegVazlat,
  kitoltendoDb,
  blokkSzovegei,
  szakaszBlokkok,
} from "./jogi-szovegek.ts";

/*
  WHAT TURNS THIS RED. A legal or business decision written as if it were made (the organiser, the prizes, the
  duration, the legal basis, the retention, the processors, the data subject's rights are the owner's: each one
  stays a [KITÖLTENDŐ]); the draft going out without its warning; the page promising a newsletter, or saying less
  than the brief decided (only the correct answers are drawn, once a week per address, confirmation by link).
*/
const szoveg = dokumentumSzovege;

describe("a jogi szoveg vazlatai", () => {
  it("both documents are final (Balázs's texts, 2026-11-06): no draft warning and no open mark, and the draft check says so", () => {
    for (const d of JOGI_DOKUMENTUMOK) {
      assert.equal(d.vazlat_jelzes, undefined, d.azonosito);
      assert.equal(kitoltendoDb(d), 0, d.azonosito);
    }
    assert.equal(jogiSzovegVazlat(), false);
  });

  it("the draft machinery still works for a text that is not final: an open mark is counted", () => {
    const vazlat = {
      azonosito: "adatkezeles" as const,
      cim: "x",
      szakaszok: [{ cim: "1. x", bekezdesek: ["[KITÖLTENDŐ: valami]"] }],
    };
    assert.equal(kitoltendoDb(vazlat), 1);
  });

  it("the rules are version 2 (Balázs's OK, 2026-11-06): fifteen numbered sections, the two tables as tables, the lists as lists, the organiser and the schedule", () => {
    assert.equal(
      JATEKSZABALYZAT.cim,
      "Acropora nyereményjáték – Játékszabályzat",
    );
    assert.deepEqual(
      JATEKSZABALYZAT.szakaszok.map((x) => x.cim),
      [
        "1. A játék szervezője",
        "2. A játék időtartama",
        "3. A részvétel feltételei",
        "4. A játék menete és az érvényes nevezés",
        "5. A nevezések száma és az ismételt beküldés",
        "6. A válaszok értékelése",
        "7. Nyeremények",
        "8. A heti sorsolások",
        "9. A fődíj sorsolása",
        "10. A sorsolások dokumentálása és a pótnyertesek",
        "11. A nyertesek értesítése és a nyeremények átadása",
        "12. Visszaélések és technikai problémák",
        "13. Adatkezelés",
        "14. Kérdések és panaszok",
        "15. A szabályzat elérhetősége és módosítása",
      ],
    );
    const blokkok = JATEKSZABALYZAT.szakaszok.flatMap((x) => [
      ...szakaszBlokkok(x),
    ]);
    const tablazatok = blokkok.filter((x) => x.fajta === "tablazat");
    assert.equal(tablazatok.length, 2);
    // the rounds (section 2): round, opening, deadline; seven rounds
    assert.deepEqual(tablazatok[0]!.fejlec, [
      "Forduló",
      "A kérdés megjelenése",
      "A válaszadás és az email-megerősítés határideje",
    ]);
    assert.equal(tablazatok[0]!.sorok.length, 7);
    assert.deepEqual(tablazatok[0]!.sorok[0], [
      "1. hét",
      "2026. november 7. 22:00",
      "2026. november 14. 21:00",
    ]);
    assert.deepEqual(tablazatok[0]!.sorok[6], [
      "7. hét",
      "2026. december 19. 22:00",
      "2026. december 26. 21:00",
    ]);
    // the weekly draws (section 8): round, draw time; seven rounds, every row two cells
    assert.deepEqual(tablazatok[1]!.fejlec, ["Forduló", "Sorsolás időpontja"]);
    assert.equal(tablazatok[1]!.sorok.length, 7);
    for (const sor of tablazatok[1]!.sorok) assert.equal(sor.length, 2);
    assert.equal(blokkok.filter((x) => x.fajta === "lista").length, 7);
    assert.deepEqual(
      blokkok.filter((x) => x.fajta === "alcim").map((x) => x.szoveg),
      ["7.1. Heti nyeremények", "7.2. Fődíj"],
    );
    const szabaly = szoveg(JATEKSZABALYZAT);
    for (const mondat of [
      "Acropora Kft.",
      "Adószám: 23916229-2-42",
      "A játék 2026. november 7-én 22:00 órakor kezdődik, és hét heti fordulóból áll.",
      "A fődíj sorsolásának időpontja: 2026. december 26. 22:00.",
      "Egy játékos különböző heti fordulókban több heti nyereményt is nyerhet.",
      "A Szervező a helyes választ az adott heti forduló lezárását követően teszi közzé a játék weboldalán.",
      "1 db Aquaforest AF Nano Tank akvárium.",
      "a nyertes rövidített neve, például Kovács P.",
    ])
      assert.ok(szabaly.includes(mondat), mondat);
    assert.equal(szabaly.includes("[KITÖLTENDŐ"), false);
  });

  it("the organiser's paragraph keeps its line breaks (the name, the address, the tax number, the contact are separate lines)", () => {
    const szervezo = szakaszBlokkok(JATEKSZABALYZAT.szakaszok[0]!).find(
      (x) => x.fajta === "bekezdes" && x.sorok.length > 1,
    );
    assert.ok(szervezo && szervezo.fajta === "bekezdes");
    assert.equal(szervezo.sorok.length, 4);
    assert.equal(szervezo.sorok[0], "Acropora Kft.");
    assert.match(szervezo.sorok[3]!, /info@acropora\.hu$/);
  });

  it("the privacy notice is version 2 (Balázs's text, acrobot 44375): fourteen numbered sections after a subtitle and a lead, word for word, with the bold marks kept in the data", () => {
    assert.equal(ADATKEZELES.cim, "Adatkezelési tájékoztató");
    assert.deepEqual(
      ADATKEZELES.szakaszok.map((x) => x.cim),
      [
        "1. Az adatkezelő",
        "2. Milyen adatokat kezelünk?",
        "3. Az adatkezelés célja és jogalapja",
        "4. A nyertesek nevének közzététele",
        "5. Mennyi ideig őrizzük meg az adatokat?",
        "6. Kik férhetnek hozzá az adatokhoz?",
        "7. Nemzetközi adattovábbítás",
        "8. Technikai adatok és sütik",
        "9. Hírlevél és marketing",
        "10. A hozzájárulás visszavonása",
        "11. Milyen jogok illetnek meg?",
        "12. Panasz és bírósági jogorvoslat",
        "13. Automatizált döntések és adatbiztonság",
        "14. A tájékoztató elérhetősége és változásai",
      ],
    );
    // the subtitle and the lead come before the first section
    const bevezeto = (ADATKEZELES.bevezeto ?? [])
      .flatMap(blokkSzovegei)
      .join("\n");
    assert.match(bevezeto, /Az Acropora nyereményjáték résztvevői részére/);
    assert.match(
      bevezeto,
      /A részvételhez nem szükséges vásárolnod vagy hírlevélre feliratkoznod\./,
    );
    const adat = szoveg(ADATKEZELES);
    for (const mondat of [
      "Acropora Kft.",
      "Adószám: 23916229-2-42",
      "Ennek az adatkezelésnek a jogalapja a hozzájárulásod, a GDPR 6. cikk (1) bekezdés a) pontja alapján.",
      "A hozzájárulást a nevezési felületen található külön, alapértelmezetten üres jelölőnégyzet bejelölésével adhatod meg. A hozzájárulás megadása elkülönül a Játékszabályzat elfogadásától.",
      "ko•••@gmail.com",
      "Hetzner Online GmbH",
      "A weboldal nem használ sütit",
    ])
      assert.ok(adat.includes(mondat), mondat);
    assert.equal(adat.includes("**"), false);
    assert.equal(adat.includes("[KITÖLTENDŐ"), false);
    // the data keeps the bold marks the file has (the page turns them into <strong>)
    const nyers = JSON.stringify(ADATKEZELES);
    assert.ok(nyers.includes("**hozzájárulásod**"));
    assert.ok(nyers.includes("**Acropora Kft.**"));
  });

  it("the rules say what the system does: only correct, confirmed entries are drawn, one entry per round, confirmation by link, a chance per right week, a re-run only checks", () => {
    const szabaly = szoveg(JATEKSZABALYZAT);
    assert.match(
      szabaly,
      /kizárólag a helyes választ tartalmazó, határidőn belül beküldött és megerősített/,
    );
    assert.match(
      szabaly,
      /Egy természetes személy egy heti fordulóban egy alkalommal nevezhet/,
    );
    assert.match(szabaly, /megerősítő linkre kattintva meg kell erősítenie/);
    assert.match(szabaly, /egy megfelelően teljesített héttel egy esélyt/);
    assert.match(szabaly, /nem ad visszajelzést arról, hogy a válasz helyes-e/);
    assert.match(
      szabaly,
      /Az első szabályszerűen végrehajtott és rögzített sorsolás eredménye az irányadó\. Egy ellenőrzési célú megismétlés nem változtatja meg ezt az eredményt/,
    );
    // the weekly winners take part in the grand prize draw too (the live draw page and the weekly rule follow this)
    assert.match(
      szabaly,
      /A heti nyereményt korábban elnyerő játékos a fődíj sorsolásában: részt vehet/,
    );
  });

  it("the e-mail address is for the game and the winner's notice only: no newsletter, anywhere", () => {
    // the text of the blocks only: a section heading ("9. Hírlevél és marketing") names a topic, it is not a claim
    const mind = JOGI_DOKUMENTUMOK.map((d) =>
      [...(d.bevezeto ?? []), ...d.szakaszok.flatMap(szakaszBlokkok)]
        .flatMap(blokkSzovegei)
        .join("\n"),
    ).join("\n");
    assert.match(
      szoveg(ADATKEZELES),
      /nem szükséges vásárolnod vagy hírlevélre feliratkoznod/,
    );
    assert.match(
      szoveg(ADATKEZELES),
      /A játékhoz nem tartozik hírlevél-feliratkozás/,
    );
    // every sentence that names the newsletter denies it
    for (const mondat of mind
      .split(/(?<=\.)\s+|\n/)
      .filter((m) => /hírlevél/i.test(m)))
      assert.match(
        mondat,
        /(^|[^a-záéíóöőúüű])(nem|sem|nincs)([^a-záéíóöőúüű]|$)/i,
        mondat,
      );
  });

  it("the sections are numbered in order and none is empty", () => {
    for (const d of JOGI_DOKUMENTUMOK) {
      d.szakaszok.forEach((x, i) => {
        assert.match(x.cim, new RegExp(`^${i + 1}\\. `), d.azonosito);
        const blokkok = szakaszBlokkok(x);
        assert.ok(blokkok.length > 0, x.cim);
        const darabok = blokkok.flatMap((blokk) => blokkSzovegei(blokk));
        assert.ok(darabok.length > 0, x.cim);
        for (const darab of darabok) assert.ok(darab.trim().length > 0, x.cim);
      });
    }
  });
});
