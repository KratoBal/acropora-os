import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  comparePdfTextLines,
  readPdfTextLines,
} from "../documents/pdf/pdf-text-readback.js";

import {
  worksheetSheetLines,
  type WorksheetSheetInput,
} from "./worksheet-sheet-content.js";
import {
  worksheetSheetDocument,
  worksheetSheetFileName,
} from "./worksheet-sheet-document.js";

/**
 * A SZÓKÖZ NORMALIZÁLÁSA AZ ÖSSZEVETÉSHEZ.
 *
 * Nem kényelmi lépés: a `pdfjs` a bevezető és a halmozott szóközt elnyeli, tehát
 * a visszaolvasás azt SZERKEZETILEG nem tudja visszaadni. A mérés részletei a
 * használat helyén állnak.
 */
function szokozNelkul(sor: string): string {
  return sor.replace(/\s+/g, " ").trim();
}

function bemenet(
  overrides: Partial<WorksheetSheetInput> = {},
): WorksheetSheetInput {
  return {
    label: "BIO-2026-001/1",
    status: "SIGNED",
    customerName: "Fánk Kft.",
    customerNumber: "VEVO-A",
    jobNumber: "HJ-2026-0007",
    departmentName: "Biodóm",
    departmentCode: "BIO",
    subject: "Kompresszorok bevizsgálása",
    description: null,
    issueDate: "2026-08-27",
    fulfillmentDate: "2026-08-27",
    createdByName: "Szerelő Sándor",
    closedAt: "2026-09-17T20:00:00.000Z",
    assigneeNames: ["Kovács Anna"],
    entries: ["Szivattyú zajos."],
    lines: [
      {
        position: 1,
        description: "Kompresszor bevizsgálás",
        detail: null,
        assetNumber: "ESZK-000123",
        inventoryNumber: "UGYFEL-42",
        quantity: "2",
        unit: "óra",
        kind: "LABOR",
        workerCount: 1,
        laborHours: "2",
      },
    ],
    laborHours: "2",
    signature: null,
    continuesLabel: null,
    ...overrides,
  };
}

describe("a lap bemenetéből tárolható fájl lesz", () => {
  it("a bájtok VALÓDI PDF-et adnak, és a típus a felismerésből jön", async () => {
    /*
      MI PIROSÍT: ha a rajzoló valaha nem PDF-et adna vissza, vagy ha a
      tartalom-típust beírnánk a felismerés helyett. A generált lap ugyanabba a
      táblába kerül, mint a feltöltések, és ÉPP ŐT nevezzük hitelesnek -- tehát
      nem kaphat lazább mércét annál, amit bárki feltöltése kap.
    */
    const doc = await worksheetSheetDocument(bemenet());

    assert.equal(doc.contentType, "application/pdf");
    assert.equal(doc.content.subarray(0, 5).toString("latin1"), "%PDF-");
  });

  it("a sha256 a TARTALOMRA megy, nem valami másra", async () => {
    /*
      MI PIROSÍT: bármi, ami nem a kiadott bájtokat hasheli (a sorok szövege, a
      fájlnév, egy üres puffer). Ez a mező az EGYETLEN, amiből utólag kiderül,
      hogy a tárolt fájl azonos-e azzal, amit kiadtunk -- és ha rossz forrásból
      jön, pontosan akkor hallgat, amikor kérdeznénk tőle.
    */
    const doc = await worksheetSheetDocument(bemenet());

    assert.equal(
      doc.sha256,
      createHash("sha256").update(doc.content).digest("hex"),
    );
    assert.equal(doc.sha256.length, 64);
  });

  it("a sizeBytes a tényleges hossz, nem egy külön számolt érték", async () => {
    /*
      MI PIROSÍT: egy beégetett szám, vagy a sorok hosszából számolt méret. A
      `WorksheetDocument.sizeBytes` a keret-számításban is szerepel: egy rossz
      érték ott NEM hibázik, csak félreszámol.
    */
    const doc = await worksheetSheetDocument(bemenet());
    assert.equal(doc.sizeBytes, doc.content.length);
  });

  it("a lap SZÖVEGE visszaolvasható a bájtokból", async () => {
    /*
      EZ AZ EGYETLEN ÁLLÍTÁS, AMI A TELJES LÁNCOT JÁRJA BE: bemenet, sorok,
      beágyazott betű, PDF-bájtok, és vissza. A fentiek mind a BURKOLATRÓL
      szólnak (típus, hash, méret) -- egy üres lap mindegyiken átmenne.

      A `useSystemFonts: false` miatt a visszaolvasás a mi beágyazott betűnket
      olvassa, nem a gépét: egy hiányzó betű így nem tud elrejtőzni.

      === MIÉRT NORMALIZÁLT A SZÓKÖZ, ÉS MIÉRT NEM A KÓD HIBÁJA ===

      A lap behúzással tagol (a tétel alatt három szóközzel áll az eszköz és a
      leltári szám), és a visszaolvasás ezt NEM adja vissza. Lemérve, mielőtt az
      állítást igazítottam volna -- mert két különböző dolog ad ugyanilyen képet:

        ugyanaz a sor behúzással és anélkül   5814 kontra 5812 bájt, ELTÉR
        ugyanezek visszaolvasva               betűre AZONOS
        kontroll: két valóban más szöveg      eltér, tehát a mérés tud bontani

      Vagyis a behúzás ELJUT a PDF-be; a `pdfjs` normalizálja a bevezető és a
      halmozott szóközt. A visszaolvasó tehát SZÖVEGET mér, nem ELRENDEZÉST --
      és ez a helyes hatóköre, mert a rajzoló (`minimal-pdf.ts`) saját fejléce
      is kimondja, hogy elrendezést szándékosan nem tartalmaz.

      AMIT EZ AZ ÁLLÍTÁS NEM FOG MEG, KIMONDVA: ha a behúzás eltűnne a sorokból,
      ez zöld maradna. Azt a tartalom-modul saját állításai mérik, a sorok
      szövegén -- ott a szóköz még nem ment át semmilyen normalizáláson.
    */
    const input = bemenet();
    const doc = await worksheetSheetDocument(input);

    const vissza = await readPdfTextLines(doc.content);
    const elteres = comparePdfTextLines(
      worksheetSheetLines(input)
        .map(szokozNelkul)
        .filter((sor) => sor !== ""),
      vissza.map((sor) => ({ ...sor, text: szokozNelkul(sor.text) })),
    );

    assert.deepEqual(elteres, [], "a visszaolvasott lap eltér a tartalomtól");
    // ISMERT POZITÍV KONTROLL: a nulla eltérés nem egy ÜRES visszaolvasásról
    // szól. Ha a lap nem készülne el, itt nulla sor állna.
    assert.ok(vissza.length > 5, `gyanúsan kevés sor: ${vissza.length}`);
  });
});

