import { inflateRawSync } from "node:zlib";
import { SaxesParser } from "saxes";

/**
 * A SMALL XLSX READER FOR THE GLS FILES: sheet name -> rows of cell values.
 *
 * Why not exceljs, which the Foxpost reader uses: it loads none of the GLS
 * files. Measured 2026-09-29 on all 84 of them (81 invoice attachments, 3
 * COD reports): "Cannot read properties of undefined (reading 'sheets')". GLS
 * writes the SpreadsheetML elements with a namespace prefix (`<x:workbook>`,
 * `<x:sheets>`, `<x:c>`), and exceljs only knows the unprefixed names. This
 * reader matches on local names, so the prefix does not matter.
 *
 * What the GLS files use, measured on the same 84: no shared strings; cells
 * typed `str` (text), `n` (number, dates as serial numbers) and `d` (ISO
 * date text). Shared strings (`s`), inline strings and booleans are read too,
 * so a change on their side does not silently empty a column.
 */

export type CellValue = string | number | boolean | null;
export type SheetRows = CellValue[][];

const MAX_ENTRY_BYTES = 20 * 1024 * 1024;

export class XlsxReadError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "XlsxReadError";
  }
}

/** The entries of a ZIP file, from its central directory. */
function readZip(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  // end of central directory: search back over a possible comment
  let end = -1;
  for (
    let i = buffer.length - 22;
    i >= Math.max(0, buffer.length - 65_557);
    i--
  )
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new XlsxReadError("XLSX_NOT_A_ZIP");
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50)
      throw new XlsxReadError("XLSX_ZIP_DIRECTORY_INVALID");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;
    if (size > MAX_ENTRY_BYTES) throw new XlsxReadError("XLSX_ENTRY_TOO_LARGE");
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50)
      throw new XlsxReadError("XLSX_ZIP_ENTRY_INVALID");
    const dataStart =
      localOffset +
      30 +
      buffer.readUInt16LE(localOffset + 26) +
      buffer.readUInt16LE(localOffset + 28);
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    let bytes: Buffer;
    if (method === 0) bytes = Buffer.from(data);
    else if (method === 8)
      bytes = inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
    else throw new XlsxReadError("XLSX_ZIP_METHOD_UNSUPPORTED");
    entries.set(name.replace(/^\//, ""), bytes);
  }
  return entries;
}

interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  text: string;
}

function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon < 0 ? name : name.slice(colon + 1);
}

function parseXml(xml: string): XmlElement {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new XlsxReadError("XLSX_XML_INVALID");
  const root: XmlElement = { name: "", attributes: {}, children: [], text: "" };
  const stack: XmlElement[] = [root];
  const parser = new SaxesParser({ xmlns: false });
  parser.on("opentag", (tag) => {
    const element: XmlElement = {
      name: localName(tag.name),
      attributes: Object.fromEntries(
        Object.entries(tag.attributes as Record<string, string>).map(
          ([key, value]) => [key, value],
        ),
      ),
      children: [],
      text: "",
    };
    stack.at(-1)!.children.push(element);
    stack.push(element);
  });
  parser.on("text", (text) => {
    stack.at(-1)!.text += text;
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  try {
    parser.write(xml.replace(/^﻿/, "")).close();
  } catch {
    throw new XlsxReadError("XLSX_XML_INVALID");
  }
  const document = root.children[0];
  if (!document) throw new XlsxReadError("XLSX_XML_INVALID");
  return document;
}

function descendants(element: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  for (const child of element.children) {
    if (child.name === name) out.push(child);
    out.push(...descendants(child, name));
  }
  return out;
}

function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/.exec(reference)?.[0] ?? "";
  let index = 0;
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

function attributeByLocalName(
  element: XmlElement,
  name: string,
): string | undefined {
  for (const [key, value] of Object.entries(element.attributes))
    if (localName(key) === name) return value;
  return undefined;
}

function cellValue(cell: XmlElement, shared: readonly string[]): CellValue {
  const type = cell.attributes.t ?? "n";
  const value = cell.children.find((child) => child.name === "v")?.text;
  if (type === "inlineStr")
    return descendants(cell, "t")
      .map((t) => t.text)
      .join("");
  if (value === undefined) return null;
  if (type === "s") return shared[Number(value)] ?? null;
  if (type === "str" || type === "d") return value;
  if (type === "b") return value === "1";
  if (value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

/** Every sheet of the workbook, in workbook order, as rows of cell values. */
export function readXlsxSheets(buffer: Buffer): Map<string, SheetRows> {
  const entries = readZip(buffer);
  const text = (name: string) => {
    const bytes = entries.get(name);
    if (!bytes) throw new XlsxReadError("XLSX_PART_MISSING");
    return bytes.toString("utf8");
  };
  const shared = entries.has("xl/sharedStrings.xml")
    ? descendants(parseXml(text("xl/sharedStrings.xml")), "si").map((si) =>
        descendants(si, "t")
          .map((t) => t.text)
          .join(""),
      )
    : [];
  const targets = new Map(
    descendants(
      parseXml(text("xl/_rels/workbook.xml.rels")),
      "Relationship",
    ).map((relationship) => [
      relationship.attributes.Id ?? "",
      relationship.attributes.Target ?? "",
    ]),
  );
  const sheets = new Map<string, SheetRows>();
  for (const sheet of descendants(parseXml(text("xl/workbook.xml")), "sheet")) {
    const target = targets.get(attributeByLocalName(sheet, "id") ?? "");
    if (!target) throw new XlsxReadError("XLSX_SHEET_TARGET_MISSING");
    const path = target.replace(/^\//, "");
    const worksheet = parseXml(
      text(path.startsWith("xl/") ? path : `xl/${path}`),
    );
    const rows: SheetRows = [];
    for (const row of descendants(worksheet, "row")) {
      const values: CellValue[] = [];
      let next = 0;
      for (const cell of row.children.filter((child) => child.name === "c")) {
        const index = cell.attributes.r ? columnIndex(cell.attributes.r) : next;
        while (values.length < index) values.push(null);
        values[index] = cellValue(cell, shared);
        next = index + 1;
      }
      // rows keep their sheet position: an empty row stays an empty row
      const number = Number(row.attributes.r ?? rows.length + 1);
      while (rows.length < number - 1) rows.push([]);
      rows.push(values);
    }
    sheets.set(sheet.attributes.name ?? "", rows);
  }
  return sheets;
}

/** An Excel serial date (1900 system) as a UTC instant, to the second. */
export function excelSerialDate(serial: number): Date {
  return new Date(Math.round((serial - 25_569) * 86_400) * 1000);
}
