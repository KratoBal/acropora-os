import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  DRAFT_MARK,
  sheetDate,
  worksheetSheetLines,
  type WorksheetSheetInput,
} from "./worksheet-sheet-content.js";

function sheet(
  overrides: Partial<WorksheetSheetInput> = {},
): WorksheetSheetInput {
  return {
    label: "BIO-2026-001/1",
    status: "AWAITING_SIGNATURE",
    customerName: "Fánk Kft.",
    departmentName: "Biodóm",
    departmentCode: "BIO",
    subject: "Kompresszorok bevizsgálása",
    description: null,
    issueDate: "2026-08-27",
    fulfillmentDate: "2026-08-27",
    createdByName: "Szerelő Sándor",
    closedAt: "2026-09-17T20:00:00.000Z",
    assigneeNames: ["Kovács Anna"],
    entries: [],
    lines: [
      {
        position: 1,
        description: "Kompresszor bevizsgálás",
        detail: null,
        inventoryNumber: null,
        quantity: "2",
        unit: "óra",
        kind: "LABOR",
        workerCount: 1,
        laborHours: "2",
      },
    ],
    laborHours: "2",
    signature: null,
    ...overrides,
  };
}

const szoveg = (input: WorksheetSheetInput) =>
  worksheetSheetLines(input).join("\n");

describe("a nyomtatott munkalap tartalma", () => {
  it("a NEM aláírt lap piszkozat-jelölést visel, a legelső sorban", () => {
    const sorok = worksheetSheetLines(sheet({ status: "AWAITING_SIGNATURE" }));

    /*
      A HELY IS ÁLLÍTÁS, NEM CSAK A MEGLÉT. Egy kinyomtatott papíron a végén álló
      megjegyzés akkor derül ki, amikor már elolvasták -- és ha valaki csak az
      első oldalt adja tovább, sosem.
    */
    assert.equal(sorok[0], DRAFT_MARK);
  });

  it("az ALÁÍRT lapon NINCS jelölés", () => {
    /*
      A TILTÓ ÁG KÜLÖN ÁLL, ÉS EZ A LÉNYEG: a fenti állítás akkor is zöld lenne,
      ha a jelölés MINDEN lapon ott állna -- és akkor épp a véglegeset jelölnénk
      meg nem véglegesnek.
    */
    const alairt = szoveg(
      sheet({
        status: "SIGNED",
        signature: {
          decision: "ACCEPTED",
          signerName: "Nagy Béla",
          signedAt: "2026-09-17T20:10:00.000Z",
          note: null,
        },
      }),
    );

    assert.equal(alairt.includes(DRAFT_MARK), false);
    // ISMERT POZITÍV KONTROLL: a lap egyáltalán elkészült.
    assert.match(alairt, /MUNKALAP {2}BIO-2026-001\/1/);
  });

  it("ÁR SEHOL nem áll a lapon", () => {
    /*
      Balázs döntése 2026-09-17 19:17 és 19:21 (a „b" út): a nettó, a bruttó és az
      áfa sehol nem jelenik meg -- a weben, az appban, és a NYOMTATOTT lapon sem.

      MI PIROSÍT: bármelyik ár-mező visszatérése. A fixtúra szándékosan nem is
      hordoz árat: a bemeneti típus nem viseli. Ez az állítás azt őrzi, hogy ne is
      kerüljön bele.
    */
    const lap = szoveg(sheet());

    for (const szo of ["Ft", "nettó", "bruttó", "áfa", "ÁFA", "Egységár"])
      assert.equal(lap.includes(szo), false, `ár-nyom a lapon: ${szo}`);

    // ISMERT POZITÍV KONTROLL: a lap nem üres, tehát a fenti hat nulla nem
    // egy meg sem rajzolt lapról szól.
    assert.match(lap, /Kompresszor bevizsgálás/);
  });

  it("a felelősök neve és a napló RÁKERÜL", () => {
    /*
      Balázs, 2026-09-17 22:49:52, Discord, szó szerint: „1 igen, 2 igen" -- a
      kérdés a szerelők nevére és a munkalap naplójára szólt.
    */
    const lap = szoveg(
      sheet({
        assigneeNames: ["Kovács Anna", "Nagy Béla"],
        entries: ["Szivattyú zajos, cserélve."],
      }),
    );

    assert.match(lap, /Dolgozott rajta: Kovács Anna, Nagy Béla/);
    assert.match(lap, /NAPLÓ/);
    assert.match(lap, /- Szivattyú zajos, cserélve\./);
  });

  it("üres naplónál a szakasz SEM áll ki", () => {
    /*
      Mérve az éles adatbázison (acrobot, 2026-09-17 23:01): EGYETLEN bejegyzés
      van, 26 karakter. A mező tehát nem meglévő szokás, hanem mostantól telik meg
      -- egy üres „NAPLÓ" fejléc a lapok túlnyomó többségén azt állítaná, hogy
      hiányzik valami.
    */
    assert.equal(szoveg(sheet({ entries: [] })).includes("NAPLÓ"), false);
  });

  it("az összes munkaóra akkor is kiíródik, ha NULLA", () => {
    /*
      Egy elrejtett nulla két állapotot mosna össze: hogy nincs munkaóra-tétel a
      lapon, és hogy a sor elmaradt. A „0" állítás; a hiányzó sor kérdés.
    */
    assert.match(szoveg(sheet({ laborHours: "0" })), /Összes munkaóra: 0/);
  });

  it("a létszám és a munkaóra csak akkor áll ki, ha mást mond a mennyiségnél", () => {
    const egyFo = szoveg(sheet());
    assert.match(egyFo, /2 óra/);
    assert.equal(egyFo.includes("munkaóra\n"), false);
    assert.equal(egyFo.includes("fő"), false);

    const ketten = szoveg(
      sheet({
        lines: [
          {
            position: 1,
            description: "Kompresszor bevizsgálás",
            detail: null,
            inventoryNumber: null,
            quantity: "0,5",
            unit: "óra",
            kind: "LABOR",
            workerCount: 2,
            laborHours: "1",
          },
        ],
      }),
    );
    assert.match(ketten, /0,5 óra · 2 fő · 1 munkaóra/);
  });

  it("az ÜGYFÉL saját eszközkódja rákerül", () => {
    const lap = szoveg(
      sheet({
        lines: [
          {
            position: 1,
            description: "Kompresszor bevizsgálás",
            detail: null,
            inventoryNumber: "UGYFEL-42",
            quantity: "2",
            unit: "óra",
            kind: "LABOR",
            workerCount: 1,
            laborHours: "2",
          },
        ],
      }),
    );
    assert.match(lap, /Leltári szám: UGYFEL-42/);
  });
});

