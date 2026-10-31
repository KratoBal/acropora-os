import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  IMAGE_MAX_BYTES,
  IMAGE_MAX_PIXELS,
  IMAGE_MAX_SIDE,
  IMAGE_MIN_PIXELS,
  IMAGE_MIN_SIDE,
  MAX_TILES,
  TILE_OVERLAP,
  imageTiles,
  tileGrid,
  type ImageTile,
} from "./image-tiles.js";

/**
 * THE INPUT IS A REAL IMAGE. `sharp` is the library the tiling uses, here it
 * only makes the input: noise (so a PNG does not compress it to nothing), and
 * optionally an EXIF orientation or an alpha channel.
 */
async function image(
  width: number,
  height: number,
  extra: {
    orientation?: number;
    format?: "png" | "jpeg";
    alpha?: boolean;
    /** Seeded noise a PNG cannot compress (the byte-cap tests). */
    noise?: boolean;
  } = {},
): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const channels = extra.alpha ? 4 : 3;
  const raw = Buffer.alloc(width * height * channels);
  let seed = 42;
  for (let i = 0; i < raw.length; i += 1) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    raw[i] = extra.noise ? seed >>> 24 : (i * 37) % 251;
  }
  if (extra.alpha) for (let i = 3; i < raw.length; i += 4) raw[i] = 0;
  let img = sharp(raw, { raw: { width, height, channels } });
  if (extra.orientation)
    img = img.withMetadata({ orientation: extra.orientation });
  return (extra.format ?? "png") === "png"
    ? img.png().toBuffer()
    : img.jpeg({ quality: 90 }).toBuffer();
}

async function metaOf(tile: ImageTile) {
  const { default: sharp } = await import("sharp");
  return sharp(Buffer.from(tile.bytes)).metadata();
}

/** Every tile within the input limits, by its own bytes, not by our fields. */
async function assertAccepted(tiles: readonly ImageTile[]) {
  for (const tile of tiles) {
    const m = await metaOf(tile);
    assert.ok(m.format === "png" || m.format === "jpeg", `format ${m.format}`);
    assert.equal(m.width, tile.pixelWidth);
    assert.equal(m.height, tile.pixelHeight);
    assert.ok(
      m.width! >= IMAGE_MIN_SIDE && m.width! <= IMAGE_MAX_SIDE,
      `width ${m.width}`,
    );
    assert.ok(
      m.height! >= IMAGE_MIN_SIDE && m.height! <= IMAGE_MAX_SIDE,
      `height ${m.height}`,
    );
    const pixels = m.width! * m.height!;
    assert.ok(
      pixels >= IMAGE_MIN_PIXELS && pixels <= IMAGE_MAX_PIXELS,
      `pixels ${pixels}`,
    );
    assert.ok(tile.bytes.byteLength <= IMAGE_MAX_BYTES);
    assert.equal(m.orientation ?? 1, 1);
    assert.equal(m.hasAlpha, false);
  }
}

describe("tileGrid", () => {
  it("one tile for an image that fits, and no scaling", () => {
    assert.deepEqual(tileGrid(756, 380), { columns: 1, rows: 1, scale: 1 });
    assert.deepEqual(tileGrid(IMAGE_MAX_SIDE, IMAGE_MAX_SIDE), {
      columns: 1,
      rows: 1,
      scale: 1,
    });
  });

  it("one pixel over the side is two tiles, not a scaled-down one", () => {
    assert.deepEqual(tileGrid(IMAGE_MAX_SIDE + 1, 800), {
      columns: 2,
      rows: 1,
      scale: 1,
    });
  });

  it("2 x 2 holds 3040 a side at full size; an A4 rendered at 3136 is scaled to fit it", () => {
    assert.deepEqual(tileGrid(2900, 3040), { columns: 2, rows: 2, scale: 1 });
    const a4 = tileGrid(2216, 3136);
    assert.deepEqual([a4.columns, a4.rows], [2, 2]);
    assert.equal(a4.scale, 3040 / 3136);
  });

  it("a tall strip uses the grid's length, 1 x 4, before it scales", () => {
    assert.deepEqual(tileGrid(1000, 5800), { columns: 1, rows: 4, scale: 1 });
  });

  it("an image the full grid cannot hold is scaled down, never past the grid", () => {
    const g = tileGrid(9000, 9000);
    assert.ok(g.scale < 1);
    assert.ok(g.columns * g.rows <= MAX_TILES);
    const reach = (n: number) => n * IMAGE_MAX_SIDE - (n - 1) * TILE_OVERLAP;
    assert.ok(Math.floor(9000 * g.scale) <= reach(g.columns));
    assert.ok(Math.floor(9000 * g.scale) <= reach(g.rows));
  });
});

