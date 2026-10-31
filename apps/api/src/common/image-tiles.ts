/**
 * AN IMAGE CUT INTO TILES A MODEL ACCEPTS AS THEY ARE (research engine, task
 * research-kepes-ut; the second use will be a product label photo).
 *
 * The limits are the image input's of TypeSafe System One (docs.typesafe.ai/
 * images, Jev 1.13 and 1.14; Balázs, 2026-10-23 18:23 UTC, kanban 1cdaef3d):
 * PNG or JPEG, a still image; 280 to 1568 pixels a side and 78 400 to
 * 2 458 624 pixels in all; at most 16 MiB an image. An image outside them is
 * REFUSED there, not resized, and the EXIF orientation is not applied. So the
 * image is made to fit here, and nothing about it is left to the other side:
 *
 * - THE ROTATION IS BAKED IN. The EXIF orientation is applied, and no
 *   metadata is written (`sharp` writes none unless asked).
 * - NEVER UPSCALED. A side under 280 pixels is PADDED with white to 280: an
 *   enlarged chart would show the same pixels bigger, a padded one shows them
 *   as they are. Transparency is flattened onto white too, or it reads black.
 * - DOWNSCALED ONLY WHEN THE GRID IS FULL. A larger image is cut into a grid
 *   of at most `maxTiles` tiles, each at most 1568 a side (so at most
 *   2 458 624 pixels), overlapping by `overlap` pixels, so that a label on a
 *   cut line stands whole in one of the tiles. The tiles share the image
 *   evenly: no thin strip at the edge. Only an image the full grid cannot hold
 *   is scaled down, keeping its aspect ratio, to the largest size it can.
 * - LOSSLESS PNG, the size checked. A chart's text is what the model reads,
 *   and a JPEG blurs it. A 1568 x 1568 tile, uncompressed, is 7.4 MB, under
 *   the 16 MiB, so a PNG fits; the check stays, with a baseline JPEG (the
 *   format the documentation suggests) as the fallback, because the limit is
 *   the other side's and could tighten.
 *
 * Every tile names where it stands in the image (`left`, `top`, `width`,
 * `height`, in the ORIENTED image's pixels before any scaling), so a claim read
 * from it can point back at the image, the page and the tile.
 *
 * A pure function without the network: an image in, the tiles or a reason out.
 */

export const IMAGE_MIN_SIDE = 280;
export const IMAGE_MAX_SIDE = 1568;
export const IMAGE_MIN_PIXELS = 78_400;
export const IMAGE_MAX_PIXELS = 2_458_624;
export const IMAGE_MAX_BYTES = 16 * 1024 * 1024;
/** The grid's cap: a page at 2 x 2, or a tall figure at 1 x 4. */
export const MAX_TILES = 4;
/** Output pixels two neighbouring tiles share. */
export const TILE_OVERLAP = 96;
/** What is decoded at all: a small file can unpack to a huge canvas. */
export const MAX_INPUT_PIXELS = 60_000_000;

export interface ImageTile {
  /** 1-based, in reading order (row by row). */
  index: number;
  count: number;
  /** Where the tile stands in the oriented source image, in its pixels. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** The tile's own size, as sent (padding included). */
  pixelWidth: number;
  pixelHeight: number;
  contentType: "image/png" | "image/jpeg";
  bytes: Uint8Array;
}

export type ImageTiling =
  | {
      ok: true;
      /** The oriented source image's size. */
      sourceWidth: number;
      sourceHeight: number;
      /** 1 when nothing was scaled; below 1 when the grid could not hold it. */
      scale: number;
      tiles: ImageTile[];
    }
  | {
      ok: false;
      reason:
        | "NOT_AN_IMAGE"
        | "NOT_A_STILL_IMAGE"
        | "TOO_MANY_PIXELS"
        | "TILE_TOO_LARGE";
    };

export interface TilingOptions {
  maxTiles?: number;
  overlap?: number;
  /** The per-image byte cap; lowered only by a test. */
  maxBytes?: number;
}

/** Tiles along one side: the fewest that hold `length` at most `max` each. */
function tileCount(length: number, max: number, overlap: number): number {
  return length <= max ? 1 : Math.ceil((length - overlap) / (max - overlap));
}

/** The longest side `count` overlapping tiles can hold. */
const reach = (count: number, max: number, overlap: number) =>
  count * max - (count - 1) * overlap;

/**
 * The grid and the scale: the largest scale (at most 1) at which some grid of
 * at most `maxTiles` tiles holds the image; at a tie, the fewer tiles.
 */
export function tileGrid(
  width: number,
  height: number,
  maxTiles = MAX_TILES,
  overlap = TILE_OVERLAP,
): { columns: number; rows: number; scale: number } {
  let best = { columns: 1, rows: 1, scale: 0 };
  for (let columns = 1; columns <= maxTiles; columns += 1)
    for (let rows = 1; columns * rows <= maxTiles; rows += 1) {
      const scale = Math.min(
        1,
        reach(columns, IMAGE_MAX_SIDE, overlap) / width,
        reach(rows, IMAGE_MAX_SIDE, overlap) / height,
      );
      const better =
        scale > best.scale + 1e-9 ||
        (Math.abs(scale - best.scale) <= 1e-9 &&
          columns * rows < best.columns * best.rows);
      if (better) best = { columns, rows, scale };
    }
  // the grid the scaled image actually needs (a scale of 1 may need fewer)
  const w =
    best.scale < 1 ? Math.max(1, Math.floor(width * best.scale)) : width;
  const h =
    best.scale < 1 ? Math.max(1, Math.floor(height * best.scale)) : height;
  return {
    columns: tileCount(w, IMAGE_MAX_SIDE, overlap),
    rows: tileCount(h, IMAGE_MAX_SIDE, overlap),
    scale: best.scale,
  };
}

