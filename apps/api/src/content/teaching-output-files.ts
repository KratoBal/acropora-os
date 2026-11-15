import pptxgenModule from "pptxgenjs";
import {
  TEACHING_OPEN_MARK,
  type TeachingNarration,
  type TeachingOutputBody,
  type TeachingPrintable,
  type TeachingSlideDeck,
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
  const write = (
    text: string,
    style: {
      size: number;
      bold?: boolean;
      color?: string;
      indent?: number;
      gap?: number;
    },
  ) => {
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

  // the cover: the source line and the disclaimer stand here, and in the footer
  const { stamp } = printable;
  write(stamp.title, { size: 22, bold: true, gap: 8 });
  if (printable.subtitle) write(printable.subtitle, { size: 14, gap: 14 });
  write(`Forrás: ${stamp.author}`, { size: 11, color: PDF_MUTED });
  if (stamp.editor)
    write(`Fordító, szerkesztő: ${stamp.editor}`, {
      size: 11,
      color: PDF_MUTED,
    });
  write(`${stamp.sourceVersion}. verzió, generálva ${stamp.generatedAt}`, {
    size: 11,
    color: PDF_MUTED,
    gap: 14,
  });
  if (printable.disclaimer)
    write(printable.disclaimer, { size: 11, bold: true, gap: 18 });

  printable.parts.forEach((part, i) => {
    y += 8;
    write(`${i + 1}. ${part.title}`, { size: 15, bold: true, gap: 8 });
    for (const p of part.paragraphs) write(p, { size: 11 });
    for (const sub of part.subparts) {
      write(sub.title, { size: 12, bold: true, gap: 4 });
      for (const p of sub.paragraphs) write(p, { size: 11, indent: 12 });
    }
    if (part.numbers.length) {
      write("Számok", { size: 11, bold: true, gap: 2 });
      for (const n of part.numbers)
        write(
          `${n.name}${n.context ? ` (${n.context})` : ""}: ${n.value}${n.open ? ` ${TEACHING_OPEN_MARK}` : ""}`,
          { size: 10, indent: 12, gap: 2 },
        );
      y += 4;
    }
    if (part.checklist.length) {
      write("Ellenőrzőlista", { size: 11, bold: true, gap: 2 });
      for (const item of part.checklist)
        write(`• ${item}`, { size: 10, indent: 12, gap: 2 });
    }
  });

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
        `${stamp.footer} · ${i - range.start + 1}/${range.count}`,
        PDF_LEFT,
        FOOTER_Y,
        { width: PDF_CONTENT_WIDTH, lineBreak: false },
      );
  }
  doc.end();
  return done;
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
    if (slide.points.length)
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
