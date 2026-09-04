import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InMemoryDocumentStore } from "../service-assets/document-store/in-memory-document-store.js";
import { collectDocumentKeys } from "../service-assets/document-store/document-store.js";
import { WorksheetsService } from "./worksheets.service.js";
import type { WorksheetsRepository } from "./worksheets.repository.js";

/**
 * A MUNKALAPHOZ CSATOLT FENYKEP UTJA.
 *
 * A FELTOLTES SZABALYAI A KOZOS MAGBAN allnak (`documents/document-intake.ts`),
 * es ott vannak megmerve. Amit ITT merunk, az a MUNKALAP-oldali resz: hogy a
 * gazda tenyleg `worksheet`, hogy a lap letezeset ELLENORIZZUK, es hogy a
 * jogosultsagi hatokor a lap sajat szabalya szerint dol el.
 */

const FILE = {
  originalname: "kep.jpg",
  mimetype: "image/jpeg",
  // Egy ervenyes JPEG kezdete: a tartalom-felismeres a bejelentett tipust ES az
  // elso bajtokat EGYUTT nezi, tehat egy ures puffer nem menne at.
  buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]),
} as unknown as Express.Multer.File;

const PNG_FILE = {
  originalname: "kep.png",
  mimetype: "image/png",
  buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
} as unknown as Express.Multer.File;

function repositoryThat(overrides: Record<string, unknown> = {}) {
  return {
    detail: async () => ({ id: "worksheet-1" }),
    documentBytesInUse: async () => 0,
    addDocument: async (input: unknown) => input,
    ...overrides,
  } as unknown as WorksheetsRepository;
}

describe("fénykép a munkalaphoz", () => {
  it("PNG bájtoknál PNG típust ír, nem a munkalap JPEG alapértelmezését", async () => {
    delete process.env.DOCUMENT_STORE_ROOT;
    const contentTypes: string[] = [];
    const service = new WorksheetsService(
      repositoryThat({
        addDocument: async (input: { contentType: string }) => {
          contentTypes.push(input.contentType);
          return { id: "doc-1" };
        },
      }),
      undefined,
      new InMemoryDocumentStore(),
    );

    await service.addDocument("worksheet-1", "PHOTO", PNG_FILE, "user-1", {
      kind: "internal",
    });

    assert.deepEqual(contentTypes, ["image/png"]);
  });

  it("a tároló KIKAPCSOLT állapotában az adatbázisba megy", async () => {
    delete process.env.DOCUMENT_STORE_ROOT;
    let written: { content: unknown; storageKey?: unknown } | null = null;
    const service = new WorksheetsService(
      repositoryThat({
        addDocument: async (input: { content: unknown }) => {
          written = input;
          return { id: "doc-1" };
        },
      }),
      undefined,
      new InMemoryDocumentStore(),
    );

    await service.addDocument("worksheet-1", "PHOTO", FILE, "user-1", {
      kind: "internal",
    });

    assert.ok(written, "a sornak létre kell jönnie");
    assert.ok(
      (written as { content: unknown }).content,
      "a bájtoknak az adatbázisba kell menniük",
    );
  });

  it("a tároló BEKAPCSOLT állapotában a MUNKALAP gyökere alá ír", async () => {
    /*
      EZ AZ ALLITAS VALASZTJA EL A KET GAZDAT. Ha a kulcs `assets/` ala menne,
      egy munkalap-kep FELULIRHATNA egy eszkoz-dokumentumot, ugyanazzal az
      azonositoval -- es az adatvesztes lenne, nem utkozes-hiba.

      MI PIROSIT: a gazda atirasa a szolgaltatasban (`asset`-re).
    */
    const store = new InMemoryDocumentStore();
    process.env.DOCUMENT_STORE_ROOT = "/nem-letezik-de-a-memoriabeli-kesz";
    let written: { storageKey?: string } | null = null;
    const service = new WorksheetsService(
      repositoryThat({
        addDocument: async (input: { storageKey?: string }) => {
          written = input;
          return { id: "doc-1" };
        },
      }),
      undefined,
      store,
    );

    try {
      await service.addDocument("worksheet-1", "PHOTO", FILE, "user-1", {
        kind: "internal",
      });

      const kulcsok = await collectDocumentKeys(store.list());
      assert.equal(kulcsok.length, 1);
      assert.equal(kulcsok[0]?.owner, "worksheet");
      assert.equal(kulcsok[0]?.ownerId, "worksheet-1");
      assert.match(
        (written as { storageKey?: string } | null)?.storageKey ?? "",
        /^worksheets\/worksheet-1\//,
      );
    } finally {
      delete process.env.DOCUMENT_STORE_ROOT;
    }
  });

  it("NEM LETEZO lapra nem tölt fel semmit", async () => {
    /*
      A jogosultsag es a letezes ellenorzese a HIVOE, nem a kozos magé: a lap
      sajat hatokor-szabalya vonatkozik ra, es azt egy kozos modul nem
      ismerheti. E nelkul egy idegen partner lapjara is felkerulhetne kep.
    */
    const store = new InMemoryDocumentStore();
    const service = new WorksheetsService(
      repositoryThat({ detail: async () => null }),
      undefined,
      store,
    );

    await assert.rejects(
      () =>
        service.addDocument("worksheet-1", "PHOTO", FILE, "user-1", {
          kind: "internal",
        }),
      /nem található/,
    );
    assert.deepEqual(await collectDocumentKeys(store.list()), []);
  });
});
