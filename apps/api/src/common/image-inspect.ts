import { BadRequestException } from "@nestjs/common";

/**
 * AN UPLOADED IMAGE, CHECKED BY ITS BYTES AND STORED IN A SAFE FORM.
 *
 * Lifted out of the mail image upload (2026-10-26) so the article images use
 * the same check, with their own limits:
 *
 * - THE KIND COMES FROM THE CONTENT, NOT THE NAME. The browser's `mimetype` and
 *   file name are the caller's claim; `sharp` reads the real format. SVG is
 *   deliberately not offered: it is text that can carry script.
 * - A JPEG IS RE-ENCODED. A phone photo can carry the place it was taken (GPS)
 *   in its EXIF; the re-encoding drops the metadata and applies the rotation.
 *   For the mail, PNG, GIF and WebP stay as they are: re-encoding without
 *   resizing would only risk the animation or the transparency.
 * - `reencodeAll` RE-ENCODES THE OTHERS TOO, without loss (barracuda, #1897):
 *   a PNG's eXIf chunk and a WebP's EXIF block can carry GPS as well, and a
 *   public, year-cached image must not. `sharp` writes no metadata unless asked.
 */
export type ImageFormat = "png" | "jpeg" | "gif" | "webp";

const CONTENT_TYPES: Record<ImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

const NAMES: Record<ImageFormat, string> = {
  png: "PNG",
  jpeg: "JPG",
  gif: "GIF",
  webp: "WebP",
};

export interface ImageInspectLimits {
  readonly maxBytes: number;
  /** The largest edge in pixels: a small file can still unpack to a huge canvas. */
  readonly maxEdge: number;
  readonly formats: readonly ImageFormat[];
  /** Re-encode every format, not only JPEG, so no metadata survives. */
  readonly reencodeAll?: boolean;
}

export interface InspectedImage {
  readonly contentType: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
}

/** "PNG, JPG vagy WebP": the formats as the user reads them. */
function formatList(formats: readonly ImageFormat[]): string {
  const names = formats.map((format) => NAMES[format]);
  return names.length > 1
    ? `${names.slice(0, -1).join(", ")} vagy ${names[names.length - 1]}`
    : (names[0] ?? "");
}

/**
 * A pure function without the network and the database, so it can be measured
 * at unit level. It throws with a named reason, worded for the user.
 */
export async function inspectImageBytes(
  bytes: Uint8Array,
  limits: ImageInspectLimits,
): Promise<InspectedImage> {
  if (bytes.byteLength === 0)
    throw new BadRequestException("A feltöltött fájl üres.");
  if (bytes.byteLength > limits.maxBytes)
    throw new BadRequestException(
      `A kép legfeljebb ${limits.maxBytes / 1024 / 1024} MB lehet.`,
    );

  const lista = formatList(limits.formats);
  const { default: sharp } = await import("sharp");
  let meta: {
    format?: string;
    width?: number;
    height?: number;
    pageHeight?: number;
  };
  try {
    meta = await sharp(Buffer.from(bytes), { animated: true }).metadata();
  } catch {
    throw new BadRequestException(
      `A fájl nem olvasható képként. ${lista} kép tölthető fel.`,
    );
  }
  const format = meta.format as ImageFormat | undefined;
  if (!format || !limits.formats.includes(format))
    throw new BadRequestException(`Csak ${lista} kép tölthető fel.`);
  const width = meta.width ?? 0;
  /* for an animated image `height` is every frame stacked; one frame is `pageHeight` */
  const height = meta.pageHeight ?? meta.height ?? 0;
  if (width < 1 || height < 1)
    throw new BadRequestException("A kép mérete nem olvasható ki.");
  if (width > limits.maxEdge || height > limits.maxEdge)
    throw new BadRequestException(
      `A kép legfeljebb ${limits.maxEdge}×${limits.maxEdge} képpont lehet.`,
    );

  if (format !== "jpeg" && !limits.reencodeAll)
    return { contentType: CONTENT_TYPES[format], width, height, bytes };

  if (format === "png" || format === "webp" || format === "gif") {
    const animated = format !== "png";
    const source = sharp(Buffer.from(bytes), { animated });
    const out = await (
      format === "png"
        ? source.png()
        : format === "webp"
          ? source.webp({ lossless: true })
          : source.gif()
    ).toBuffer();
    return {
      contentType: CONTENT_TYPES[format],
      width,
      height,
      bytes: new Uint8Array(out),
    };
  }

  const ujra = await sharp(Buffer.from(bytes))
    .rotate()
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return {
    contentType: CONTENT_TYPES.jpeg,
    width: ujra.info.width,
    height: ujra.info.height,
    bytes: new Uint8Array(ujra.data),
  };
}
