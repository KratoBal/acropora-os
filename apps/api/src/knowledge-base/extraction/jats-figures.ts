import { jatsText, MAX_LOCATOR } from "./jats-text.js";

/**
 * A PAPER'S FIGURES, FROM ITS JATS (research engine, task research-kepes-ut).
 *
 * The text extraction reads a figure's caption (it stands in its section's
 * text), not its image. The image path reads the image of the figures whose
 * caption names the subject: measured on the 42 included stage sources
 * (2026-10-31), 18 of 159 figures in 9 sources, and only those are worth a
 * model call. The image itself is a file of the paper's open-access package
 * (`pmc-figure-image.ts`), named by the figure's `<graphic xlink:href>`.
 *
 * - The back matter is left out, as in `jatsSections`; a figure of the body
 *   or of a `<floats-group>` is kept.
 * - The caption is the caption's own text by `jatsText`, the same reading the
 *   sections use, so a passage the model copies from it stands in the text
 *   the OS downloaded.
 * - The label is the figure's `<label>` ("Figure 3", "Fig. 2"), or its id, or
 *   its place ("Figure 4"): it names the figure in every locator.
 */
export interface JatsFigure {
  label: string;
  caption: string;
  /** The image file of the open-access package, as `<graphic>` names it. */
  href: string;
}

/** The measurement's own words (atadas/kepes-meres2.mjs), so the counts compare. */
const SUBJECT_IN_CAPTION =
  /phosphat|phosphorus|\bPO4|PO₄|orthophosphate|\bSRP\b|\bDIP\b/i;

export const captionNamesPhosphate = (caption: string) =>
  SUBJECT_IN_CAPTION.test(caption);

const HREF = /<graphic\b[^>]*?\bxlink:href\s*=\s*["']([^"']+)["']/i;

export function jatsFigures(xml: string): JatsFigure[] {
  const clean = xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<back\b[\s\S]*?<\/back>/gi, "");
  const figures: JatsFigure[] = [];
  let place = 0;
  // `<fig ` or `<fig>`, never `<fig-group>` or `<fig-count>`
  for (const m of clean.matchAll(/<fig(?=[\s>])[^>]*>([\s\S]*?)<\/fig>/gi)) {
    place += 1;
    const inner = m[1] ?? "";
    const href = HREF.exec(inner)?.[1]?.trim();
    if (!href) continue;
    const id = /\bid\s*=\s*["']([^"']+)["']/i.exec(m[0].slice(0, 200))?.[1];
    const label =
      jatsText(/<label\b[^>]*>([\s\S]*?)<\/label>/i.exec(inner)?.[1] ?? "")
        .replace(/\n/g, " ")
        .trim() ||
      id ||
      `Figure ${place}`;
    const caption = jatsText(
      /<caption\b[^>]*>([\s\S]*?)<\/caption>/i.exec(inner)?.[1] ?? "",
    );
    figures.push({ label: label.slice(0, 48), caption, href });
  }
  return figures;
}

/** Where a figure's text stands: its caption, or one tile of its image. */
export const figureCaptionLocator = (label: string) =>
  `${label}, caption`.slice(0, MAX_LOCATOR);
export const figureImageLocator = (label: string, tile: number, of: number) =>
  (of > 1 ? `${label}, image tile ${tile}/${of}` : `${label}, image`).slice(
    0,
    MAX_LOCATOR,
  );
/**
 * The model's READING of one tile: a trend or an approximate value it read off
 * the marks, in its own words (research-diagram-irany). The locator says so
 * on every surface that shows the passage, and it is never a tile's locator:
 * the editor sees "read off" before comparing it with the figure.
 */
export const figureReadingLocator = (label: string, tile: number, of: number) =>
  (of > 1
    ? `${label}, read off image tile ${tile}/${of}`
    : `${label}, read off image`
  ).slice(0, MAX_LOCATOR);
/** Whether a passage's locator is a reading's (`figureReadingLocator`). */
export const isReadingLocator = (locator: string) =>
  /, read off image(?: tile \d+\/\d+)?$/.test(locator);
