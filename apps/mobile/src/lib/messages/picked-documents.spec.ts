import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PICKABLE_DOCUMENT_TYPES, toPickedDocuments } from "./picked-documents";

/*
  A FÁJLVÁLASZTÓ EREDMÉNYE (Üzenetek 2d, kártya 34753075). MI PIROSÍT: ha egy
  PDF nem megy fel; ha egy Word vagy Excel csendben elmegy (a szerver úgyis
  elutasítaná); ha a kimaradt fájl neve nem látszik; ha a méret elvész.
*/
describe("files picked for a message", () => {
  it("a PDF goes by its declared type, a photo by its extension, with name and size", () => {
    const { files, skipped } = toPickedDocuments([
      {
        uri: "file:///a.pdf",
        name: "árajánlat.pdf",
        mimeType: "application/pdf",
        size: 1200,
      },
      { uri: "file:///b", name: "kep.PNG", mimeType: null, size: 30 },
    ]);
    assert.deepEqual(files, [
      {
        uri: "file:///a.pdf",
        name: "árajánlat.pdf",
        type: "application/pdf",
        sizeBytes: 1200,
      },
      { uri: "file:///b", name: "kep.PNG", type: "image/png", sizeBytes: 30 },
    ]);
    assert.deepEqual(skipped, []);
  });

  it("what the server would refuse stays out, by name", () => {
    const { files, skipped } = toPickedDocuments([
      {
        uri: "file:///c.docx",
        name: "szerzodes.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
      { uri: "file:///d.xlsx", name: "lista.xlsx", mimeType: null },
    ]);
    assert.deepEqual(files, []);
    assert.deepEqual(skipped, ["szerzodes.docx", "lista.xlsx"]);
  });

  it("a nameless PDF gets a name with its extension", () => {
    const { files } = toPickedDocuments([
      { uri: "content://x/1", mimeType: "application/pdf" },
    ]);
    assert.equal(files[0]!.name, "fajl-1.pdf");
    assert.equal(files[0]!.sizeBytes, 0);
  });

  it("the picker is asked for exactly the server's three types", () => {
    assert.deepEqual([...PICKABLE_DOCUMENT_TYPES].sort(), [
      "application/pdf",
      "image/jpeg",
      "image/png",
    ]);
  });
});
