import assert from "node:assert/strict";
import { collectDocumentKeys } from "./document-store/document-store.js";
import { describe, it } from "node:test";

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { FilesystemDocumentStore } from "./document-store/filesystem-document-store.js";
import { InMemoryDocumentStore } from "./document-store/in-memory-document-store.js";
import { ServiceAssetsService } from "./service-assets.service.js";
import type { ServiceAssetsRepository } from "./service-assets.repository.js";

const ASSET = "asset-1";
const PDF = Buffer.concat([Buffer.from("%PDF-"), Buffer.from([1, 2, 3])]);

function upload(buffer: Buffer = PDF): Express.Multer.File {
  return {
    mimetype: "application/pdf",
    originalname: "szamla.pdf",
    buffer,
  } as unknown as Express.Multer.File;
}

/**
 * A REPOSITORY HELYETTESÍTVE, mert a kérdés a DÖNTÉS, nem az adatbázis: melyik
 * forrásba megy a tartalom, milyen sorrendben, és mi marad hátra, ha a sor
 * beírása elhasal.
 *
 * A `documentBytesInUse` alapból nullát ad: a keret külön suite tárgya
 * (`document-quota.spec.ts`), és itt csak azért szerepel, hogy a hívás ne
 * dobjon.
 */
function repositoryThat(behaviour: {
  addDocument: ServiceAssetsRepository["addDocument"];
  usedBytes?: number;
}): ServiceAssetsRepository {
  return {
    detail: async () => ({ id: ASSET }),
    documentBytesInUse: async () => behaviour.usedBytes ?? 0,
    addDocument: behaviour.addDocument,
  } as unknown as ServiceAssetsRepository;
}

