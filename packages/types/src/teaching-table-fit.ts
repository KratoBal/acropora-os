import type { TeachingSlideTable } from "./teaching-output.js";

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
  /** How far the table (at that font size) runs below the room above the notes, in inches; 0 when it fits. */
  over: number;
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
    over: Math.max(0, top + height - limit),
  };
}
