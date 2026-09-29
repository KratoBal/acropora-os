import { deflateRawSync } from "node:zlib";

/**
 * A generated XLSX in the shape GLS writes it: every SpreadsheetML element
 * with the `x:` prefix, absolute relationship targets, text cells typed
 * `str`, no shared strings, deflated entries. The shape is the one measured
 * on the 300 real files; every value in the tests is made up.
 */

type Cell = string | number | null;

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries: Array<[string, string]>): Buffer {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const raw = Buffer.from(content, "utf8");
    const data = deflateRawSync(raw);
    const nameBytes = Buffer.from(name, "utf8");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc32(raw), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    locals.push(header, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directoryBytes, end]);
}

function escape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function column(index: number): string {
  let out = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
}

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export function glsXlsx(sheets: Record<string, Cell[][]>): Buffer {
  const names = Object.keys(sheets);
  const workbook =
    `<?xml version="1.0" encoding="utf-8"?><x:workbook xmlns:r="${REL}" xmlns:x="${MAIN}"><x:sheets>` +
    names
      .map(
        (name, i) =>
          `<x:sheet name="${escape(name)}" sheetId="${i + 1}" r:id="R${i + 1}" />`,
      )
      .join("") +
    `</x:sheets></x:workbook>`;
  const relationships =
    `﻿<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    names
      .map(
        (_name, i) =>
          `<Relationship Type="${REL}/worksheet" Target="/xl/worksheets/sheet${i + 1}.xml" Id="R${i + 1}" />`,
      )
      .join("") +
    `</Relationships>`;
  const worksheets = names.map((name, i): [string, string] => [
    `xl/worksheets/sheet${i + 1}.xml`,
    `<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="${MAIN}"><x:sheetData>` +
      sheets[name]!.map(
        (row, r) =>
          `<x:row r="${r + 1}">` +
          row
            .map((cell, c) => {
              const ref = `${column(c)}${r + 1}`;
              if (cell === null) return `<x:c r="${ref}" />`;
              return typeof cell === "number"
                ? `<x:c r="${ref}" t="n"><x:v>${cell}</x:v></x:c>`
                : `<x:c r="${ref}" t="str"><x:v>${escape(cell)}</x:v></x:c>`;
            })
            .join("") +
          `</x:row>`,
      ).join("") +
      `</x:sheetData></x:worksheet>`,
  ]);
  return zip([
    ["xl/workbook.xml", workbook],
    ["xl/_rels/workbook.xml.rels", relationships],
    ...worksheets,
  ]);
}
