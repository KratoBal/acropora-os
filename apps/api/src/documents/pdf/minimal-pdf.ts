import { statSync } from "node:fs";

import PDFDocument from "pdfkit";

import { resolvePdfFontPath } from "./pdf-font.js";

/**
 * A LEGKISEBB LAP, AMIN A LÁNC VÉGIGMÉRHETŐ.
 *
 * === MI EZ, ÉS MI NEM ===
 *
 * Ez NEM a munkalap. Szándékosan nincs benne fejléc, oldaltörés, táblázat és
 * elrendezés: azok a kérdések (mi látszik a lapon, melyik változat) még
 * nyitva állnak, és egy részletes elrendezés kétszer készülne el.
 *
 * Amit ez a fájl ad, az a lánc ALJA: sorokból érvényes PDF lesz, a BEÁGYAZOTT
 * betűvel. Erre épül majd az elrendezés, és erre épül az őrző, ami a
 * visszaolvasott szöveget a bemenethez méri.
 *
 * === MIÉRT ÁLL A BETŰ-REGISZTRÁLÁS EGY HELYEN ===
 *
 * A `doc.font(...)` hívás a `pdfkit` beépített készletét is elfogadja, névvel
 * (például a base-14 készlet egyik nevével), és attól a laptól kezdve NÉMÁN
 * elromlik minden `ő` és `ű`. Ezért a betű regisztrálása és a kiválasztása
 * EGYETLEN helyen történik: aki ezt a függvényt hívja, nem tud véletlenül a
 * beépített betűre esni.
 *
 * === ÉS AMIÉRT NINCS VISSZAESŐ ÁG (acrobot kikötése, 2026-09-16) ===
 *
 * Ha a betűfájl bármiért nem található, a készítés HANGOSAN áll meg -- nem esik
 * vissza a beépített készletre. Ez elsőre óvatlannak hangzik, és pont fordítva
 * van: a visszaesés PONTOSAN azt a lapot állítaná elő, amin az `ő` betű `P`-ként
 * áll. Egy hibaüzenet a szerveren megjavítható; egy elgépeltnek látszó szó a
 * partner kezében nem derül ki. A "biztonságos" fallback okozná a legrosszabb
 * kimenetelt.
 */

/** A regisztrált betű neve a dokumentumon belül. */
export const PDF_BODY_FONT = "body";

export interface MinimalPdfOptions {
  /** Alapértelmezés: A4. */
  size?: string;
  /** Alapértelmezés: 40 pont. */
  margin?: number;
  /** Alapértelmezés: 12 pont. */
  fontSize?: number;
  /**
   * A betűfájl útja. Alapértelmezés: a repóval utazó, beágyazott betű.
   *
   * CSAK LÉTEZŐ FÁJL fogadható el, és ez nem formaság: a `pdfkit` ugyanezen a
   * paraméteren a beépített készlet NEVÉT is elfogadná (`"Helvetica"`), és
   * ezzel a visszaesés a hátsó ajtón jönne vissza. Egy fájl-ellenőrzés
   * szerkezetileg zárja ki a neveket, mert azok nem fájlok.
   */
  fontPath?: string;
}

/**
 * A BETŰ VALÓDI FÁJL-E -- a visszaesés hátsó ajtaja ellen.
 *
 * A `pdfkit` ugyanezen a paraméteren a beépített készlet NEVÉT is elfogadja, és
 * akkor a lap némán elromlik. Egy név nem fájl, tehát ez az ellenőrzés
 * szerkezetileg zárja ki őket -- és a hiányzó fájlt is hangosan megállítja.
 */
function assertEmbeddableFontFile(fontPath: string): void {
  let isFile = false;
  try {
    isFile = statSync(fontPath).isFile();
  } catch {
    isFile = false;
  }

  if (!isFile) {
    throw new Error(
      `A PDF betűje nem létező fájlra mutat: ${JSON.stringify(fontPath)}. ` +
        `A készítés itt SZÁNDÉKOSAN áll meg, és nem esik vissza a beépített ` +
        `betűkészletre: azon az "ő" betű "P"-ként állna a partner lapján.`,
    );
  }
}

/**
 * Sorokból PDF-bájtok, beágyazott betűvel.
 *
 * A visszatérési érték szándékosan `Buffer`: a hívó vagy elmenti, vagy
 * visszaolvassa -- ideiglenes fájlra egyik esetben sincs szükség.
 */
export function renderMinimalPdf(
  lines: readonly string[],
  options: MinimalPdfOptions = {},
): Promise<Buffer> {
  const { size = "A4", margin = 40, fontSize = 12 } = options;

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size, margin });

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    try {
      const fontPath = options.fontPath ?? resolvePdfFontPath();
      assertEmbeddableFontFile(fontPath);
      doc.registerFont(PDF_BODY_FONT, fontPath);
      doc.font(PDF_BODY_FONT).fontSize(fontSize);
      for (const line of lines) doc.text(line);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
