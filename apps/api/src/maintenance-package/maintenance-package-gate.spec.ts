import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  maintenancePackageBlockers,
  maintenancePackageBlockMessage,
  maintenancePackageIsBlocked,
} from "./maintenance-package-gate.js";

const KESZ_LAP = {
  id: "ws-1",
  number: "ML-2026-001",
  hidden: false,
  closed: true,
  hasIssuedSheet: true,
};

function input(
  overrides: Partial<Parameters<typeof maintenancePackageBlockers>[0]> = {},
) {
  return {
    worksheets: [KESZ_LAP],
    hasCertificate: true,
    certificateSigned: true,
    invoicePresent: false,
    purpose: "download" as const,
    ...overrides,
  };
}

describe("maintenancePackageBlockers", () => {
  it("mindent rendben találva a letöltés nem blokkolt", () => {
    const blockers = maintenancePackageBlockers(input());
    assert.equal(maintenancePackageIsBlocked(blockers), false);
  });

  /**
   * KALIBRÁCIÓ: ha a `purpose` ága hiányozna, ez az állítás is `false`-t
   * adna számla nélkül -- ez a teszt pont azt méri, hogy a `send` cél
   * ténylegesen szigorúbb, mint a `download`.
   */
  it("mindent rendben találva, de számla nélkül a kiküldés blokkolt", () => {
    const blockers = maintenancePackageBlockers(input({ purpose: "send" }));
    assert.equal(maintenancePackageIsBlocked(blockers), true);
    assert.deepEqual(blockers.job, ["no-invoice"]);
  });

  it("számlával a kiküldés is átmegy", () => {
    const blockers = maintenancePackageBlockers(
      input({ purpose: "send", invoicePresent: true }),
    );
    assert.equal(maintenancePackageIsBlocked(blockers), false);
  });

  /*
    A SZTORNÓZOTT SZÁMLA NEM KIÁLLÍTOTT SZÁMLA (kártya 2cd1ed80; barracuda a #2935-ön): a felület a #2927 óta így mondja, a szerver
    kapuja eddig a sztornózott számlát jelenlévőnek vette. MI PIROSÍT: ha sztornózott számlával a kiküldés átmegy; ha a letöltést
    megállítja; ha a mondat nem mondja ki, hogy a számlát sztornózták.
  */
  it("sztornózott számlával a kiküldés megáll, saját okkal; a letöltés nem", () => {
    const send = maintenancePackageBlockers(
      input({ purpose: "send", invoicePresent: true, invoiceCancelled: true }),
    );
    assert.deepEqual(send.job, ["invoice-cancelled"]);
    assert.match(
      maintenancePackageBlockMessage(send),
      /A kiállított számlát sztornózták: a kiküldéshez új, kiállított számla kell\./,
    );
    const download = maintenancePackageBlockers(
      input({ invoicePresent: true, invoiceCancelled: true }),
    );
    assert.equal(maintenancePackageIsBlocked(download), false);
    // without an issued invoice the old reason stands alone
    assert.deepEqual(
      maintenancePackageBlockers(
        input({ purpose: "send", invoiceCancelled: true }),
      ).job,
      ["no-invoice"],
    );
  });

  /*
    LUCA DÖNTÉSE (2026-11-18 14:43 UTC, acrobot 55966): „ha le akarom tölteni a csomagot, akkor tudjam letölteni. ne legyenek feltételek. egy feltétel maradjon, hogy a munkalap legyen lezárva.”
    A LETÖLTÉS tehát az igazolást nem kéri (se kiállítva, se aláírva): a csomagba bekerül, ha van. A KIKÜLDÉS kapuja marad (arról nem döntött). MI PIROSÍT: ha a letöltés igazolás
    hiányában blokkol; ha a kiküldés már nem kéri az igazolást vagy az aláírt példányát; ha a lezárt, de példány nélküli munkalap letöltésnél átmegy.
  */
  it("igazolás nélkül a LETÖLTÉS NEM blokkolt (Luca)", () => {
    const blockers = maintenancePackageBlockers(
      input({ hasCertificate: false, certificateSigned: false }),
    );
    assert.equal(maintenancePackageIsBlocked(blockers), false);
    assert.deepEqual(blockers.job, []);
  });

  it("kiállított, de alá nem írt igazolással a LETÖLTÉS NEM blokkolt (Luca)", () => {
    const blockers = maintenancePackageBlockers(
      input({ hasCertificate: true, certificateSigned: false }),
    );
    assert.equal(maintenancePackageIsBlocked(blockers), false);
  });

  it("a KIKÜLDÉS kapuja marad: igazolás nélkül no-certificate, alá nem írva certificate-not-signed", () => {
    assert.deepEqual(
      maintenancePackageBlockers(
        input({
          purpose: "send",
          hasCertificate: false,
          certificateSigned: false,
          invoicePresent: true,
        }),
      ).job,
      ["no-certificate"],
    );
    assert.deepEqual(
      maintenancePackageBlockers(
        input({
          purpose: "send",
          hasCertificate: true,
          certificateSigned: false,
          invoicePresent: true,
        }),
      ).job,
      ["certificate-not-signed"],
    );
  });

  it("a lezárt, de kiadott példány nélküli munkalap (adathiba) a letöltést is megállítja", () => {
    const blockers = maintenancePackageBlockers(
      input({ worksheets: [{ ...KESZ_LAP, hasIssuedSheet: false }] }),
    );
    assert.equal(maintenancePackageIsBlocked(blockers), true);
    assert.equal(blockers.worksheets[0]?.reason, "no-issued-sheet");
  });

  it("lezáratlan munkalap blokkolja a letöltést is", () => {
    const blockers = maintenancePackageBlockers(
      input({
        worksheets: [{ ...KESZ_LAP, closed: false, hasIssuedSheet: false }],
      }),
    );
    assert.equal(maintenancePackageIsBlocked(blockers), true);
    assert.equal(blockers.worksheets[0]?.reason, "not-closed");
  });
});