describe("imageTiles", () => {
  it("a figure under the limit is one tile, its own size, lossless PNG", async () => {
    const out = await imageTiles(await image(756, 380, { format: "jpeg" }));
    assert.ok(out.ok);
    assert.equal(out.scale, 1);
    assert.equal(out.tiles.length, 1);
    const [tile] = out.tiles;
    assert.deepEqual(
      [
        tile!.left,
        tile!.top,
        tile!.width,
        tile!.height,
        tile!.pixelWidth,
        tile!.pixelHeight,
      ],
      [0, 0, 756, 380, 756, 380],
    );
    assert.equal(tile!.contentType, "image/png");
    await assertAccepted(out.tiles);
  });

  it("a side under 280 is PADDED to 280, not enlarged (the stage's 266 px figure)", async () => {
    const out = await imageTiles(await image(646, 266));
    assert.ok(out.ok);
    const [tile] = out.tiles;
    assert.equal(tile!.height, 266, "the source rectangle is the real one");
    assert.equal(tile!.pixelHeight, IMAGE_MIN_SIDE);
    assert.equal(tile!.pixelWidth, 646);
    await assertAccepted(out.tiles);
    // the padding is white, the image's own pixels are untouched
    const { default: sharp } = await import("sharp");
    const raw = await sharp(Buffer.from(tile!.bytes)).raw().toBuffer();
    const lastRow = raw.subarray((IMAGE_MIN_SIDE - 1) * 646 * 3);
    assert.ok(lastRow.every((v) => v === 255));
    assert.equal(raw[0], 0);
    assert.equal(raw[1], 37);
  });

  it("a tiny image is padded on both sides to the minimum pixel count", async () => {
    const out = await imageTiles(await image(100, 50));
    assert.ok(out.ok);
    assert.equal(
      out.tiles[0]!.pixelWidth * out.tiles[0]!.pixelHeight,
      IMAGE_MIN_PIXELS,
    );
    await assertAccepted(out.tiles);
  });

  it("a page render is cut into overlapping tiles that cover it, keeping its aspect", async () => {
    const out = await imageTiles(await image(2900, 3040));
    assert.ok(out.ok);
    assert.equal(out.scale, 1);
    assert.equal(out.tiles.length, 4);
    assert.deepEqual(
      out.tiles.map((t) => t.index),
      [1, 2, 3, 4],
    );
    assert.ok(out.tiles.every((t) => t.count === 4));
    await assertAccepted(out.tiles);
    const [a, b, c] = out.tiles;
    // even shares: no thin strip at the edge
    assert.equal(a!.width, b!.width);
    assert.equal(a!.height, c!.height);
    // neighbours overlap, and the last tile ends at the image's edge
    assert.ok(a!.left + a!.width - b!.left >= TILE_OVERLAP);
    assert.ok(a!.top + a!.height - c!.top >= TILE_OVERLAP);
    assert.equal(b!.left + b!.width, 2900);
    assert.equal(c!.top + c!.height, 3040);
  });

  it("an oversized image is scaled down with its aspect ratio, and its tiles still map back", async () => {
    const out = await imageTiles(await image(8000, 2000));
    assert.ok(out.ok);
    assert.ok(out.scale < 1);
    assert.ok(out.tiles.length <= MAX_TILES);
    await assertAccepted(out.tiles);
    const last = out.tiles.at(-1)!;
    assert.ok(
      Math.abs(last.left + last.width - 8000) <= 2,
      "covers the source width",
    );
    assert.ok(
      Math.abs(last.top + last.height - 2000) <= 2,
      "covers the source height",
    );
  });

  it("the EXIF rotation is baked in: a 6-oriented 400 x 300 is 300 x 400, orientation 1", async () => {
    const out = await imageTiles(
      await image(400, 300, { format: "jpeg", orientation: 6 }),
    );
    assert.ok(out.ok);
    assert.deepEqual([out.sourceWidth, out.sourceHeight], [300, 400]);
    await assertAccepted(out.tiles);
  });

  it("transparency is flattened onto white", async () => {
    const out = await imageTiles(await image(300, 300, { alpha: true }));
    assert.ok(out.ok);
    await assertAccepted(out.tiles);
    const { default: sharp } = await import("sharp");
    const raw = await sharp(Buffer.from(out.tiles[0]!.bytes)).raw().toBuffer();
    assert.ok(raw.every((v) => v === 255));
  });

  it("a tile over the byte cap falls back to a baseline JPEG", async () => {
    // measured: this noise is 1 082 586 bytes as PNG, 299 348 as a q90 JPEG
    const out = await imageTiles(await image(600, 600, { noise: true }), {
      maxBytes: 600_000,
    });
    assert.ok(out.ok);
    const [tile] = out.tiles;
    assert.equal(tile!.contentType, "image/jpeg");
    assert.ok(tile!.bytes.byteLength <= 600_000);
    const m = await metaOf(tile!);
    assert.equal(m.format, "jpeg");
    assert.equal(m.isProgressive, false);
  });

  it("a tile no format can fit is refused, not sent", async () => {
    assert.deepEqual(
      await imageTiles(await image(600, 600, { noise: true }), {
        maxBytes: 100_000,
      }),
      {
        ok: false,
        reason: "TILE_TOO_LARGE",
      },
    );
  });

  it("the 16 MiB cap is not reachable at 1568 x 1568, so the default keeps PNG", async () => {
    const out = await imageTiles(await image(IMAGE_MAX_SIDE, IMAGE_MAX_SIDE));
    assert.ok(out.ok);
    assert.equal(out.tiles.length, 1);
    assert.equal(out.tiles[0]!.contentType, "image/png");
    assert.ok(out.tiles[0]!.bytes.byteLength < IMAGE_MAX_BYTES);
    assert.ok(IMAGE_MAX_SIDE * IMAGE_MAX_SIDE * 4 < IMAGE_MAX_BYTES);
  });

  it("bytes that are not an image are a reason, not a throw", async () => {
    assert.deepEqual(
      await imageTiles(new TextEncoder().encode("%PDF-1.7 not an image")),
      {
        ok: false,
        reason: "NOT_AN_IMAGE",
      },
    );
  });

  it("an animated image is refused", async () => {
    const { default: sharp } = await import("sharp");
    const frame = (background: string) =>
      sharp({ create: { width: 300, height: 300, channels: 3, background } })
        .png()
        .toBuffer();
    const animated = await sharp([await frame("#f00"), await frame("#00f")], {
      join: { animated: true },
    })
      .gif()
      .toBuffer();
    assert.equal(
      (await sharp(animated).metadata()).pages,
      2,
      "the fixture has two frames",
    );
    assert.deepEqual(await imageTiles(animated), {
      ok: false,
      reason: "NOT_A_STILL_IMAGE",
    });
  });
});
