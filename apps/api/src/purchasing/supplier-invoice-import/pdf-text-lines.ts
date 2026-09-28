import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { SupplierInvoiceImportError } from "./supplier-invoice-import.error.js";

/**
 * A PDF számla szövege SOROKBAN, a cellák között " | " elválasztóval.
 *
 * A `pdfjs` szövegdarabokat ad, nem sorokat. A darabokat a függőleges
 * helyük szerint soroljuk egy sorba (2 pont tűréssel), vízszintesen
 * rendezzük, és " | " jellel fűzzük össze: így egy táblázatsor cellái
 * elválnak ("81593 | Dupla Marin Coral Plugs | 3,00 | 4,50 | 13,50"), és a
 * beszállítói illesztő a cellákra írhat mintát.
 *
 * Mérve a Hertlein 45 számláján (#1199 A-008 DISCOVERY): ezzel az
 * összerakással a PDF-ből kiolvasott cikkszám-sorozat mind a 20 olyan
 * számlán betűre egyezett az ugyanahhoz a számlához küldött XML-lel, ahol
 * mindkettő megvolt.
 *
 * Eltér a `documents/pdf/pdf-text-readback.ts` olvasójától, és ez szándékos:
 * az a SAJÁT kimenetünk betűit méri (elválasztó nélkül, rendszerbetű nélkül),
 * ez IDEGEN számlából olvas, ahol a rendszerbetű segít és a cellahatár kell.
 */

const SAME_LINE_TOLERANCE = 2;
export const PAGE_END_MARKER = "=== oldal vege ===";

export async function pdfTextLines(bytes: Uint8Array): Promise<string[]> {
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    useSystemFonts: true,
  });
  const lines: string[] = [];
  try {
    const document = await loadingTask.promise;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const rows: { y: number; parts: { x: number; text: string }[] }[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const x = item.transform[4] as number;
        const y = item.transform[5] as number;
        const row = rows.find(
          (candidate) => Math.abs(candidate.y - y) <= SAME_LINE_TOLERANCE,
        );
        if (row) row.parts.push({ x, text: item.str.trim() });
        else rows.push({ y, parts: [{ x, text: item.str.trim() }] });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const row of rows)
        lines.push(
          row.parts
            .sort((a, b) => a.x - b.x)
            .map((part) => part.text)
            .join(" | "),
        );
      lines.push(PAGE_END_MARKER);
    }
  } catch {
    throw new SupplierInvoiceImportError("PDF_INVALID");
  } finally {
    await loadingTask.destroy();
  }
  return lines;
}
