import PizZip from "pizzip";
import { PDFDocument } from "pdf-lib";

/**
 * A KIJELÖLT MUNKALAPOK KIADOTT PDF-JEI EGYBEN (kártya a785e580, 2. szelet, Luca 2026-11-19).
 *
 * A munkalap-listán bepipált lapokra két művelet kell: LETÖLTÉS (egy zip, lapok szerint egy PDF) és
 * NYOMTATÁS (egy összefűzött PDF, egy nyomtatással). Mindkettő a már TÁROLT, kiadott PDF-ből dolgozik
 * (a lezáráskor készült `GENERATED_SHEET`, aláírt lapnál a `SIGNED_SHEET`), nem renderel újat: ami a lap
 * csatolmányai között letölthető, az kerül ide is, ugyanazzal a hatókör-ellenőrzéssel.
 *
 * A LEZÁRATLAN LAPNAK NINCS KIADOTT PDF-JE: az a kihagyottak között jön vissza a számával, és a hívó
 * kimondja a felhasználónak. Piszkozat-PDF-et itt nem gyártunk (az más tartalom volna, mint amit a lap
 * csatolmánya mutat).
 */
export const BULK_SHEETS_MAX = 50;

export type BulkSheetFormat = "zip" | "merged";

export interface IssuedSheetCandidate {
  id: string;
  type: string;
  createdAt: Date;
}

/**
 * Melyik csatolmány a lap kiadott PDF-je: az aláírt példány, ha van; különben a generált. A régi elrendezésű
 * (archív) példány `OTHER` típusú, ezért itt nem jöhet szóba. Több azonos típusúból a legfrissebb.
 */
export function pickIssuedSheet<T extends IssuedSheetCandidate>(
  documents: readonly T[],
): T | null {
  for (const type of ["SIGNED_SHEET", "GENERATED_SHEET"]) {
    const same = documents
      .filter((document) => document.type === type)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (same.length > 0) return same[0]!;
  }
  return null;
}

/** Egyedi fájlnevek a zipben: az ütköző név mögé ` (2)`, ` (3)` kerül a kiterjesztés elé. */
export function uniqueFileNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const dot = name.toLowerCase().endsWith(".pdf") ? name.length - 4 : -1;
    const stem = dot >= 0 ? name.slice(0, dot) : name;
    const ext = dot >= 0 ? name.slice(dot) : "";
    let candidate = name;
    for (let n = 2; used.has(candidate.toLowerCase()); n++)
      candidate = `${stem} (${n})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

export function zipSheets(
  files: readonly { fileName: string; bytes: Uint8Array }[],
): Buffer {
  const zip = new PizZip();
  const names = uniqueFileNames(files.map((file) => file.fileName));
  files.forEach((file, index) => zip.file(names[index]!, file.bytes));
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Az összefűzött PDF: a lapok egymás után, a kijelölés sorrendjében. */
export async function mergeSheets(
  files: readonly { bytes: Uint8Array }[],
): Promise<Buffer> {
  const out = await PDFDocument.create();
  for (const file of files) {
    const source = await PDFDocument.load(file.bytes);
    const pages = await out.copyPages(source, source.getPageIndices());
    for (const page of pages) out.addPage(page);
  }
  return Buffer.from(await out.save());
}
