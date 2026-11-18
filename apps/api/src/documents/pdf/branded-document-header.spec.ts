import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PDF_INK,
  PDF_LEFT,
  PDF_FIRST_CONTENT_TOP,
  createBrandedPdf,
  drawDocumentHeader,
} from "./branded-document.js";
import { readPdfTextLines } from "./pdf-text-readback.js";

/*
  A KÖZÖS FEJLÉC A VONAL FÖLÖTT MARAD (t-20261118-fejlec-hosszu-cim, acrobot 55822). Eddig a cím 22 ponton, az alcím FIX helyen (136)
  állt: egy kétsoros cím (hosszú név a jelenléti íven) az alcímre csúszott, egy háromsoros alcím (eszköz és ügyfél a bérleti
  szerződésen) a fejléc vonalán (170) át a tartalomba. MI PIROSIT: az alcím a cím mögé vagy a vonal alá kerül; a rövid fejléc alcíme
  elmozdul a régi helyéről.
*/
const RULE = 170;

async function header(title: string, subtitle: string) {
  const document = createBrandedPdf();
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise((resolve) => document.on("end", resolve));
  document
    .fillColor(PDF_INK)
    .fontSize(12)
    .text("ELSŐ TARTALMI SZAKASZ", PDF_LEFT, PDF_FIRST_CONTENT_TOP);
  drawDocumentHeader(document, { eyebrow: "PRÓBA", title, subtitle });
  document.end();
  await done;
  const lines = await readPdfTextLines(Buffer.concat(chunks));
  return lines.filter((line) => (line.top ?? 0) < RULE);
}

describe("a közös fejléc hosszú címmel és alcímmel", () => {
  it("a kétsoros cím alá kerül az alcím, és minden fejléc-szöveg a vonal fölött marad", async () => {
    const rows = await header(
      "Kovács-Szabó Erzsébet Annamária Katalin",
      "2026. november · Acropora Kft.",
    );
    const title = rows.filter((row) => /Kovács-Szabó|Annamária/.test(row.text));
    const subtitle = rows.find((row) => row.text.includes("2026. november"));
    assert.ok(
      title.length >= 2 && subtitle,
      JSON.stringify(rows.map((row) => row.text)),
    );
    // A visszaolvasott magasság csak a betűméret (22), nem a sor kiterjedése, ezért a mérce a CÍMSORKÖZ: az alcím legalább egy teljes
    // címsornyira legyen az utolsó címsor tetejétől. Mérve: két címsor között 27,6; a régi fix alcím 23,3-mal jött (rácsúszott), az új 32,5-tel.
    const tops = title.map((row) => row.top ?? 0).sort((x, y) => x - y);
    const pitch = tops[1]! - tops[0]!;
    const gap = (subtitle!.top ?? 0) - tops[tops.length - 1]!;
    assert.ok(
      gap >= pitch,
      `az alcím ${gap.toFixed(1)} ponttal jön az utolsó címsor után, egy címsor ${pitch.toFixed(1)}`,
    );
    for (const row of rows)
      assert.ok(
        (row.top ?? 0) + (row.height ?? 0) <= RULE,
        `a vonal alá lóg: ${row.text}`,
      );
  });

  it("a háromsoros alcím a vonal fölött ér véget, három ponttal", async () => {
    const rows = await header(
      "BER-2026-0042",
      "Hordozható ipari párátlanító és légszárító berendezés, 120 l/nap, tartozékokkal együtt · Fővárosi Állat- és Növénykert, Budapest, Állatkerti körút 6-12.",
    );
    for (const row of rows)
      assert.ok(
        (row.top ?? 0) + (row.height ?? 0) <= RULE,
        `a vonal alá lóg: ${row.text}`,
      );
    assert.ok(
      rows.some((row) => row.text.endsWith("…") || row.text.endsWith("...")),
      JSON.stringify(rows.map((row) => row.text)),
    );
  });

  it("a rövid fejléc alcíme a régi helyén áll (136)", async () => {
    const rows = await header(
      "TIG-2026-014",
      "Keltezés: 2026-11-18 · Teljesítés: 2026-11-15",
    );
    const subtitle = rows.find((row) => row.text.startsWith("Keltezés"));
    assert.ok(
      subtitle && Math.abs((subtitle.top ?? 0) - 136) < 3,
      JSON.stringify(subtitle),
    );
  });
});