describe("a dátum a lapon budapesti naptár szerint áll", () => {
  it("egy KÉSŐ ESTI UTC bélyeg nem csúszik át másnapra", () => {
    /*
      MI PIROSÍT: a nyers ISO előtag levágása (`value.slice(0, 10)`). A
      `2026-09-17T22:30:00Z` bélyeg budapesti idő szerint MÁR 2026-09-18 -- a
      levágás 09-17-et írna a lapra. Fordítva ugyanígy: egy `2026-09-17T23:30:00Z`
      bélyeg nálunk 09-18.
    */
    assert.equal(sheetDate("2026-09-17T23:30:00.000Z"), "2026-09-18");
  });

  it("a csupasz nap változatlanul megy át", () => {
    assert.equal(sheetDate("2026-08-27"), "2026-08-27");
  });

  it("a hiány hiány marad, nem lesz belőle dátum", () => {
    assert.equal(sheetDate(null), null);
  });
});

/**
 * A NYOLC ELDÖNTETLEN MEZŐ ŐRZŐJE.
 *
 * === MIÉRT A TÍPUST MÉRI, ÉS NEM A KIMENETET ===
 *
 * Azt, hogy egy mező NINCS a lapon, a kimeneten nem lehet állítani: a fixtúra
 * nem is hordozza, tehát a hiánya minden változat mellett igaz lenne. Ez díszlet
 * volna.
 *
 * Ami MÉRHETŐ: hogy a bemeneti típus nem is KÉRI őket. Ha valaki felveszi a
 * `jobNumber` mezőt, ez az állítás pirosodik, és a neve megmondja, miért: nem
 * elfelejtettük, hanem NINCS RÁ DÖNTÉS. A lap a vevő kezébe megy.
 */
describe("amire nincs döntés, az nincs a lapon", () => {
  it("a bemeneti típus mezői pontosan a döntött halmaz", () => {
    const forras = readFileSync(
      "src/worksheets/worksheet-sheet-content.ts",
      "utf8",
    );
    // POZITÍV KONTROLL A BEOLVASÁSRA: rossz útvonalnál a lenti keresés nulla
    // találata a fájl hiányáról szólna, nem a típusról.
    assert.ok(forras.length > 2000, "üres vagy gyanúsan rövid forrás");

    const blokk = /export interface WorksheetSheetInput \{([\s\S]*?)\n\}/.exec(
      forras,
    );
    if (!blokk) throw new Error("nincs WorksheetSheetInput a forrásban");

    const mezok = [...(blokk[1] ?? "").matchAll(/^ {2}(\w+)\??:/gm)]
      .map((m) => m[1])
      .sort();

    assert.deepEqual(mezok, [
      "assigneeNames",
      "closedAt",
      "continuesLabel",
      "createdByName",
      "customerName",
      "departmentCode",
      "departmentName",
      "description",
      "entries",
      "fulfillmentDate",
      "issueDate",
      "label",
      "laborHours",
      "lines",
      "signature",
      "status",
      "subject",
    ]);
  });

  it("a tétel típusa sem kéri a MI eszközszámunkat", () => {
    /*
      Az ügyfél SAJÁT kódja (`inventoryNumber`) rákerül -- az az övé. A mienk
      (`assetNumber`) a mi nyilvántartásunké, és arról nincs döntés.
    */
    const forras = readFileSync(
      "src/worksheets/worksheet-sheet-content.ts",
      "utf8",
    );
    const blokk = /export interface WorksheetSheetLine \{([\s\S]*?)\n\}/.exec(
      forras,
    );
    if (!blokk) throw new Error("nincs WorksheetSheetLine a forrásban");

    /*
      A KOMMENTEKET KI KELL SZEDNI, ÉS EZT A SAJÁT PIROSOM TANÍTOTTA MEG: a
      `inventoryNumber` fölötti magyarázat SZÓ SZERINT leírja, hogy „a mienk
      (assetNumber) NEM kerül a lapra" -- tehát a szó ott áll a blokkban, és a
      nyers keresés a saját mondatunkat találta meg, nem egy mezőt.

      Ugyanaz az alak, mint a minta-söprő eszközben: a magyarázó szövegünk
      ugyanazokat a szavakat használja, amiket a keresés keres.
    */
    const kodOnly = (blokk[1] ?? "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    assert.equal(kodOnly.includes("assetNumber"), false);
    // ISMERT POZITÍV KONTROLL: az ügyfél kódja VISZONT ott van, MEZŐKÉNT --
    // szintén a komment nélküli szövegben, különben a kontroll a magyarázatot
    // találná meg, és akkor a szűrés hibáját nem venné észre.
    assert.match(kodOnly, /inventoryNumber/);
  });
});
