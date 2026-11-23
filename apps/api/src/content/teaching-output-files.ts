import pptxgenModule from "pptxgenjs";
import {
  TEACHING_OPEN_MARK,
  type TeachingNarration,
  type TeachingOutputBody,
  type TeachingPrintable,
  type TeachingSlideDeck,
  type TeachingSlideTable,
} from "@acropora/types";

import {
  A4_WIDTH,
  addPage,
  createBrandedPdf,
  PDF_BOLD_FONT,
  PDF_CONTENT_WIDTH,
  PDF_INK,
  PDF_LEFT,
  PDF_MUTED,
  PDF_REGULAR_FONT,
  PDF_RULE,
  registerNotoSans,
} from "../documents/pdf/branded-document.js";

/**
 * THE FILES OF A TEACHING OUTPUT (T5.2, slice 2c): the stored structure
 * (`TeachingPrintable`, `TeachingSlideDeck`, `TeachingNarration`) drawn as a
 * PDF, a PPTX and a plain-text narration. The file carries what the structure
 * carries, nothing more: the numbers were filled in from the table when the
 * output was generated, and every page or slide shows the source, the version
 * and the generation time.
 */

/*
  THE IMPORT, BOTH WAYS: the package's type file says `export default`, but
  the package is not marked as an ES module, so under NodeNext the compiler
  reads that file as CommonJS and puts the class one level down (`.default`).
  At runtime Node loads the package's ES build through its `import` export
  condition, and the default import is the class itself. This takes whichever
  is there.
*/
/*
  IMAGES ON A SLIDE NEED A DEPENDENCY BACK FIRST: the root package.json removes
  pptxgenjs's declared image-size ("pptxgenjs>image-size": "-", two HIGH
  advisories in 1.2.1, unused by every build of pptxgenjs 4.0.1). Text is all
  that goes on a slide today; before an image does, take the override out and
  pin a fixed image-size (2.0.3 or later), or the failure shows at runtime,
  not at compile time (barracuda on #2580).
*/
const PptxGenJS = ((pptxgenModule as unknown as { default?: unknown })
  .default ?? pptxgenModule) as typeof pptxgenModule.default;

export interface TeachingOutputFile {
  filename: string;
  type: string;
  buffer: Buffer;
}

const TOP = 72;
const BOTTOM = 770;
const FOOTER_Y = 800;

/** "Az első hat hét" -> "az-elso-hat-het", for a file name. */
export function teachingFileSlug(title: string): string {
  return (
    title
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "oktatoanyag"
  );
}

interface PrintableLineStyle {
  size: number;
  bold?: boolean;
  color?: string;
  indent?: number;
  gap?: number;
}

/** One line the PDF draws, in order: the text, its style, and the space above it. */
export interface TeachingPrintableLine {
  text: string;
  style: PrintableLineStyle;
  before?: number;
}

/**
 * THE PRINTABLE TEXT IN THE ORDER THE PDF DRAWS IT (the footer aside). The
 * renderer draws these lines, and an edited PDF is compared with these same
 * lines (T5.2, "differs from the source"), so the two can never drift apart.
 */
export function teachingPrintableLines(
  printable: TeachingPrintable,
): TeachingPrintableLine[] {
  const { stamp } = printable;
  const lines: TeachingPrintableLine[] = [];
  // the space after a number table goes above whatever line comes next
  let pending = 0;
  const add = (text: string, style: PrintableLineStyle, before = 0) => {
    const space = before + pending;
    pending = 0;
    lines.push({ text, style, ...(space ? { before: space } : {}) });
  };
  // the cover: the source line and the disclaimer stand here, and in the footer
  add(stamp.title, { size: 22, bold: true, gap: 8 });
  if (printable.subtitle) add(printable.subtitle, { size: 14, gap: 14 });
  add(`Forrás: ${stamp.author}`, { size: 11, color: PDF_MUTED });
  if (stamp.editor)
    add(`Fordító, szerkesztő: ${stamp.editor}`, { size: 11, color: PDF_MUTED });
  add(`${stamp.sourceVersion}. verzió, generálva ${stamp.generatedAt}`, {
    size: 11,
    color: PDF_MUTED,
    gap: 14,
  });
  if (printable.disclaimer)
    add(printable.disclaimer, { size: 11, bold: true, gap: 18 });
  printable.parts.forEach((part, i) => {
    add(`${i + 1}. ${part.title}`, { size: 15, bold: true, gap: 8 }, 8);
    for (const p of part.paragraphs) add(p, { size: 11 });
    for (const sub of part.subparts) {
      add(sub.title, { size: 12, bold: true, gap: 4 });
      for (const p of sub.paragraphs) add(p, { size: 11, indent: 12 });
    }
    if (part.numbers.length) {
      add("Számok", { size: 11, bold: true, gap: 2 });
      part.numbers.forEach((n) =>
        add(
          `${n.name}${n.context ? ` (${n.context})` : ""}: ${n.value}${n.open ? ` ${TEACHING_OPEN_MARK}` : ""}`,
          { size: 10, indent: 12, gap: 2 },
        ),
      );
      pending = 4;
    }
    if (part.checklist.length) {
      add("Ellenőrzőlista", { size: 11, bold: true, gap: 2 });
      for (const item of part.checklist)
        add(`• ${item}`, { size: 10, indent: 12, gap: 2 });
    }
  });
  return lines;
}

