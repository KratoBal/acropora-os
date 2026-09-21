import { createHash } from "node:crypto";

import type { MinimalPdfOptions } from "../documents/pdf/minimal-pdf.js";
import {
  PDF_CONTENT_BOTTOM,
  PDF_CONTENT_WIDTH,
  PDF_CONTINUATION_CONTENT_TOP,
  PDF_FIRST_CONTENT_TOP,
  PDF_INK,
  PDF_LEFT,
  PDF_MUTED,
  addPage,
  createBrandedPdf,
  drawDocumentFooter,
  drawDocumentHeader,
  drawSectionTitle,
} from "../documents/pdf/branded-document.js";
import {
  canonicalMimetypeFor,
  detectUploadedFileKind,
} from "../service-assets/uploaded-file-type.js";

import {
  worksheetSheetLines,
  type WorksheetSheetInput,
} from "./worksheet-sheet-content.js";

/**
 * A LAP BEMENETÉBŐL A TÁROLHATÓ FÁJL -- A VARRAT A TARTALOM ÉS A SOR KÖZÖTT.
 *
 * === MI EZ, ÉS MI NEM ===
 *
 * Ez a lánc harmadik szeme. Az első a leképezés (a válaszból a lap bemenete), a
 * második a tartalom (a bemenetből sorok), a harmadik ez: a sorokból BÁJTOK, és
 * mellé az a négy mező, amit a `WorksheetDocument` sor visel.
 *
 * Ami NEM: nem dönti el, HOVA kerül a fájl (adatbázis vagy tároló), nem néz
 * keretet, és nem ír sort. Azok a lezárási tranzakció kérdései, és külön
 * szeletben állnak -- ott ugyanis olyan döntések nyílnak meg (mi történjen, ha
 * a keret betelt egy LEZÁRÁSKOR), amiket ez a függvény nem hozhat meg.
 *
 * === MIÉRT A BEMENETET KAPJA, ÉS NEM A VÁLASZT ===
 *
 * A leképezés (`worksheetSheetInput`) már létezik, és saját állításai vannak.
 * Ha ez a függvény a `WorksheetDetail`-t venné, a két lépés egy mérőhelyre
 * kerülne, és egy rossz mező-kiolvasás meg egy rossz rajzolás ugyanazt a pirosat
 * adná. Így mindegyik szem külön romlik el, és külön is mérhető.
 *
 * === ÉS AMIÉRT ŐRIZZÜK, HOGY A BÁJTOK TÉNYLEG PDF-ET ADNAK ===
 *
 * A feltöltési út (`document-intake.ts`) MINDEN fájlra megnézi, hogy a bejelentett
 * típus és a tartalom egyezik-e. A generált lap ugyanabba a táblába kerül, és épp
 * ŐT nevezzük hitelesnek -- tehát nem kaphat lazább mércét, mint amit bárki
 * feltöltése kap. A tartalom-típust ezért nem beírjuk, hanem a FELISMERT fajtából
 * vesszük: ha a rajzoló valaha mást adna vissza, itt hangosan áll meg, nem a
 * böngészőben, hetekkel később.
 */

/** A tárolható fájl: bájtok, és a `WorksheetDocument` sor négy mezője. */
export interface WorksheetSheetDocument {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  content: Buffer;
}

/**
 * A FÁJL NEVE A MUNKALAPSZÁMBÓL -- KÜLÖN FÜGGVÉNYBEN, ÉS EZ NEM STÍLUS.
 *
 * Ezt a nevet a VEVŐ látja, amikor lementi. Külön áll, mert külön is romlik el:
 * a bájtok attól még hibátlanok, hogy a név rossz, és egy közös állítás a kettőt
 * egy pirosba mosná.
 *
 * A PERJEL A LÉNYEG. A munkalapszám `BIO-2026-001/1` alakú (a lap száma, per a
 * verzió), és a perjel fájlnévben KÖNYVTÁRAT jelent. Kezeletlenül a letöltés
 * vagy a tároló-kulcs törne el -- olyan helyen, ami a rajzolástól távol van.
 *
 * ÉS AMIÉRT VAN SZÁM NÉLKÜLI ALAK: a munkalapszámot a LEZÁRÁS foglalja le, a
 * piszkozat viszont szintén kap lapot (a séma is ezt mondja ki). A `${null}`
 * behelyettesítés „munkalap-null.pdf"-et adna a vevő kezébe.
 */
