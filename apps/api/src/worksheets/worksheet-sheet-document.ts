import { createHash } from "node:crypto";

import type { MinimalPdfOptions } from "../documents/pdf/minimal-pdf.js";
import {
  PDF_BOLD_FONT,
  PDF_CONTENT_BOTTOM,
  PDF_CONTENT_WIDTH,
  PDF_CONTINUATION_CONTENT_TOP,
  PDF_FIRST_CONTENT_TOP,
  PDF_INK,
  PDF_LEFT,
  PDF_MUTED,
  PDF_REGULAR_FONT,
  PDF_RULE,
  addPage,
  createBrandedPdf,
  drawDocumentFooter,
  drawDocumentHeader,
  registerNotoSans,
} from "../documents/pdf/branded-document.js";
import {
  canonicalMimetypeFor,
  detectUploadedFileKind,
} from "../service-assets/uploaded-file-type.js";

import {
  DRAFT_MARK,
  worksheetSheetLayout,
  type WorksheetSheetField,
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

/*
  AZ ELRENDEZÉS (Luca, 2026-11-18 11:27 UTC; acrobot 55790). Ami eddig volt: minden mező egy-egy „Címke: érték" sor egymás alatt,
  egyforma betűvel, és a fejlécben a hosszú TÁRGY 22 pontos betűvel a munkalapszámra csúszott (egy háromsoros tárgy a fejléc vonalán
  és az első szakaszcímen is át). Ami most van:

    fejléc     a nagy betűs cím a munkalapSZÁM (rövid, nem törik), alatta a partner neve; a tárgy a törzsbe kerül
    két oszlop balra: partner, alegység, tárgy, ki vette fel, ki dolgozott rajta; jobbra: kiállítás, teljesítés, határidő, lezárva
    tételek    táblázat: sorszám, megnevezés (alatta halványan a részlet és az eszközkódok), jobbra a mennyiség
    munkaóra   az összesítés csak munkaóra-tétel mellett áll ki (worksheetSheetLayout)

  MINDEN SZÖVEG MAGASSÁGÁT AZ ÉPPEN BEÁLLÍTOTT BETŰVEL ÉS MÉRETTEL MÉRJÜK: a régi rajzoló a magasságot a méret beállítása ELŐTT mérte, és
  egy előző, más méretű szöveg után a becsült és a valódi magasság eltért.
*/
const GAP = 24;
const LEFT_WIDTH = 290;
const RIGHT_X = PDF_LEFT + LEFT_WIDTH + GAP;
const RIGHT_WIDTH = PDF_CONTENT_WIDTH - LEFT_WIDTH - GAP;
const NUM_WIDTH = 24;
const AMOUNT_WIDTH = 120;
const DESC_WIDTH = PDF_CONTENT_WIDTH - NUM_WIDTH - AMOUNT_WIDTH - 12;
const DRAFT_INK = "#b54708";

type Style = {
  font?: string;
  size?: number;
  color?: string;
  width?: number;
  align?: "left" | "right";
  spacing?: number;
};

function setStyle(document: PDFKit.PDFDocument, style: Style): void {
  document
    .font(style.font ?? PDF_REGULAR_FONT)
    .fontSize(style.size ?? 10)
    .fillColor(style.color ?? PDF_INK);
}

/** The height of a text in the style it will be drawn in. */
function measure(
  document: PDFKit.PDFDocument,
  text: string,
  style: Style,
): number {
  setStyle(document, style);
  return document.heightOfString(text, {
    width: style.width ?? PDF_CONTENT_WIDTH,
    lineGap: 1.5,
    characterSpacing: style.spacing ?? 0,
  });
}

/** Draws a text and returns its height. */
function draw(
  document: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  style: Style,
): number {
  const height = measure(document, text, style);
  document.text(text, x, y, {
    width: style.width ?? PDF_CONTENT_WIDTH,
    align: style.align ?? "left",
    lineGap: 1.5,
    characterSpacing: style.spacing ?? 0,
  });
  return height;
}

const LABEL: Style = { font: PDF_BOLD_FONT, size: 7, color: PDF_MUTED };

function fieldsHeight(
  document: PDFKit.PDFDocument,
  fields: WorksheetSheetField[],
  width: number,
): number {
  return fields.reduce(
    (total, f) =>
      total +
      measure(document, f.label.toUpperCase(), { ...LABEL, width }) +
      2 +
      measure(document, f.value, { width, size: 10.5 }) +
      9,
    0,
  );
}

function drawFields(
  document: PDFKit.PDFDocument,
  fields: WorksheetSheetField[],
  x: number,
  y: number,
  width: number,
  align: "left" | "right",
): void {
  for (const f of fields) {
    y +=
      draw(document, f.label.toUpperCase(), x, y, { ...LABEL, width, align }) +
      2;
    y +=
      draw(document, f.value, x, y, {
        width,
        size: 10.5,
        align,
        font: f.label === "Tárgy" ? PDF_BOLD_FONT : PDF_REGULAR_FONT,
      }) + 9;
  }
}

function rule(document: PDFKit.PDFDocument, y: number): void {
  document
    .moveTo(PDF_LEFT, y)
    .lineTo(PDF_LEFT + PDF_CONTENT_WIDTH, y)
    .strokeColor(PDF_RULE)
    .lineWidth(0.6)
    .stroke();
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
      registerNotoSans(document);
    } catch (error) {
      reject(error);
      return;
    }
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));
    try {
      const layout = worksheetSheetLayout(input);
      let y = PDF_FIRST_CONTENT_TOP;
      const nextPage = () => {
        addPage(document);
        y = PDF_CONTINUATION_CONTENT_TOP;
      };
      const need = (height: number) => {
        if (y + height > PDF_CONTENT_BOTTOM) nextPage();
      };
      const section = (title: string, firstBlock: number) => {
        need(26 + firstBlock);
        y +=
          draw(document, title, PDF_LEFT, y, {
            font: PDF_BOLD_FONT,
            size: 11.5,
          }) + 4;
        rule(document, y);
        y += 8;
      };

      // A PISZKOZAT JELÖLÉSE A LAP TETEJÉN, kiemelve (Balázs kikötése: megkülönböztethető legyen a véglegestől).
      if (layout.draft)
        y +=
          draw(document, DRAFT_MARK, PDF_LEFT, y, {
            font: PDF_BOLD_FONT,
            size: 11,
            color: DRAFT_INK,
          }) + 12;

      // KÉT OSZLOP: balra kivel és mi, jobbra a dátumok.
      const top = y;
      drawFields(document, layout.left, PDF_LEFT, top, LEFT_WIDTH, "left");
      drawFields(document, layout.right, RIGHT_X, top, RIGHT_WIDTH, "right");
      y =
        top +
        Math.max(
          fieldsHeight(document, layout.left, LEFT_WIDTH),
          fieldsHeight(document, layout.right, RIGHT_WIDTH),
        ) +
        6;

      if (layout.description) {
        const height = measure(document, layout.description, {});
        section("LEÍRÁS", Math.min(height, 120));
        for (const paragraph of layout.description.split(/\n+/)) {
          const h = measure(document, paragraph, {});
          need(h + 6);
          y += draw(document, paragraph, PDF_LEFT, y, {}) + 6;
        }
        y += 6;
      }

      // TÉTELEK: táblázat.
      section("TÉTELEK", 40);
      const head = (yy: number) => {
        draw(document, "#", PDF_LEFT, yy, { ...LABEL, width: NUM_WIDTH });
        draw(document, "MEGNEVEZÉS", PDF_LEFT + NUM_WIDTH, yy, {
          ...LABEL,
          width: DESC_WIDTH,
        });
        draw(
          document,
          "MENNYISÉG",
          PDF_LEFT + PDF_CONTENT_WIDTH - AMOUNT_WIDTH,
          yy,
          { ...LABEL, width: AMOUNT_WIDTH, align: "right" },
        );
        return 14;
      };
      if (!layout.items.length)
        y +=
          draw(document, "Ezen a lapon nincs tétel.", PDF_LEFT, y, {
            color: PDF_MUTED,
          }) + 8;
      else {
        y += head(y);
        for (const item of layout.items) {
          const descStyle: Style = {
            font: PDF_BOLD_FONT,
            size: 10,
            width: DESC_WIDTH,
          };
          const noteStyle: Style = {
            size: 8.5,
            color: PDF_MUTED,
            width: DESC_WIDTH,
          };
          const amountStyle: Style = {
            size: 10,
            width: AMOUNT_WIDTH,
            align: "right",
          };
          const left =
            measure(document, item.description, descStyle) +
            item.notes.reduce(
              (t, n) => t + measure(document, n, noteStyle) + 1,
              0,
            );
          const rowHeight =
            Math.max(left, measure(document, item.amount, amountStyle)) + 12;
          if (y + rowHeight > PDF_CONTENT_BOTTOM) {
            nextPage();
            y += head(y);
          }
          const rowTop = y + 6;
          draw(document, `${item.position}.`, PDF_LEFT, rowTop, {
            size: 10,
            color: PDF_MUTED,
            width: NUM_WIDTH,
          });
          let yy =
            rowTop +
            draw(
              document,
              item.description,
              PDF_LEFT + NUM_WIDTH,
              rowTop,
              descStyle,
            );
          for (const note of item.notes)
            yy += draw(document, note, PDF_LEFT + NUM_WIDTH, yy, noteStyle) + 1;
          draw(
            document,
            item.amount,
            PDF_LEFT + PDF_CONTENT_WIDTH - AMOUNT_WIDTH,
            rowTop,
            amountStyle,
          );
          y += rowHeight;
          rule(document, y);
        }
      }
      if (layout.laborTotal !== null) {
        need(24);
        y += 6;
        draw(document, "Összes munkaóra", PDF_LEFT + NUM_WIDTH, y, {
          font: PDF_BOLD_FONT,
          size: 10,
          width: DESC_WIDTH,
        });
        y += draw(
          document,
          layout.laborTotal,
          PDF_LEFT + PDF_CONTENT_WIDTH - AMOUNT_WIDTH,
          y,
          {
            font: PDF_BOLD_FONT,
            size: 10,
            width: AMOUNT_WIDTH,
            align: "right",
          },
        );
      }
      y += 16;

      if (layout.entries.length) {
        section("NAPLÓ", 16);
        for (const entry of layout.entries) {
          need(measure(document, `– ${entry}`, {}) + 6);
          y += draw(document, `– ${entry}`, PDF_LEFT, y, {}) + 5;
        }
        y += 10;
      }

      section("ALÁÍRÁS", 30);
      for (const [index, line] of layout.signature.entries()) {
        const style: Style =
          index === 0 ? { size: 10.5 } : { size: 9, color: PDF_MUTED };
        need(measure(document, line, style) + 6);
        y += draw(document, line, PDF_LEFT, y, style) + 5;
      }
      y += 12;

      const photos = input.photos ?? [];
      if (photos.length) {
        section("FÉNYKÉPEK", 120);
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
                .strokeColor(PDF_RULE)
                .lineWidth(0.5)
                .stroke();
            } catch {
              // A sérült bélyegkép nem teheti kiadhatatlanná a dokumentumot.
            }
            if (captions[column])
              draw(document, captions[column]!, x, y + imageHeight + 4, {
                size: 7.5,
                color: PDF_MUTED,
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
        setStyle(document, {});
        drawDocumentHeader(document, {
          eyebrow:
            input.status === "SIGNED" ? "MUNKALAP" : "PISZKOZAT MUNKALAP",
          // A CÍM A MUNKALAPSZÁM (rövid, nem törik), az alcím a partner: a hosszú tárgy a fejlécben a számra csúszott (Luca).
          title: layout.number,
          subtitle: page === range.start ? input.customerName : layout.number,
          compact: page !== range.start,
        });
        drawDocumentFooter(document, "SERVICE");
      }
      document.end();
    } catch (error) {
      reject(error);
    }
  });
}
