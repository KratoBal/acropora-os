import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import PizZip from "pizzip";

import { renderMaintenanceOrderFormDocx } from "./maintenance-order-form-docx.js";
import { resolveMaintenanceOrderFormTemplatePath } from "./maintenance-order-form-template-path.js";
import type { MaintenanceOrderFormInput } from "./maintenance-order-form.types.js";

const TEMPLATE_PATH = resolveMaintenanceOrderFormTemplatePath();

function baseInput(
  items: MaintenanceOrderFormInput["items"],
): MaintenanceOrderFormInput {
  return {
    customer: {
      name: "Fővárosi Állat- és Növénykert",
      address: "1146 Budapest, Állatkerti krt. 6-12.",
      organizationalUnitName: "Üzemeltetési Osztály",
      chargeCode: "6719Ü",
      contactPersonName: "Sándor Zsolt",
    },
    contractNumber: "SZ2026/0000019",
    items,
    issuedAt: "2026-09-25",
    sequenceNumber: "2026/0003",
    ownBudgetSource: true,
    warehouseCoordinated: true,
  };
}

function item(
  position: number,
  description: string,
): MaintenanceOrderFormInput["items"][number] {
  return {
    position,
    description,
    unitPricePerOccasion: 100000,
    quantity: 1,
    occasionsPerYear: 2,
    vatRatePercent: 27,
  };
}

/** A kimenet szövegtartalma, futás-határok nélkül (ugyanaz a minta, mint a
 * `pdf-text-readback.ts`/`worksheet-sheet-document.spec.ts` szöveg-
 * kigyűjtése, csak itt a forrás docx XML, nem PDF). */
