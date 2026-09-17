import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { renderMinimalPdf } from "./minimal-pdf.js";
import { reportPdfFontLocation } from "./pdf-font.cli.js";
import { resolvePdfFontPath } from "./pdf-font.js";
import {
  comparePdfTextLines,
  readPdfTextLines,
  type PdfTextLine,
} from "./pdf-text-readback.js";

/**
 * A MAGYAR ÉKEZETEK TÚLÉLIK-E A PDF-ET -- TÉTELESEN, NEM MONDATOKON.
 *
 * === MIÉRT BETŰNKÉNT, ÉS MIÉRT NEM EGY PRÓBAMONDATTAL ===
 *
 * Az első mérésem egy magyar mondatot olvasott vissza, és ATTÓL MÉG HIÁNYOS
 * VOLT: nem volt benne `í`, nem volt benne `ü`, és a bukás nem mondta meg,
 * MELYIK betűn. A tételes alak mindkettőt megoldja: kilenc sor, mindegyik
 * megnevezve, kisbetű és nagybetű egy sorban.
 *
 * === A VÁLASZTÓ ESET, ÉS MIÉRT PONT AZ ===
 *
 * A beépített (base-14) betű WinAnsi kódolással dolgozik, ami HÉT alakot ismer
 * a kilencből. A `ő` és az `ű` NEM fér bele, és a hiba néma (mérve: a "ő Ő"
 * párból `"P"` lesz, a "ű Ű"-ből `"p"`). Vagyis egy próba, amiben csak `á` és
 * `é` áll, a beépített betűn is ZÖLD -- attól a fixtúrától a beágyazás
 * ELHAGYÁSA sem pirosodna ki.
 *
 * A kalibráció ezt igazolta vissza (2026-09-16): ha a `minimal-pdf.ts` a
 * beágyazott betű helyett `"Helvetica"`-t választ, ez a készlet PONTOSAN a két
 * kettős ékezetes sorra pirosodik, névvel, a többi hét zöld marad.
 */

interface AccentCase {
  name: string;
  lower: string;
  upper: string;
}

const ACCENT_CASES: readonly AccentCase[] = [
  { name: "a-vesszo", lower: "á", upper: "Á" },
  { name: "e-vesszo", lower: "é", upper: "É" },
  { name: "i-vesszo", lower: "í", upper: "Í" },
  { name: "o-vesszo", lower: "ó", upper: "Ó" },
  { name: "u-vesszo", lower: "ú", upper: "Ú" },
  { name: "o-umlaut", lower: "ö", upper: "Ö" },
  { name: "u-umlaut", lower: "ü", upper: "Ü" },
  { name: "o-kettos", lower: "ő", upper: "Ő" },
  { name: "u-kettos", lower: "ű", upper: "Ű" },
];

const accentLines = ACCENT_CASES.map(
  ({ name, lower, upper }) => `${name} = ${lower} ${upper}`,
);

function describeMismatches(
  mismatches: ReturnType<typeof comparePdfTextLines>,
): string {
  return mismatches
    .map(
      (mismatch) =>
        `${mismatch.index}. sor: vart ${JSON.stringify(mismatch.expected)}, ` +
        `kapott ${mismatch.actual === null ? "(a sor nem jott vissza)" : JSON.stringify(mismatch.actual)}`,
    )
    .join("; ");
}

