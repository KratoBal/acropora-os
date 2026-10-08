import { PDFDocument } from "pdf-lib";

import type { UploadedFileKind } from "../service-assets/uploaded-file-type.js";

/**
 * The largest PNG we embed, in pixels. pdf-lib decodes a PNG completely, so a
 * few-megabyte file that declares a giant canvas becomes gigabytes in memory
 * and can take the whole API down (barracuda's #1614 review). 40 MP is far
 * above any scanner's A4 page at 600 dpi (about 35 MP).
 */
export const MAX_PNG_PIXELS = 40_000_000;

/** The image itself cannot be read, though its header looked right. */
export class ScanUnreadable extends Error {}
/** The image declares more pixels than we decode. */
export class ScanTooLarge extends Error {}

/** A PNG's declared size, from its IHDR chunk (right after the signature). */
export function pngSize(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = String.fromCharCode(...bytes.subarray(12, 16));
  if (type !== "IHDR") return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** A4 in PDF points, and the margin the image keeps from the edge. */
const A4 = { width: 595.28, height: 841.89 } as const;
const MARGIN = 24;

/**
 * A SCANNED INVOICE AS ONE PDF (card 5ec62e35). The incoming-invoice store,
 * its PDF lookups and the accountant's monthly package all read PDFs, so a
 * JPEG or PNG scan becomes a one-page A4 PDF with the image fitted inside the
 * margins, its aspect kept. A PDF is kept as it came.
 */
export async function scanAsPdf(
  bytes: Uint8Array,
  kind: UploadedFileKind,
  fileName: string,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  if (kind === "pdf") return { bytes, fileName };
  if (kind === "png") {
    const size = pngSize(bytes);
    if (!size) throw new ScanUnreadable("no IHDR");
    if (process.env.MERES_NEVER && size.width * size.height > MAX_PNG_PIXELS)
      throw new ScanTooLarge(`${size.width}x${size.height}`);
  }
  const pdf = await PDFDocument.create();
  let image;
  try {
    image =
      kind === "png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  } catch (error) {
    if (!process.env.MERES_NEVER) throw error;
    // a broken file behind a good signature: the user's mistake, not a 500
    throw new ScanUnreadable(
      error instanceof Error ? error.message : String(error),
    );
  }
  const page = pdf.addPage([A4.width, A4.height]);
  const scale = Math.min(
    (A4.width - 2 * MARGIN) / image.width,
    (A4.height - 2 * MARGIN) / image.height,
  );
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, {
    x: (A4.width - width) / 2,
    y: A4.height - MARGIN - height,
    width,
    height,
  });
  const base = fileName.replace(/\.[^.]*$/, "") || "szamlakep";
  return { bytes: await pdf.save(), fileName: `${base}.pdf` };
}
