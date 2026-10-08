import { Worker } from "node:worker_threads";

import { PDFDocument } from "pdf-lib";

import type { UploadedFileKind } from "../service-assets/uploaded-file-type.js";

/**
 * The most a PNG may need once decoded, in bytes. pdf-lib decodes a PNG
 * completely, so a few-megabyte file that declares a giant canvas becomes
 * gigabytes in memory and can take the whole API down (barracuda's #1614
 * review). A pixel limit binds the wrong thing: a 16-bit RGBA pixel is eight
 * bytes, an 8-bit grey one is one (barracuda, acrobot 28131). 100 MB is about
 * 25 MP of 8-bit RGBA.
 */
export const MAX_PNG_DECODED_BYTES = 100_000_000;

/** The image itself cannot be read, though its header looked right. */
export class ScanUnreadable extends Error {}
/** The image needs more memory to decode than we allow. */
export class ScanTooLarge extends Error {}

/** Channels per PNG colour type (IHDR byte 25). */
const PNG_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** A PNG's declared size, depth and colour type, from its IHDR chunk. */
export function pngSize(bytes: Uint8Array): {
  width: number;
  height: number;
  bitDepth: number;
  channels: number;
} | null {
  if (bytes.length < 26) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = String.fromCharCode(...bytes.subarray(12, 16));
  if (type !== "IHDR") return null;
  const channels = PNG_CHANNELS[bytes[25]!];
  if (!channels) return null;
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
    bitDepth: bytes[24]!,
    channels,
  };
}

/**
 * What decoding costs: the raw image (width × height × channels × depth/8),
 * and never less than the 8-bit RGBA pdf-lib turns every PNG into, so a
 * palette or grey image is not let through on its small raw size.
 */
export function pngDecodedBytes(size: {
  width: number;
  height: number;
  bitDepth: number;
  channels: number;
}): number {
  const perPixel = Math.max((size.channels * size.bitDepth) / 8, 4);
  return size.width * size.height * perPixel;
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
    if (pngDecodedBytes(size) > MAX_PNG_DECODED_BYTES)
      throw new ScanTooLarge(
        `${size.width}x${size.height}, ${size.channels}x${size.bitDepth} bit`,
      );
  }
  const pdf = await convertInWorker(bytes, kind);
  const base = fileName.replace(/\.[^.]*$/, "") || "szamlakep";
  return { bytes: pdf, fileName: `${base}.pdf` };
}

/**
 * THE IMAGE ITSELF, AS PDF BYTES. Runs in the worker (`purchase-invoice-scan.worker.ts`):
 * pdf-lib decodes and re-compresses a PNG synchronously, and a 25 MP image
 * held the API's event loop for 1.5 to 5 seconds (card 35fe9a08).
 */
export async function renderScanPdf(
  bytes: Uint8Array,
  kind: "png" | "jpeg",
): Promise<Uint8Array> {
  // NO CREATION DATE: pdf-lib stamps one by default, so the same image a
  // second later became different bytes, a different sha256, and the same
  // file twice on one invoice two attachments (the CI caught it, run
  // 37759559326, ONE-ATTACHMENT 2 !== 1). The bytes now depend on the image only.
  const pdf = await PDFDocument.create({ updateMetadata: false });
  let image;
  try {
    image =
      kind === "png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  } catch (error) {
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
  return pdf.save();
}

/**
 * The worker's JS heap. It does NOT bound the image: pdf-lib keeps the pixels
 * in ArrayBuffers outside the heap (measured: an 85 MB noise PNG converted
 * with a 16 MB heap, and only 8 MB ran out). The bound on a PNG stays
 * `MAX_PNG_DECODED_BYTES`, checked before the worker starts; this limit only
 * keeps a runaway worker from growing the API process's heap.
 */
export const SCAN_WORKER_HEAP_MB = 256;

type ScanWorkerReply =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; unreadable: boolean; message: string };

/** A worker that ran out of its heap is a too-large image, not a 500. */
export function scanWorkerError(
  error: Error & { code?: string },
  heapMb: number,
): Error {
  return error.code === "ERR_WORKER_OUT_OF_MEMORY"
    ? new ScanTooLarge(`the worker ran out of its ${heapMb} MB heap`)
    : error;
}

/**
 * ONE WORKER PER CONVERSION. Scans arrive a few a day, so the ~50 ms start is
 * cheaper than a pool to keep alive. The caller's bytes are copied before the
 * transfer, so its buffer stays usable.
 */
export function convertInWorker(
  bytes: Uint8Array,
  kind: "png" | "jpeg",
  heapMb: number = SCAN_WORKER_HEAP_MB,
): Promise<Uint8Array> {
  const copy = bytes.slice();
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(
      new URL("./purchase-invoice-scan.worker.js", import.meta.url),
      {
        workerData: { bytes: copy, kind },
        transferList: [copy.buffer],
        resourceLimits: { maxOldGenerationSizeMb: heapMb },
      },
    );
    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      action();
    };
    worker.once("message", (reply: ScanWorkerReply) =>
      settle(() =>
        reply.ok
          ? resolve(reply.bytes)
          : reject(
              reply.unreadable
                ? new ScanUnreadable(reply.message)
                : new Error(reply.message),
            ),
      ),
    );
    worker.once("error", (error: Error & { code?: string }) =>
      settle(() => reject(scanWorkerError(error, heapMb))),
    );
    worker.once("exit", (code) =>
      settle(() =>
        reject(new Error(`the scan worker exited (${code}) without a reply`)),
      ),
    );
  });
}