describe("maintenancePackageBlockMessage", () => {
  it("egy mondatban mondja ki az összes okot egyszerre", () => {
    const blockers = maintenancePackageBlockers(
      input({
        worksheets: [{ ...KESZ_LAP, closed: false, hasIssuedSheet: false }],
        hasCertificate: false,
        purpose: "send",
      }),
    );
    const message = maintenancePackageBlockMessage(blockers);
    assert.match(message, /Nincs lezárva: ML-2026-001/);
    assert.match(message, /Nincs kiállítva teljesítési igazolás/);
    assert.match(message, /Nincs kiállítva számla/);
  });

  /*
    A STAGE-VÉGIGJÁRÁS TALÁLTA (2026-11-18, acrobot 56068): a szerződéstételekből jött munkalap-piszkozatnak még nincs száma, és a mondat négyszer ugyanazt írta: "szám nélküli munkalap, szám
    nélküli munkalap, ..." -- a kezelő nem tudta, melyiket zárja. MI PIROSÍT: ha a számtalan munkalapot újra "szám nélküli munkalap" néven nevezi, amikor van tárgya; ha a számmal bíró
    lapot nem a száma nevezi; ha a tárgy nélküli számtalan lap neve eltűnik (marad a régi mondat).
  */
  it("a számtalan munkalapot a tárgya nevezi meg, a számmal bírót a száma", () => {
    const piszkozat = (id: string, subject: string | null) => ({
      ...KESZ_LAP,
      id,
      number: null,
      subject,
      closed: false,
      hasIssuedSheet: false,
    });
    const message = maintenancePackageBlockMessage(
      maintenancePackageBlockers(
        input({
          worksheets: [
            piszkozat("a", "Cápasuli kis medence"),
            piszkozat("b", "Cápasuli nagymedence"),
            { ...KESZ_LAP, id: "c", closed: false, hasIssuedSheet: false },
          ],
        }),
      ),
    );
    assert.match(message, /„Cápasuli kis medence” \(piszkozat\)/);
    assert.match(message, /„Cápasuli nagymedence” \(piszkozat\)/);
    assert.match(message, /ML-2026-001/);
    assert.doesNotMatch(message, /szám nélküli munkalap/);
  });

  it("a tárgy nélküli számtalan munkalap neve marad a régi mondat", () => {
    const message = maintenancePackageBlockMessage(
      maintenancePackageBlockers(
        input({
          worksheets: [
            {
              ...KESZ_LAP,
              number: null,
              subject: null,
              closed: false,
              hasIssuedSheet: false,
            },
          ],
        }),
      ),
    );
    assert.match(message, /Nincs lezárva: szám nélküli munkalap\./);
  });
});

describe("a hozzárendelt (kapcsolódó) munkalapok a kapuban (Luca, kártya 5afb868a)", () => {
  const LEZARATLAN = {
    ...KESZ_LAP,
    id: "ws-2",
    number: "ML-2026-050",
    closed: false,
  };

  it("a kész hozzárendelt lap nem tartja vissza a letöltést", () => {
    const blockers = maintenancePackageBlockers(
      input({ linkedWorksheets: [KESZ_LAP] }),
    );
    assert.equal(maintenancePackageIsBlocked(blockers), false);
  });

  it("a lezáratlan hozzárendelt lap önmagában is visszatart, a lapon létrehozott lista üresen marad", () => {
    const blockers = maintenancePackageBlockers(
      input({ linkedWorksheets: [LEZARATLAN] }),
    );
    assert.equal(maintenancePackageIsBlocked(blockers), true);
    assert.equal(blockers.worksheets.length, 0);
    assert.deepEqual(
      blockers.linkedWorksheets.map((item) => [item.sheet.number, item.reason]),
      [["ML-2026-050", "not-closed"]],
    );
  });

  it("a mondat a hozzárendelt lapra szól: lezárni vagy a kapcsolatot levenni, nem a lapról levenni", () => {
    const message = maintenancePackageBlockMessage(
      maintenancePackageBlockers(input({ linkedWorksheets: [LEZARATLAN] })),
    );
    assert.match(
      message,
      /A hozzárendelt munkalap nincs lezárva: ML-2026-050\. Zárd le, vagy vedd le a kapcsolatot a karbantartási lapról\./,
    );
    assert.doesNotMatch(message, /Nincs lezárva:/);
  });

  it("hozzárendelt lap megadása nélkül a kapu a régi (a mező elhagyható)", () => {
    const blockers = maintenancePackageBlockers(input());
    assert.deepEqual(blockers.linkedWorksheets, []);
  });
});
