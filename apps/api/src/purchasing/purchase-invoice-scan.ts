import { PDFDocument } from "pdf-lib";

import type { UploadedFileKind } from "../service-assets/uploaded-file-type.js";

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
  const pdf = await PDFDocument.create();
  const image =
    kind === "png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
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