export function renderTeachingPdf(
  printable: TeachingPrintable,
): Promise<Buffer> {
  const doc = createBrandedPdf({
    creationDate: new Date(printable.stamp.generatedAt),
  });
  registerNotoSans(doc);
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  let y = TOP;
  const write = (text: string, style: PrintableLineStyle) => {
    const x = PDF_LEFT + (style.indent ?? 0);
    const width = PDF_CONTENT_WIDTH - (style.indent ?? 0);
    doc
      .font(style.bold ? PDF_BOLD_FONT : PDF_REGULAR_FONT)
      .fontSize(style.size);
    const height = doc.heightOfString(text, { width });
    if (y + height > BOTTOM) {
      addPage(doc);
      y = TOP;
    }
    doc.fillColor(style.color ?? PDF_INK).text(text, x, y, { width });
    y += height + (style.gap ?? 6);
  };

  for (const line of teachingPrintableLines(printable)) {
    y += line.before ?? 0;
    write(line.text, line.style);
  }

  // the footer on every page, written after the content so the page count is known
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc
      .moveTo(PDF_LEFT, FOOTER_Y - 6)
      .lineTo(A4_WIDTH - PDF_LEFT, FOOTER_Y - 6)
      .strokeColor(PDF_RULE)
      .lineWidth(0.5)
      .stroke();
    doc
      .font(PDF_REGULAR_FONT)
      .fontSize(8)
      .fillColor(PDF_MUTED)
      .text(
        `${printable.stamp.footer} · ${i - range.start + 1}/${range.count}`,
        PDF_LEFT,
        FOOTER_Y,
        { width: PDF_CONTENT_WIDTH, lineBreak: false },
      );
  }
  doc.end();
  return done;
}

/**
 * THE ROOM OF A TABLE SLIDE, ESTIMATED (T5.2, card b731bd4d; barracuda on #2814: nobody has seen the table in a renderer, and a fixed note line
 * at y = 4.6 overlaps a tall table). The .pptx does not measure text, PowerPoint grows a row to fit its text, so the height is a model, with its
 * assumptions in the open: a slide 5.625 in high, the table's top at 1.15 in plus 0.45 in for every caption line, equal columns of 9 in, a
 * line of text 1.2 times the font size, an average character 0.5 times the font size wide, a cell's side margins 0.1 in each and its top and
 * bottom 0.1 in together. The font is the largest of 12, 11, 10 and 9 pt at which the table fits above the notes (0.4 in each), the notes
 * follow the table at 0.1 in. When even 9 pt does not fit, `fits` is false and the table is drawn at 9 pt: the estimate says it overflows.
 * It is an estimate, not a picture: the check that decides is a look at the slide.
 */
export const TEACHING_TABLE_FONT_SIZES = [12, 11, 10, 9] as const;
const TABLE_TOP = 1.15;
const TABLE_CAPTION_ROOM = 0.45;
const TABLE_NOTE_ROOM = 0.4;
const SLIDE_BOTTOM = 5.1;

export interface TeachingTableFit {
  fontSize: number;
  /** The table's estimated height in inches at that font size. */
  height: number;
  /** Where the first note stands: right under the table. */
  noteY: number;
  fits: boolean;
}

export function estimateTeachingTableHeight(
  table: TeachingSlideTable,
  fontSize: number,
): number {
  const columns = Math.max(table.header.length, 1);
  const lineHeight = (fontSize * 1.2) / 72;
  const charWidth = (fontSize * 0.5) / 72;
  const perLine = Math.max(1, Math.floor((9 / columns - 0.2) / charWidth));
  const rowHeight = (cells: readonly string[]) =>
    Math.max(
      ...cells.map((c) => Math.max(1, Math.ceil([...c].length / perLine))),
      1,
    ) *
      lineHeight +
    0.1;
  return [table.header, ...table.rows].reduce(
    (sum, row) => sum + rowHeight(row),
    0,
  );
}

export function fitTeachingTable(table: TeachingSlideTable): TeachingTableFit {
  const top = TABLE_TOP + table.before.length * TABLE_CAPTION_ROOM;
  const notes = table.after.length * TABLE_NOTE_ROOM;
  const limit = SLIDE_BOTTOM - notes - (notes ? 0.1 : 0);
  const sizes = TEACHING_TABLE_FONT_SIZES;
  let chosen: number = sizes[sizes.length - 1] ?? 9;
  let fits = false;
  for (const size of sizes)
    if (top + estimateTeachingTableHeight(table, size) <= limit) {
      chosen = size;
      fits = true;
      break;
    }
  const height = estimateTeachingTableHeight(table, chosen);
  return {
    fontSize: chosen,
    height,
    noteY: Math.min(top + height + 0.1, SLIDE_BOTTOM - notes),
    fits,
  };
}