function extractText(content: Buffer): string {
  const zip = new PizZip(content);
  const xml = zip.files["word/document.xml"]?.asText() ?? "";
  return [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
    .map((m) => m[1])
    .join("");
}

describe("renderMaintenanceOrderFormDocx", () => {
  it("POZITÍV KONTROLL: a kimenet megnyitható docx, és a tételek száma egyezik a bemenettel", async () => {
    const input = baseInput([
      item(1, "Cápasuli RO karbantartás"),
      item(5, "Cápasuli nagymedence gépészet"),
      item(6, "Cápasuli középső medence gépészet"),
    ]);
    const result = await renderMaintenanceOrderFormDocx(input);

    // "Megnyitható": a PizZip nem dob hibát, és a kötelező docx-részek megvannak.
    const zip = new PizZip(result.content);
    assert.ok(zip.files["word/document.xml"], "hiányzik a word/document.xml");
    assert.ok(
      zip.files["[Content_Types].xml"],
      "hiányzik a [Content_Types].xml",
    );

    assert.equal(result.itemCount, 3);
  });

  /**
   * HÁROM KÜLÖNBÖZŐ TÉTELSZÁM, KÜLÖN-KÜLÖN -- Balázs kifejezett kérése,
   * hogy a tétel-sor ismétlődjön, nem csak egy rögzített darabszámra menjen.
   */
  for (const count of [1, 3, 5]) {
    it(`${count} tétellel a táblázat pontosan ${count} sort kap`, async () => {
      const items = Array.from({ length: count }, (_, i) =>
        item(i + 1, `Tétel ${i + 1}`),
      );
      const result = await renderMaintenanceOrderFormDocx(baseInput(items));
      assert.equal(result.itemCount, count);

      const text = extractText(result.content);
      for (let i = 1; i <= count; i++) {
        assert.ok(
          text.includes(`Tétel ${i}`),
          `a(z) ${i}. tétel leírása hiányzik a kimenetből`,
        );
      }
    });
  }

  /**
   * A HOSSZÚ Ő/Ű (ÉS A TÖBBI ÉKEZET) A SABLON SAJÁT BETŰIVEL JELENIK MEG --
   * ez volt a korábbi PDF-rajzoló `registerEmbeddedPdfFont`-jának egyetlen
   * oka (lásd a PDF-modul törölt fejlécét): az ékezetek NÉMÁN elromolhatnak,
   * ha a betű-beágyazás hiányzik. A docx-nél ez a kockázat MÁS: nem betű-
   * beágyazás, hanem run-szintű szöveg-darabolás (lásd a docx renderer saját
   * fejlécét) -- ez az állítás azt méri, hogy az UTF-8 karakterek épek
   * maradnak a jelölő-behelyettesítés után is.
   */
  it("a hosszú ő/ű és a többi ékezet sértetlen a kimenetben", async () => {
    const input = baseInput([item(1, "Fordított ozmózis berendezés őrző")]);
    input.customer.contactPersonName = "Őrző Űrhajós";
    const result = await renderMaintenanceOrderFormDocx(input);
    const text = extractText(result.content);

    assert.ok(text.includes("Fővárosi Állat- és Növénykert"));
    assert.ok(text.includes("Üzemeltetési Osztály"));
    assert.ok(text.includes("Őrző Űrhajós"));
    assert.ok(text.includes("Fordított ozmózis berendezés őrző"));
    // NEGATÍV KONTROLL: a kérdőjel-minta (�) NEM jelenik meg -- ez a tünete
    // egy elromlott kódolásnak, amit ez az állítás közvetlenül kizár.
    assert.doesNotMatch(text, /�/);
  });

  /**
   * A KIMENET CSAK A KITÖLTÖTT RÉSZEKEN TÉR EL A SABLONTÓL -- Balázs
   * kifejezett kérése ("csak a kitoltott reszek terhetnek el"). Az összes,
   * NEM `word/document.xml` zip-bejegyzés (stílusok, betűtábla, téma,
   * `[Content_Types].xml`) TARTALMILAG egyezik a sablonnal, mert a renderer
   * ezeket sosem érinti.
   *
   * NEM BÁJTRA, HANEM SOR VÉGI JEL NÉLKÜL NORMALIZÁLVA: mérve (2026-09-25),
   * a `docxtemplater` a `getZip().generate()` hívásban MINDEN xml-részt
   * újraszerializál, és ez a sablon eredeti `\r\n` XML-prológját `\n`-re
   * cseréli -- ez a zip/XML szintjén tartalmatlan, jelentés nélküli eltérés
   * (a szövegen kívüli whitespace-t egyetlen OOXML-olvasó sem veszi
   * figyelembe), tehát a `\r\n`->`\n` normalizálás UTÁN kell egyeznie, nem
   * előtte -- egy nyers bájt-összevetés itt HAMIS pirosat adna.
   */
  it("minden zip-bejegyzés a word/document.xml kivételével (sorvég-normalizálva) egyezik a sablonnal", async () => {
    const templateBytes = readFileSync(TEMPLATE_PATH);
    const templateZip = new PizZip(templateBytes);
    const result = await renderMaintenanceOrderFormDocx(
      baseInput([item(1, "Teszt tétel")]),
    );
    const outputZip = new PizZip(result.content);

    /*
      A KÖNYVTÁR-BEJEGYZÉSEK (pl. "word/") KIMARADNAK: a docxtemplater saját
      `generate()`-je explicit könyvtár-rekordokat ír a zipbe, a sablon eredeti
      csomagolása nem -- ez a zip-formátum ártalmatlan, tartalmatlan eltérése,
      nem a dokumentum tartalmáé, tehát nem tartozik ehhez az állításhoz.
    */
    const fileNames = (files: PizZip["files"]) =>
      Object.entries(files)
        .filter(([, entry]) => !entry.dir)
        .map(([name]) => name)
        .sort();
    const templateNames = fileNames(templateZip.files);
    const outputNames = fileNames(outputZip.files);
    assert.deepEqual(
      outputNames,
      templateNames,
      "a kimenet más fájlkészletet visel, mint a sablon",
    );

    const normalizeLineEndings = (text: string) => text.replace(/\r\n/g, "\n");

    for (const name of templateNames) {
      if (name === "word/document.xml") continue;
      const templateText = normalizeLineEndings(
        templateZip.files[name]!.asText(),
      );
      const outputText = normalizeLineEndings(outputZip.files[name]!.asText());
      assert.equal(
        outputText,
        templateText,
        `a(z) ${name} eltér a sablontól, holott a renderer nem érinti`,
      );
    }
  });

  /**
   * A SABLON SAJÁT, ÁLLANDÓ FELIRATAI VÁLTOZATLANOK -- azok a szövegek,
   * amiket a renderer SZÁNDÉKOSAN nem jelöl (lásd a modul fejlécét: "A
   * megrendelés tárgya" utáni állandó kategória-szöveg, a szállító neve és
   * címe, a teljesítési/fizetési határidő mintaszövege). Ha ezek eltűnnének
   * vagy megváltoznának, az azt jelentené, hogy a jelölés véletlenül egy
   * STATIKUS feliratot is levágott.
   */
  it("a sablon állandó feliratai (nem kitöltendő mezők) változatlanul megjelennek", async () => {
    const result = await renderMaintenanceOrderFormDocx(
      baseInput([item(1, "Teszt tétel")]),
    );
    const text = extractText(result.content);

    assert.match(
      text,
      /Vízgépészet és akvarisztikai berendezések\s*karbantartása\s*\/javítása/,
      "a megrendelés tárgyának állandó szövege hiányzik vagy megváltozott",
    );
    assert.match(text, /ACROPORA\s*Kft/);
    assert.match(text, /1106 Budapest, Pesti Gábor utca 35\./);
    assert.match(text, /megrendeléstől számított 30 napon belül/);
    assert.match(text, /Megrendelő/);
    assert.match(text, /Pénzügyi ellenjegyző/);
    assert.match(text, /Kötelezettségvállaló/);
  });

  /**
   * NINCS BEÉGETETT JELÖLŐ A KIMENETBEN -- ha egy `{tag}` bennmaradna,
   * az azt jelentené, hogy a `render()` hívás kihagyott egy mezőt (elgépelt
   * kulcs, vagy hiányzó bemenet a `nullGetter` védelme ellenére).
   */
  it("a kimenetben nem marad nyitott {jelölő}", async () => {
    const result = await renderMaintenanceOrderFormDocx(
      baseInput([item(1, "Teszt tétel")]),
    );
    const text = extractText(result.content);
    assert.doesNotMatch(text, /\{[a-zA-Z#/]+\}/);
  });

  it("hiányzó opcionális mezők üres szöveget adnak, nem dobott hibát", async () => {
    const input = baseInput([item(1, "Teszt tétel")]);
    delete input.customer.organizationalUnitName;
    delete input.customer.chargeCode;
    delete input.customer.contactPersonName;
    delete input.customer.registrationNumber;
    await assert.doesNotReject(renderMaintenanceOrderFormDocx(input));
  });

  /**
   * AZ EGYETLEN MEZŐ, AHOL A HIÁNY NEM ÜRES SZÖVEG, HANEM A MINTA SAJÁT
   * PONTOZOTT VONALA -- lásd a renderer `REGISTRATION_NUMBER_BLANK`
   * fejlécét és a `.types.ts` `registrationNumber` dokumentációját. Ha ez
   * a teszt pirosra váltana, az azt jelentené, hogy a mező csendben üres
   * sorrá egyszerűsödött, holott a papíron hely marad a kézzel írt
   * kitöltésnek.
   */
  it("hiányzó Iktatási száma a minta saját pontozott vonalát adja, nem üres szöveget", async () => {
    const input = baseInput([item(1, "Teszt tétel")]);
    delete input.customer.registrationNumber;
    const result = await renderMaintenanceOrderFormDocx(input);
    const text = extractText(result.content);
    assert.ok(
      text.includes("Iktatási száma:…….………....…………"),
      "a hiányzó Iktatási száma nem a minta pontozott vonalát adta",
    );
  });

  it("a bemeneti pénzösszegek helyesen összegződnek a lábléc-sorokban", async () => {
    const input = baseInput([item(1, "Tétel A"), item(2, "Tétel B")]);
    // 100 000 Ft x 1 x 2 alkalom = 200 000 nettó, tételenként; két tétel: 400 000 nettó,
    // 108 000 ÁFA (27%), 508 000 bruttó -- ugyanaz a szám, amit
    // `formatOrderFormSummaryAmount` maga adna, itt a kimeneten mérve.
    const result = await renderMaintenanceOrderFormDocx(input);
    const text = extractText(result.content);
    assert.ok(
      text.includes("508.000,- Ft"),
      "bruttó összeg hiányzik vagy hibás",
    );
    assert.ok(
      text.includes("400.000,- Ft"),
      "nettó összeg hiányzik vagy hibás",
    );
    assert.ok(text.includes("108.000,- Ft"), "ÁFA összeg hiányzik vagy hibás");
  });
});
