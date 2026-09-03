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
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from([1, 2, 3]),
]);

function upload(
  buffer: Buffer = PDF,
  mimetype = "application/pdf",
  originalname = "szamla.pdf",
): Express.Multer.File {
  return { mimetype, originalname, buffer } as unknown as Express.Multer.File;
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
            owner: "asset" as const,
            ownerId: ASSET,
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

describe("what the stored row says the file is", () => {
  function capture() {
    const written: Record<string, unknown>[] = [];
    const service = new ServiceAssetsService(
      repositoryThat({
        addDocument: (async (input: Record<string, unknown>) => {
          written.push(input);
          return {} as never;
        }) as unknown as ServiceAssetsRepository["addDocument"],
      }),
      new InMemoryDocumentStore(),
    );
    return { service, written };
  }

  /**
   * A TÁROLT TÍPUS A LETÖLTÉS EGYETLEN FORRÁSA, és eddig RÖGZÍTETT érték volt
   * (`application/pdf`), függetlenül a tartalomtól. PDF mellett igaz volt, és
   * épp ezért nem tűnt fel: a hiba csak akkor jelent meg volna, amikor az első
   * kép feltöltése után a böngésző PDF-ként próbálja megnyitni a fényképet.
   *
   * Egyetlen teszt sem állította ezt a mezőt a feltöltési úton - a
   * teszt-dupla `as unknown as` típusa mellett a hiány csendes maradt volna.
   */
  it("a képre képet mond, nem PDF-et", async () => {
    delete process.env.DOCUMENT_STORE_ROOT;
    const { service, written } = capture();

    await service.addDocument(
      ASSET,
      "OTHER",
      upload(JPEG, "image/jpeg", "fenykep.jpg"),
      "user-1",
    );

    assert.equal(written.length, 1);
    assert.equal(written[0]!.contentType, "image/jpeg");
  });

  it("a PDF-re továbbra is PDF-et", async () => {
    delete process.env.DOCUMENT_STORE_ROOT;
    const { service, written } = capture();

    await service.addDocument(ASSET, "INVOICE", upload(), "user-1");

    assert.equal(written[0]!.contentType, "application/pdf");
  });

  /**
   * A NEM SZABVÁNYOS BEJELENTÉST ELFOGADJUK, DE NEM ADJUK VISSZA. Ha a küldő
   * `image/jpg` alakot mond, a sor akkor is a szabványosat őrzi - különben a
   * böngésző azon akadna fenn, amit mi engedtünk át.
   */
  it("a bejelentett image/jpg alakot szabványosra fordítja", async () => {
    delete process.env.DOCUMENT_STORE_ROOT;
    const { service, written } = capture();

    await service.addDocument(
      ASSET,
      "OTHER",
      upload(JPEG, "image/jpg", "fenykep.jpg"),
      "user-1",
    );

    assert.equal(written[0]!.contentType, "image/jpeg");
  });

  it("elutasítja azt, ami képnek mondja magát, de PDF van benne", async () => {
    delete process.env.DOCUMENT_STORE_ROOT;
    const { service, written } = capture();

    await assert.rejects(
      () =>
        service.addDocument(
          ASSET,
          "OTHER",
          upload(PDF, "image/png", "alcazott.png"),
          "user-1",
        ),
      /PDF, JPEG vagy PNG/,
    );
    // AZ ŐRZŐT NEM AZ BIZONYÍTJA, HOGY SZÓL, HANEM HOGY NEM TÖRTÉNT SEMMI.
    assert.equal(written.length, 0);
  });
});

describe("more than one file in a single request", () => {
  function capture() {
    const written: Record<string, unknown>[] = [];
    const service = new ServiceAssetsService(
      repositoryThat({
        addDocument: (async (input: Record<string, unknown>) => {
          written.push(input);
          return { id: `doc-${written.length}` } as never;
        }) as unknown as ServiceAssetsRepository["addDocument"],
      }),
      new InMemoryDocumentStore(),
    );
    return { service, written };
  }

  /**
   * MINDEN FÁJL KÜLÖN SORT KAP, ÉS MINDEGYIK A SAJÁT TARTALMÁT.
   *
   * A kézenfekvő hiba az volna, hogy a ciklus ugyanazt a puffert vagy ugyanazt
   * a nevet írja mindegyikhez - a feltöltés akkor is "sikeres", és a hiba csak
   * a letöltésnél derül ki, amikor mindhárom kép ugyanaz.
   */
  it("három fájlból három sor lesz, mindegyik a saját tartalmával", async () => {
    delete process.env.DOCUMENT_STORE_ROOT;
    const { service, written } = capture();

    for (const [buffer, mimetype, name] of [
      [PDF, "application/pdf", "szamla.pdf"],
      [JPEG, "image/jpeg", "elso.jpg"],
      [JPEG, "image/jpg", "masodik.jpg"],
    ] as const) {
      await service.addDocument(
        ASSET,
        "OTHER",
        upload(buffer, mimetype, name),
        "user-1",
      );
    }

    assert.equal(written.length, 3);
    assert.deepEqual(
      written.map((row) => row.fileName),
      ["szamla.pdf", "elso.jpg", "masodik.jpg"],
    );
    assert.deepEqual(
      written.map((row) => row.contentType),
      ["application/pdf", "image/jpeg", "image/jpeg"],
    );
  });

  /**
   * EGY ROSSZ FÁJL NEM VISZI MAGÁVAL A TÖBBIT, DE AMI ELŐTTE MENT, AZ MEGMARAD.
   *
   * A végpont egyesével, sorban ír, tehát egy elutasítás a sorban lévő
   * következőket állítja meg - az addigiak viszont bent maradnak. Ez tudatos:
   * a másik alak (mindent visszagörgetni) egyetlen rossz képért eldobná a
   * szerelő kilenc jó fényképét, és a telefonon nincs mit újratölteni.
   */
  it("a hibás fájl megáll, az előtte lévők megmaradnak", async () => {
    delete process.env.DOCUMENT_STORE_ROOT;
    const { service, written } = capture();

    await service.addDocument(
      ASSET,
      "OTHER",
      upload(JPEG, "image/jpeg", "jo.jpg"),
      "user-1",
    );
    await assert.rejects(() =>
      service.addDocument(
        ASSET,
        "OTHER",
        upload(PDF, "image/png", "alcazott.png"),
        "user-1",
      ),
    );

    assert.equal(written.length, 1);
    assert.equal(written[0]!.fileName, "jo.jpg");
  });
});