export async function renderTeachingPptx(
  deck: TeachingSlideDeck,
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.title = deck.stamp.title;
  pptx.author = deck.stamp.author;
  pptx.company = "Acropora";
  for (const slide of deck.slides) {
    const s = pptx.addSlide();
    const isTitle = slide.kind === "TITLE" || slide.kind === "CLOSING";
    s.addText(slide.title, {
      x: 0.5,
      y: isTitle ? 1.6 : 0.3,
      w: 9,
      h: isTitle ? 1.2 : 0.8,
      fontSize: isTitle ? 34 : 26,
      bold: true,
      color: "18353D",
      align: isTitle ? "center" : "left",
    });
    if (slide.table) {
      // A TABLE SLIDE (T5.2, card b731bd4d): the caption lines, the table, the note, in the order their text reads back as the points
      // (readTeachingPptxText joins a row's cells with " | ").
      const { header, rows, before, after } = slide.table;
      let y = 1.15;
      for (const line of before) {
        s.addText(line, {
          x: 0.5,
          y,
          w: 9,
          h: 0.4,
          fontSize: 16,
          bold: true,
          color: "18353D",
          valign: "top",
        });
        y += 0.45;
      }
      const fit = fitTeachingTable(slide.table);
      const cell = (text: string, head: boolean) => ({
        text,
        options: {
          bold: head,
          fontSize: fit.fontSize,
          color: "18353D",
          valign: "top" as const,
          fill: head ? { color: "E3EEF0" } : undefined,
          border: { type: "solid" as const, pt: 0.5, color: "9DB5BA" },
        },
      });
      const columns = Math.max(header.length, 1);
      s.addTable(
        [
          header.map((text) => cell(text, true)),
          ...rows.map((row) => row.map((text) => cell(text, false))),
        ],
        {
          x: 0.5,
          y,
          w: 9,
          colW: Array<number>(columns).fill(9 / columns),
          autoPage: false,
        },
      );
      after.forEach((line, i) =>
        s.addText(line, {
          x: 0.5,
          y: fit.noteY + i * 0.4,
          w: 9,
          h: 0.4,
          fontSize: 13,
          color: "18353D",
          valign: "top",
        }),
      );
    } else if (slide.points.length)
      s.addText(
        slide.points.map((text) => ({
          text,
          options: { bullet: !isTitle, breakLine: true },
        })),
        {
          x: 0.5,
          y: isTitle ? 2.9 : 1.2,
          w: 9,
          h: isTitle ? 1.8 : 3.8,
          fontSize: isTitle ? 16 : 18,
          color: "18353D",
          align: isTitle ? "center" : "left",
          valign: "top",
        },
      );
    s.addText(deck.stamp.footer, {
      x: 0.5,
      y: 5.15,
      w: 9,
      h: 0.3,
      fontSize: 9,
      color: "56777E",
    });
  }
  const out = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
}

const MISSING: Record<string, string> = {
  NO_NOTE: "[jegyzet hiányzik: ehhez a részhez nem készül narráció]",
  SUGGESTED_NOTE:
    "[a jegyzet javaslat, a szerkesztő még nem hagyta jóvá: nem készül narráció]",
  NO_SPOKEN_FORM: "[hiányzik a kimondott alak:",
};

/** The narration as plain text: the opening, then one chapter per part. */
export function renderTeachingNarrationText(
  narration: TeachingNarration,
): string {
  const lines = [
    `# ${narration.stamp.title}`,
    `(${narration.stamp.footer})`,
    "",
    narration.opening,
  ];
  for (const chapter of narration.chapters) {
    lines.push("", chapter.heading, "");
    if (chapter.text !== null) lines.push(chapter.text);
    else if (chapter.missing === "NO_SPOKEN_FORM")
      lines.push(
        `${MISSING.NO_SPOKEN_FORM} ${chapter.unspeakable.join(", ")}]`,
      );
    else lines.push(MISSING[chapter.missing ?? "NO_NOTE"] ?? "");
    if (chapter.openNumbers.length)
      lines.push(`${TEACHING_OPEN_MARK} ${chapter.openNumbers.join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}

/** The file of an output, named after the source, its version and kind. */
export async function renderTeachingOutputFile(
  body: TeachingOutputBody,
): Promise<TeachingOutputFile> {
  const base = `${teachingFileSlug(body.stamp.title)}-v${body.stamp.sourceVersion}`;
  if (body.kind === "PRINTABLE")
    return {
      filename: `${base}.pdf`,
      type: "application/pdf",
      buffer: await renderTeachingPdf(body),
    };
  if (body.kind === "SLIDES")
    return {
      filename: `${base}-diasor.pptx`,
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer: await renderTeachingPptx(body),
    };
  return {
    filename: `${base}-narracio.txt`,
    type: "text/plain; charset=utf-8",
    buffer: Buffer.from(renderTeachingNarrationText(body), "utf8"),
  };
}