export function worksheetSheetFileName(label: string | null): string {
  const tiszta = (label ?? "")
    .normalize("NFKC")
    // Ugyanaz a karakterkészlet, amit a feltöltési út is kivesz a névből
    // (`document-intake.ts`): perjel, visszaperjel és vezérlőkarakterek.
    .replace(/[\\/\p{Cc}\p{Cf}]/gu, "-")
    .trim()
    .slice(0, 120);
  return tiszta ? `munkalap-${tiszta}.pdf` : "munkalap-piszkozat.pdf";
}

/**
 * A LEZÁRÁSKOR KELETKEZŐ LAPNAK SZÁMOZOTTNAK KELL LENNIE.
 *
 * MIÉRT NEM A `worksheetSheetFileName`-BEN ÁLL EZ: ott a szám nélküli alak
 * HELYES. A piszkozat is kap lapot, és annak `munkalap-piszkozat.pdf` a neve.
 * Egy közös őrző tehát egy jogos esetet vágna el -- és ugyanennyire rossz
 * irányban: a lap KÉT hívója közül mind a kettőre zöld maradna, akkor is, ha
 * a lezárási úton hibás.
 *
 * AMIT VÉD, ÉS EZ NÉMA HIBA: a lezárás a sorszámot a STÁTUSZ-VÁLTÁS UTÁN
 * osztja ki. Aki a tranzakció ELEJÉN olvasott sorból állítja elő a lapot,
 * `null` címkét kap, abból `munkalap-piszkozat.pdf` lesz, és A FÁJL ELKÉSZÜL:
 * a lezárás sikerül, a sor létrejön, és a vevő egy piszkozat nevű
 * dokumentumot kap egy számozott munkalapról. Semmi nem szólna.
 *
 * MIÉRT SZABAD ILYEN SZIGORÚNAK LENNIE: a lezárás feltételei
 * (`worksheetCloseBlocker`) szám nélkül nem engedik tovább a lapot -- vagy már
 * van száma, vagy a rövidítés és az alegység-kód megvan, és akkor a kiosztás
 * lefut. Sikeres lezárás után tehát MINDIG van szám. Ez az őrző nem új
 * feltétel, hanem ennek az UTÓFELTÉTELE.
 *
 * TISZTA FÜGGVÉNY, ugyanazért, amiért a `worksheetCloseBlocker` is az: így a
 * szabály adatbázis nélkül mérhető.
 */
export function requireClosedSheetLabel(
  label: string | null,
  worksheetId: string,
): string {
  if (!label)
    throw new Error(
      `A lezárt munkalap (${worksheetId}) száma nem érhető el a lap előállításakor. ` +
        "A lapot a sorszám kiosztása UTÁN kell előállítani, különben piszkozat-nevet kapna.",
    );
  return label;
}

/**
 * A LAP BEMENETÉBŐL A TÁROLHATÓ FÁJL.
 *
 * A `sha256` a TARTALOMRA megy, ugyanúgy, ahogy a feltöltési úton
 * (`document-intake.ts`): abból derül ki utólag, hogy a tárolt bájtok azonosak-e
 * azzal, amit kiadtunk.
 */
export async function worksheetSheetDocument(
  input: WorksheetSheetInput,
  options: MinimalPdfOptions = {},
): Promise<WorksheetSheetDocument> {
  const content = await renderWorksheetPdf(input, options);

  const kind = detectUploadedFileKind("application/pdf", content);
  if (kind === null)
    throw new Error(
      "A generált munkalap nem érvényes PDF. A sort nem hozzuk létre, mert épp ezt neveznénk hitelesnek.",
    );

  return {
    fileName: worksheetSheetFileName(input.label),
    contentType: canonicalMimetypeFor(kind),
    sizeBytes: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
    content,
  };
}