/** `count` even, overlapping spans over `length`: [start, size] each. */
function spans(
  length: number,
  count: number,
  overlap: number,
): [number, number][] {
  if (count === 1) return [[0, length]];
  const size = Math.min(
    IMAGE_MAX_SIDE,
    Math.ceil((length + (count - 1) * overlap) / count),
  );
  const step = (length - size) / (count - 1);
  return Array.from({ length: count }, (_, i) => {
    const start = i === count - 1 ? length - size : Math.round(i * step);
    return [start, size] as [number, number];
  });
}

export async function imageTiles(
  bytes: Uint8Array,
  options: TilingOptions = {},
): Promise<ImageTiling> {
  const maxTiles = options.maxTiles ?? MAX_TILES;
  const overlap = options.overlap ?? TILE_OVERLAP;
  const maxBytes = options.maxBytes ?? IMAGE_MAX_BYTES;
  const { default: sharp } = await import("sharp");

  let meta: {
    format?: string;
    width?: number;
    height?: number;
    pages?: number;
  };
  try {
    meta = await sharp(Buffer.from(bytes), {
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata();
  } catch (error) {
    return {
      ok: false,
      reason: /pixel limit/i.test(String((error as Error)?.message))
        ? "TOO_MANY_PIXELS"
        : "NOT_AN_IMAGE",
    };
  }
  if (!meta.width || !meta.height) return { ok: false, reason: "NOT_AN_IMAGE" };
  if ((meta.pages ?? 1) > 1) return { ok: false, reason: "NOT_A_STILL_IMAGE" };
  if (meta.width * meta.height > MAX_INPUT_PIXELS)
    return { ok: false, reason: "TOO_MANY_PIXELS" };

  // the oriented image, flattened, as raw pixels: every tile is cut from these
  let oriented: { data: Buffer; info: { width: number; height: number } };
  try {
    oriented = await sharp(Buffer.from(bytes), {
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .rotate()
      .flatten({ background: "#ffffff" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    return { ok: false, reason: "NOT_AN_IMAGE" };
  }
  const sourceWidth = oriented.info.width;
  const sourceHeight = oriented.info.height;
  const grid = tileGrid(sourceWidth, sourceHeight, maxTiles, overlap);
  const raw = {
    width: sourceWidth,
    height: sourceHeight,
    channels: 3 as const,
  };

  let base = sharp(oriented.data, { raw });
  let width = sourceWidth;
  let height = sourceHeight;
  if (grid.scale < 1) {
    width = Math.max(1, Math.floor(sourceWidth * grid.scale));
    height = Math.max(1, Math.floor(sourceHeight * grid.scale));
    const scaled = await base
      .resize(width, height, { fit: "fill", kernel: "lanczos3" })
      .raw()
      .toBuffer();
    base = sharp(scaled, { raw: { width, height, channels: 3 } });
  }
  const pixels = await base.raw().toBuffer();
  const scaledRaw = { width, height, channels: 3 as const };

  const columns = spans(width, grid.columns, overlap);
  const rows = spans(height, grid.rows, overlap);
  const count = columns.length * rows.length;
  const tiles: ImageTile[] = [];
  for (const [top, tileHeight] of rows)
    for (const [left, tileWidth] of columns) {
      const pixelWidth = Math.max(tileWidth, IMAGE_MIN_SIDE);
      const pixelHeight = Math.max(tileHeight, IMAGE_MIN_SIDE);
      const tile = sharp(pixels, { raw: scaledRaw })
        .extract({ left, top, width: tileWidth, height: tileHeight })
        .extend({
          right: pixelWidth - tileWidth,
          bottom: pixelHeight - tileHeight,
          background: "#ffffff",
        });
      let contentType: ImageTile["contentType"] = "image/png";
      let out = await tile.clone().png({ compressionLevel: 9 }).toBuffer();
      if (out.byteLength > maxBytes) {
        contentType = "image/jpeg";
        out = await tile
          .clone()
          .jpeg({ quality: 90, progressive: false, mozjpeg: false })
          .toBuffer();
      }
      if (out.byteLength > maxBytes)
        return { ok: false, reason: "TILE_TOO_LARGE" };
      const back = 1 / grid.scale;
      tiles.push({
        index: tiles.length + 1,
        count,
        left: Math.round(left * back),
        top: Math.round(top * back),
        width: Math.min(sourceWidth, Math.round(tileWidth * back)),
        height: Math.min(sourceHeight, Math.round(tileHeight * back)),
        pixelWidth,
        pixelHeight,
        contentType,
        bytes: new Uint8Array(out),
      });
    }
  return { ok: true, sourceWidth, sourceHeight, scale: grid.scale, tiles };
}