describe("a PDF betukeszlete es a magyar ekezetek", () => {
  it("a beagyazott betu mind a kilenc ekezet-alakot beture visszaadja", async () => {
    const bytes = await renderMinimalPdf(accentLines);
    const lines = await readPdfTextLines(bytes);
    const mismatches = comparePdfTextLines(accentLines, lines);

    assert.equal(
      mismatches.length,
      0,
      `a visszaolvasott szoveg elter a bemenettol -- ${describeMismatches(mismatches)}`,
    );
  });

  it("a ket kettos ekezetes alak KULON is benne all a proba-szovegben", () => {
    // Onhivatkozo allitas helyett: a valaszto eseteket NEVVEL rogzitjuk, mert
    // egy hianyzo `o`/`u` kettos ekezet epp azt a tesztet uritene ki, amiert
    // ez a keszlet letezik.
    const shapes = ACCENT_CASES.map(
      (accent) => `${accent.lower}${accent.upper}`,
    );
    assert.ok(shapes.includes("őŐ"), "az o kettos ekezetes alak kimaradt");
    assert.ok(shapes.includes("űŰ"), "az u kettos ekezetes alak kimaradt");
    assert.equal(ACCENT_CASES.length, 9);
  });

  it("a hianyzo betufajl HANGOSAN all meg, a vegigprobalt utakkal", () => {
    assert.throws(
      () => resolvePdfFontPath(tmpdir()),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /DejaVuSans\.ttf/);
        assert.match(error.message, /Vegigprobalt utak|Végigpróbált utak/);
        return true;
      },
    );
  });

  it("hianyzo betufajlnal NEM keszul lap -- nincs visszaeses a beepitettre", async () => {
    // acrobot kikotese (2026-09-16): a betu betoltese NE legyen visszaeso aga.
    // Az allitas nem a hibauzenetrol szol, hanem arrol, hogy NEM KELETKEZIK
    // PDF: egy orzot az igazol, hogy nem tortent semmi, nem az, hogy szolt.
    await assert.rejects(
      () => renderMinimalPdf(["arvizturo"], { fontPath: "/nincs/ilyen.ttf" }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /nem letezo fajlra|nem létező fájlra/);
        return true;
      },
    );
  });

  it("a beepitett betu NEVE sem fogadhato el betufajlkent", async () => {
    // A hatso ajto: a `pdfkit` ugyanazon a parameteren a base-14 keszlet NEVET
    // is elfogadna, es akkor a visszaeses a fallback tiltasa ELLENERE allna elo.
    // Egy nev nem fajl -- ezt a hatart meri ez az allitas.
    await assert.rejects(
      () => renderMinimalPdf(["arvizturo"], { fontPath: "Helvetica" }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /nem letezo fajlra|nem létező fájlra/);
        return true;
      },
    );
  });

  it("a kepben futo CI-lepes a VALODI feloldot hivja, es letezo utvonalon", () => {
    // A CI-lepes egy KEZZEL IRT utvonalat hasznal (`dist/.../pdf-font.cli.js`).
    // Ha valaki atmozgatja a modult, az a lepes a leglassabb jobban bukna el;
    // ez az allitas ugyanazt ket masodperc alatt fogja meg. Es azt is meri,
    // hogy a lepes a feloldon at megy, nem egy kulon utvonal-ellenorzessel.
    const workflow = readFileSync(
      join(process.cwd(), "..", "..", ".github", "workflows", "ci.yml"),
      "utf8",
    );

    assert.match(
      workflow,
      /dist\/documents\/pdf\/pdf-font\.cli\.js/,
      "a CI-lepes nem erre a modulra mutat",
    );
    // Ismert pozitiv kontroll: a fajlt tenyleg olvassuk, nem ures szovegen allitunk.
    assert.match(workflow, /acropora-api:ci/);

    // Es a feloldo tenyleg behivhato -- ezt hivja a lepes a kepben.
    assert.match(reportPdfFontLocation(), /DejaVuSans\.ttf/);
  });

  it("az osszevetes MEGNEVEZI az elromlott sort, nem csak jelzi", () => {
    // Ez az allitas magat az orzot meri: ha a hibauzenet nem mondja meg,
    // MELYIK sor romlott el, akkor a bukas nem vezet sehova.
    const romlott: PdfTextLine[] = [{ pageNumber: 1, text: "o-kettos = P" }];
    const mismatches = comparePdfTextLines(["o-kettos = ő Ő"], romlott);

    assert.equal(mismatches.length, 1);
    assert.equal(mismatches[0]?.expected, "o-kettos = ő Ő");
    assert.equal(mismatches[0]?.actual, "o-kettos = P");
  });
});