function renderWorksheetPdf(
  input: WorksheetSheetInput,
  options: MinimalPdfOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let document: PDFKit.PDFDocument;
    try {
      document = createBrandedPdf({ fontPath: options.fontPath });
    } catch (error) {
      reject(error);
      return;
    }
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));
    try {
      const subtitle = input.label ?? "Munkalap - még nincs száma";
      let y = PDF_FIRST_CONTENT_TOP;
      const nextPage = () => {
        addPage(document);
        y = PDF_CONTINUATION_CONTENT_TOP;
      };
      const need = (height: number) => {
        if (y + height > PDF_CONTENT_BOTTOM) nextPage();
      };
      const sections = worksheetSections(input);
      for (const section of sections) {
        const estimate =
          28 +
          section.lines.reduce(
            (total, line) =>
              total +
              document.heightOfString(line, {
                width: PDF_CONTENT_WIDTH - 16,
                lineGap: 2,
              }) +
              8,
            0,
          );
        need(Math.min(estimate, 180));
        y = drawSectionTitle(document, section.title, y);
        for (const line of section.lines) {
          const height = document.heightOfString(line, {
            width: PDF_CONTENT_WIDTH - 16,
            lineGap: 2,
          });
          need(height + 10);
          document.fillColor(PDF_INK).fontSize(10).text(line, PDF_LEFT, y, {
            width: PDF_CONTENT_WIDTH,
            lineGap: 2,
          });
          y += height + 8;
        }
        y += 12;
      }
      const photos = input.photos ?? [];
      if (photos.length) {
        need(42);
        y = drawSectionTitle(document, "FÉNYKÉPEK", y);
        const columnWidth = (PDF_CONTENT_WIDTH - 12) / 2;
        for (let index = 0; index < photos.length; index += 2) {
          const row = photos.slice(index, index + 2);
          const imageHeight = 116;
          const captions = row.map((photo) => photo.caption?.trim() ?? "");
          const captionHeight = captions.some(Boolean) ? 20 : 0;
          need(imageHeight + captionHeight + 14);
          row.forEach((photo, column) => {
            const x = PDF_LEFT + column * (columnWidth + 12);
            try {
              document.image(Buffer.from(photo.thumbnail), x, y, {
                fit: [columnWidth, imageHeight],
                align: "center",
                valign: "center",
              });
              document
                .rect(x, y, columnWidth, imageHeight)
                .strokeColor("#c9dadd")
                .lineWidth(0.5)
                .stroke();
            } catch {
              // A sérült bélyegkép nem teheti kiadhatatlanná a dokumentumot.
            }
            if (captions[column])
              document
                .fillColor(PDF_MUTED)
                .fontSize(7.5)
                .text(captions[column]!, x, y + imageHeight + 4, {
                  width: columnWidth,
                });
          });
          y += imageHeight + captionHeight + 14;
        }
      }
      const range = document.bufferedPageRange();
      for (
        let page = range.start;
        page < range.start + range.count;
        page += 1
      ) {
        document.switchToPage(page);
        drawDocumentHeader(document, {
          eyebrow:
            input.status === "SIGNED" ? "MUNKALAP" : "PISZKOZAT MUNKALAP",
          title: input.subject,
          subtitle,
          compact: page !== range.start,
        });
        drawDocumentFooter(document);
      }
      document.end();
    } catch (error) {
      reject(error);
    }
  });
}

function worksheetSections(
  input: WorksheetSheetInput,
): { title: string; lines: string[] }[] {
  const lines = worksheetSheetLines(input).filter((line) => line.trim() !== "");
  const sections: { title: string; lines: string[] }[] = [];
  let title = "MUNKALAP ADATAI";
  let current: string[] = [];
  for (const line of lines) {
    if (["TÉTELEK", "NAPLÓ", "ALÁÍRÁS"].includes(line)) {
      if (current.length) sections.push({ title, lines: current });
      title = line;
      current = [];
    } else current.push(line);
  }
  if (current.length) sections.push({ title, lines: current });
  return sections;
}