describe("where an uploaded document's bytes go", () => {
  /**
   * A TÁROLÓ NÉLKÜL A MAI ÚT MEGY, VÁLTOZATLANUL. A bájtok a `content`
   * oszlopba kerülnek, és a tárolóhoz hozzá sem nyúlunk -- ha ez az állítás
   * pirosodik, az éles feltöltés viselkedése változott meg.
   */
  it("writes to the database when the store is switched off", async (t) => {
    delete process.env.DOCUMENT_STORE_ROOT;
    const store = new InMemoryDocumentStore();
    let written: unknown = null;
    const service = new ServiceAssetsService(
      repositoryThat({
        addDocument: (async (input: unknown) => {
          written = input;
          return {} as never;
        }) as ServiceAssetsRepository["addDocument"],
      }),
      store,
    );

    await service.addDocument(ASSET, "INVOICE", upload(), "user-1");

    const call = written as { content: Buffer | null; storageKey?: unknown };
    assert.ok(call.content);
    assert.equal(call.storageKey, undefined);
    assert.deepEqual(await collectDocumentKeys(store.list()), []);
    t.diagnostic("a tárolóhoz hozzá sem nyúltunk");
  });

  /**
   * A BÁJTOK ELŐSZÖR A TÁROLÓBA MENNEK, ÉS CSAK AZUTÁN A SOR.
   *
   * A sorrend nem stílus: a két lehetséges félig-kész állapot nem egyforma
   * súlyú. Ezt az állítás a következő teszttel EGYÜTT írja le -- itt a sikeres
   * eset, ott az, ami a hibás úton marad.
   */
  it("writes to the store first, then the row, when the store is on", async () => {
    process.env.DOCUMENT_STORE_ROOT = "/tmp/does-not-need-to-exist";
    const store = new InMemoryDocumentStore();
    let storeHeldBytesWhenRowWasWritten: Uint8Array | null = null;
    const service = new ServiceAssetsService(
      repositoryThat({
        addDocument: (async (input: { id: string }) => {
          storeHeldBytesWhenRowWasWritten = await store.get({
            assetId: ASSET,
            documentId: input.id,
          });
          return {} as never;
        }) as ServiceAssetsRepository["addDocument"],
      }),
      store,
    );

    try {
      await service.addDocument(ASSET, "INVOICE", upload(), "user-1");
    } finally {
      delete process.env.DOCUMENT_STORE_ROOT;
    }

    assert.ok(
      storeHeldBytesWhenRowWasWritten,
      "a sor beírásakor a bájtoknak már a tárolóban kell állniuk",
    );
  });

  /**
   * HA A SOR NEM JÖN LÉTRE, A FÁJL SEM MARADHAT.
   *
   * Ez a takarítás, és a hiba TOVÁBBMEGY: elnyelve a hívó azt hinné, hogy a
   * feltöltés sikerült. Ha a takarítás maga is elhasalna, a fájl elárvultan
   * marad, és az összevetés megtalálja -- későn derül ki, de nem vész el.
   */
  it("removes the stored file when the row cannot be written", async () => {
    process.env.DOCUMENT_STORE_ROOT = "/tmp/does-not-need-to-exist";
    const store = new InMemoryDocumentStore();
    const service = new ServiceAssetsService(
      repositoryThat({
        addDocument: (async () => {
          throw new Error("a sor beírása elhasalt");
        }) as ServiceAssetsRepository["addDocument"],
      }),
      store,
    );

    try {
      await assert.rejects(
        () => service.addDocument(ASSET, "INVOICE", upload(), "user-1"),
        /a sor beírása elhasalt/,
      );
      assert.deepEqual(
        await collectDocumentKeys(store.list()),
        [],
        "elárvult fájl nem maradhat a tárolóban",
      );
    } finally {
      delete process.env.DOCUMENT_STORE_ROOT;
    }
  });

  /**
   * A KERET FÖLÉ VITT FELTÖLTÉS ELUTASÍTÁSA UTÁN SEM A TÁROLÓN, SEM A TÁBLÁBAN
   * NEM KELETKEZIK SEMMI.
   *
   * Ez a végrehajtási sorrend 7. lépésének kalibrációja, és a MÁSODIK állítás a
   * fontosabb: az őrzőt nem az bizonyítja, hogy szól, hanem hogy nem történt
   * semmi.
   */
  it("creates nothing at all when the upload would go over the quota", async () => {
    process.env.DOCUMENT_STORE_ROOT = "/tmp/does-not-need-to-exist";
    process.env.DOCUMENT_STORE_LIMIT_BYTES = "10";
    const store = new InMemoryDocumentStore();
    let rowsWritten = 0;
    const service = new ServiceAssetsService(
      repositoryThat({
        usedBytes: 10,
        addDocument: (async () => {
          rowsWritten += 1;
          return {} as never;
        }) as ServiceAssetsRepository["addDocument"],
      }),
      store,
    );

    try {
      await assert.rejects(
        () => service.addDocument(ASSET, "INVOICE", upload(), "user-1"),
        /Betelt a fotó-tárhely/,
      );

      assert.equal(rowsWritten, 0, "sor nem keletkezhet");
      assert.deepEqual(
        await collectDocumentKeys(store.list()),
        [],
        "fájl sem keletkezhet",
      );
    } finally {
      delete process.env.DOCUMENT_STORE_ROOT;
      delete process.env.DOCUMENT_STORE_LIMIT_BYTES;
    }
  });

  /**
   * A LEGVESZÉLYESEBB TELEPÍTÉSI HIBA: a változó beállítva, a jelölő fájl
   * elfelejtve.
   *
   * A könyvtár ilyenkor ÍRHATÓ -- a csatolási pont üres könyvtára is az --,
   * tehát az írás SIKERÜLNE, csak épp a konténer rétegére, és a következő
   * újratelepítés elvinné. Semmi nem hibázna, és a baj hetekkel később,
   * letöltésnél derülne ki.
   *
   * A VÁLASZ: visszaesés az adatbázisra. Nem elutasítás, mert a rendszernek
   * mennie kell és az adatbázis-út ép; nem is csendes, mert a napló és az
   * állapot-végpont is kimondja.
   */
  it("falls back to the database when the store is on but not usable", async () => {
    const unmarked = await mkdtemp(
      path.join(tmpdir(), "document-store-nomark-"),
    );
    process.env.DOCUMENT_STORE_ROOT = unmarked;
    const store = new FilesystemDocumentStore(unmarked);
    let written: { content: Buffer | null } | null = null;
    const service = new ServiceAssetsService(
      repositoryThat({
        addDocument: (async (input: { content: Buffer | null }) => {
          written = input;
          return {} as never;
        }) as ServiceAssetsRepository["addDocument"],
      }),
      store,
    );

    try {
      await service.addDocument(ASSET, "INVOICE", upload(), "user-1");

      assert.ok(written, "a sornak létre kell jönnie");
      assert.ok(
        (written as { content: Buffer | null }).content,
        "a bájtoknak az adatbázisba kell menniük",
      );
      assert.deepEqual(
        await collectDocumentKeys(store.list()),
        [],
        "a tárolóba semmi nem kerülhet, amíg nem használható",
      );
    } finally {
      delete process.env.DOCUMENT_STORE_ROOT;
      await rm(unmarked, { recursive: true, force: true });
    }
  });

  /**
   * BEÁLLÍTÁS NÉLKÜL NINCS KERET. Egy kitalált alapértelmezett határ egy nap
   * csendben elutasítana egy feltöltést, amiről senki nem döntött.
   */
  it("has no quota at all until one is configured", async () => {
    delete process.env.DOCUMENT_STORE_ROOT;
    delete process.env.DOCUMENT_STORE_LIMIT_BYTES;
    let rowsWritten = 0;
    const service = new ServiceAssetsService(
      repositoryThat({
        usedBytes: Number.MAX_SAFE_INTEGER,
        addDocument: (async () => {
          rowsWritten += 1;
          return {} as never;
        }) as ServiceAssetsRepository["addDocument"],
      }),
      new InMemoryDocumentStore(),
    );

    await service.addDocument(ASSET, "INVOICE", upload(), "user-1");

    assert.equal(rowsWritten, 1);
  });
});
