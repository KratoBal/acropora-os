import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { IMAGE_MAX_SIDE, TILE_OVERLAP } from "../../common/image-tiles.js";
import { captionNamesPhosphate } from "./jats-figures.js";
import type { TextSection } from "./jats-text.js";

/**
 * A PDF'S FIGURES: THE CAPTION FROM ITS TEXT LAYER, THE IMAGE FROM ITS PAGE
 * (research-kepes-ut, slice 4).
 *
 * A PDF has no figure files to fetch, and a figure may not even be an image:
 * measured on stage (2026-10-31), one of the three PDF sources with a phosphate
 * caption has no raster image at all, its charts are vector drawing. So the
 * PAGE is rendered (pdfjs with `@napi-rs/canvas`, pdfjs-dist's own optional
 * dependency, already in the lockfile) and the whole page goes to the tiler:
 * the figure is wherever it is on it.
 *
 * - A caption is a line of the page's text that starts with "Fig." / "Figure"
 *   and a number, with the lines after it up to a blank-ish break (at most
 *   `CAPTION_LINES`), the way the page section holds them, so a passage the
 *   model copies from it stands in the text the OS read. Only a caption that
 *   names the subject is a candidate (the measurement's words).
 * - The page is rendered so its longer side is what a 2 x 2 grid holds at full
 *   size (`RENDER_LONG_SIDE`, 3040 px): about 260 dpi on an A4, so a chart's
 *   tick labels stay legible after the tiling.
 */
export const CAPTION_LINES = 6;
export const RENDER_LONG_SIDE = 2 * IMAGE_MAX_SIDE - TILE_OVERLAP;
export const MAX_FIGURE_PAGES = 6;

export interface PdfFigure {
  /** "Fig. 3" as the caption writes it. */
  label: string;
  page: number;
  /** The caption's lines, as the page section holds them. */
  caption: string;
}

const CAPTION_START = /^(fig(?:ure)?\.?\s*\d+[a-z]?)\b/i;
const NEXT_BLOCK = /^(?:fig(?:ure)?\.?\s*\d+[a-z]?|table\s*\d+[a-z]?)\b/i;

/** The figure captions of a PDF's page sections ("p. 3"), in order. */
export function pdfFigureCaptions(
  sections: readonly TextSection[],
): PdfFigure[] {
  const figures: PdfFigure[] = [];
  for (const section of sections) {
    const page = /^p\. (\d+)$/.exec(section.locator)?.[1];
    if (!page) continue;
    const lines = section.text.split("\n");
    lines.forEach((line, i) => {
      const start = CAPTION_START.exec(line);
      if (!start) return;
      const block = [line];
      for (const next of lines.slice(i + 1, i + CAPTION_LINES)) {
        if (NEXT_BLOCK.test(next)) break;
        block.push(next);
      }
      figures.push({
        label: start[1]!.replace(/\s+/g, " ").slice(0, 32),
        page: Number(page),
        caption: block.join("\n"),
      });
    });
  }
  return figures;
}

export const pdfPhosphateFigures = (sections: readonly TextSection[]) =>
  pdfFigureCaptions(sections).filter((f) => captionNamesPhosphate(f.caption));

/**
 * The pages, rendered: PNG bytes by page number. One document opened for all
 * of them, destroyed at the end; a page that fails to render is left out (its
 * figures are counted as not rendered by the caller).
 */
export async function renderPdfPages(
  bytes: Uint8Array,
  pages: readonly number[],
  longSide = RENDER_LONG_SIDE,
): Promise<Map<number, Uint8Array>> {
  const out = new Map<number, Uint8Array>();
  const task = getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    useSystemFonts: true,
  });
  try {
    const document = await task.promise;
    for (const n of [...new Set(pages)]) {
      if (n < 1 || n > document.numPages) continue;
      try {
        const page = await document.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: longSide / Math.max(base.width, base.height),
        });
        const factory = document.canvasFactory as {
          create(
            w: number,
            h: number,
          ): {
            canvas: { toBuffer(type: "image/png"): Buffer };
            context: unknown;
          };
        };
        const { canvas, context } = factory.create(
          Math.round(viewport.width),
          Math.round(viewport.height),
        );
        await page.render({
          canvas: canvas as never,
          canvasContext: context as never,
          viewport,
          background: "#ffffff",
        }).promise;
        out.set(n, new Uint8Array(canvas.toBuffer("image/png")));
        page.cleanup();
      } catch {
        // a page pdfjs cannot draw: no image, the caller counts it
      }
    }
  } finally {
    await task.destroy();
  }
  return out;
}