describe("a fájl neve a munkalapszámból", () => {
  it("a PERJEL nem marad benne, mert az könyvtárat jelent", () => {
    /*
      MI PIROSÍT: a nyers behelyettesítés. A `BIO-2026-001/1` névből
      `munkalap-BIO-2026-001/1.pdf` lenne, és az egy KÖNYVTÁR plusz egy fájl --
      a hiba a letöltésnél vagy a tároló-kulcsnál jönne elő, a rajzolástól távol.
    */
    assert.equal(
      worksheetSheetFileName("BIO-2026-001/1"),
      "munkalap-BIO-2026-001-1.pdf",
    );
    assert.equal(worksheetSheetFileName("BIO-2026-001/1").includes("/"), false);
  });

  it("szám nélkül piszkozat-nevet kap, nem a `null` szót", () => {
    /*
      A munkalapszámot a LEZÁRÁS foglalja le, piszkozat viszont szintén kap lapot
      (a séma is ezt mondja ki). MI PIROSÍT: a `${null}` behelyettesítés, ami
      „munkalap-null.pdf"-et adna a vevő kezébe, és az üres név is, amit a
      böngésző kitalált névvel pótolna.
    */
    assert.equal(worksheetSheetFileName(null), "munkalap-piszkozat.pdf");
    assert.equal(worksheetSheetFileName("   "), "munkalap-piszkozat.pdf");
    assert.equal(worksheetSheetFileName(null).includes("null"), false);
  });

  it("vezérlőkarakter nem marad a névben", () => {
    /*
      MI PIROSÍT: ha a szűrés csak a perjelre szólna. A munkalapszám ma gépi, de
      a név a vevő fájlrendszerébe kerül -- és ez a függvény a fájlnév EGYETLEN
      őrzője.
    */
    /*
      A VEZERLOKARAKTEREKET FUTASIDOBEN ALLITJUK ELO, NEM A FORRASBA IRJUK.

      Merve: a forrasba irt escape a szerkesztesi lancon LITERALIS bajtta valt
      (NUL es 0x1f allt a fajlban). Az allitas ugy is mert, csak epp
      LATHATATLANUL -- egy ilyen sor a kovetkezo olvasonak elgepelesnek latszik,
      es barmelyik eszkoz csendben elviheti.
    */
    const vezerlo = String.fromCharCode(0) + "2026" + String.fromCharCode(31);
    const nev = worksheetSheetFileName(`BIO${vezerlo}001`);
    assert.equal(/\p{Cc}/u.test(nev), false);
    // ISMERT POZITÍV KONTROLL: a törzs megmaradt, nem az egészet dobtuk el.
    assert.ok(nev.includes("BIO"));
  });

  it("a fájl neve a dokumentumba is a szám szerint kerül", async () => {
    /*
      MI PIROSÍT: ha a `worksheetSheetDocument` nem a névadót hívná, hanem
      beírna egy állandó nevet. A fenti három állítás a NÉVADÓT méri; ez a
      BEKÖTÉST -- és az a hely, ami külön tud kimaradni.
    */
    const doc = await worksheetSheetDocument(
      bemenet({ label: "BIO-2026-009/2" }),
    );
    assert.equal(doc.fileName, "munkalap-BIO-2026-009-2.pdf");
  });
});
