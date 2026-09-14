import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthenticatedUser } from "@acropora/types";

import { collectDocumentKeys } from "../service-assets/document-store/document-store.js";
import { InMemoryDocumentStore } from "../service-assets/document-store/in-memory-document-store.js";
import { ServiceJobDocumentsService } from "./service-job-documents.service.js";
import type { ServiceJobDocumentsRepository } from "./service-job-documents.repository.js";
import type { ServiceJobsRepository } from "./service-jobs.repository.js";

/**
 * A HIBAJEGYHEZ CSATOLT FAJL UTJA.
 *
 * A FELTOLTES SZABALYAI A KOZOS MAGBAN allnak
 * (`documents/document-intake.ts`), es ott vannak megmerve: tartalom-
 * felismeres, fajlnev-tisztitas, sha256, keret. Amit ITT merunk, az a
 * HIBAJEGY-oldali resz, es pontosan az a ketto, amit a mag a hivora hagy:
 * hogy a gazda tenyleg `service-job`, es hogy a JEGY LATHATOSAGA dont.
 */

const JPEG = {
  originalname: "kep.jpg",
  mimetype: "image/jpeg",
  // Egy ervenyes JPEG kezdete: a felismeres a bejelentett tipust ES az elso
  // bajtokat EGYUTT nezi, tehat egy ures puffer nem menne at.
  buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]),
} as unknown as Express.Multer.File;

const PDF = {
  originalname: "szamla.pdf",
  mimetype: "application/pdf",
  buffer: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]),
} as unknown as Express.Multer.File;

const BELSOS = { id: "user-1" } as AuthenticatedUser;

function repositoryThat(overrides: Record<string, unknown> = {}) {
  return {
    visibleJobId: async (id: string) => id,
    addDocument: async (input: unknown) => input,
    documents: async () => [],
    document: async () => null,
    deleteDocument: async () => null,
    ...overrides,
  } as unknown as ServiceJobDocumentsRepository;
}

const JOBS = {
  assignedUnitIds: async () => [],
} as unknown as ServiceJobsRepository;

function serviceWith(
  overrides: Record<string, unknown> = {},
  store: InMemoryDocumentStore = new InMemoryDocumentStore(),
) {
  return new ServiceJobDocumentsService(repositoryThat(overrides), JOBS, store);
}

/**
 * KULON FUGGVENY A TAROLO NELKULI ALAKRA, ES EZ MERT TANULSAG.
 *
 * Elsore a `serviceWith(..., undefined)` hivast irtam. A JavaScript az
 * ALAPERTELMEZETT erteket hasznalja, ha a parameter `undefined` -- vagyis a
 * tarolo LETREJOTT, es a "be nem kotott tarolo" allitas egy MASIK agon bukott
 * el (ures tarolo). A teszt maga fogta meg.
 */
function serviceWithoutStore(overrides: Record<string, unknown> = {}) {
  return new ServiceJobDocumentsService(
    repositoryThat(overrides),
    JOBS,
    undefined,
  );
}

describe("fájl a hibajegyhez", () => {
  it("a tároló BEKAPCSOLT állapotában a HIBAJEGY gyökere alá ír", async () => {
    /*
      EZ AZ ALLITAS VALASZTJA EL A HAROM GAZDAT. Ha a kulcs `worksheets/` vagy
      `assets/` ala menne, egy jegy-kep FELULIRHATNA egy masik gazda
      dokumentumat ugyanazzal az azonositoval -- es az adatvesztes lenne, nem
      utkozes-hiba.

      MI PIROSIT: a gazda atirasa a szolgaltatasban (`worksheet`-re vagy
      `asset`-re).
    */
    const store = new InMemoryDocumentStore();
    process.env.DOCUMENT_STORE_ROOT = "/nem-letezik-de-a-memoriabeli-kesz";
    let written: { storageKey?: string } | null = null;
    const service = serviceWith(
      {
        addDocument: async (input: { storageKey?: string }) => {
          written = input;
          return { id: "doc-1" };
        },
      },
      store,
    );

    try {
      await service.addDocument("job-1", "PHOTO", JPEG, BELSOS);

      const kulcsok = await collectDocumentKeys(store.list());
      assert.equal(kulcsok.length, 1);
      assert.equal(kulcsok[0]?.owner, "service-job");
      assert.equal(kulcsok[0]?.ownerId, "job-1");
      assert.match(
        (written as { storageKey?: string } | null)?.storageKey ?? "",
        /^service-jobs\/job-1\//,
      );
    } finally {
      delete process.env.DOCUMENT_STORE_ROOT;
    }
  });

  it("a tároló KIKAPCSOLT állapotában az adatbázisba megy", async () => {
    delete process.env.DOCUMENT_STORE_ROOT;
    let written: { content: unknown } | null = null;
    const service = serviceWith({
      addDocument: async (input: { content: unknown }) => {
        written = input;
        return { id: "doc-1" };
      },
    });

    await service.addDocument("job-1", "PHOTO", JPEG, BELSOS);

    assert.ok(written, "a sornak létre kell jönnie");
    assert.ok(
      (written as { content: unknown }).content,
      "a bájtoknak az adatbázisba kell menniük",
    );
  });

  it("PDF bájtoknál PDF típust ír, nem a fénykép alapértelmezését", async () => {
    /*
      Balazs kerese KET dolgot mond: „fotot illetve egyeb fajlokat is". Ez az
      allitas a MASODIK feléről szol -- hogy egy nem-kep fajl tipusa is a
      TARTALOMBOL jon, nem a `type` mezobol.
    */
    delete process.env.DOCUMENT_STORE_ROOT;
    const contentTypes: string[] = [];
    const service = serviceWith({
      addDocument: async (input: { contentType: string }) => {
        contentTypes.push(input.contentType);
        return { id: "doc-1" };
      },
    });

    await service.addDocument("job-1", "OTHER", PDF, BELSOS);

    assert.deepEqual(contentTypes, ["application/pdf"]);
  });
});

/**
 * A LATHATOSAG: A JEGYE, NEM A CSATOLMANYE.
 *
 * MIND A NEGY VEGPONT UGYANAZON A KAPUN MEGY BE. Kulon allitas mindegyikre,
 * mert a negy ut kulon romolhat el -- es egy dokumentum-vegpont, ami tagabb,
 * mint a jegy sajat lathatosaga, NEM hibazik: csendben elarulja, hogy a jegy
 * LETEZIK.
 *
 * MI PIROSIT: a `requireVisibleJob` hivasanak elhagyasa barmelyik metodusbol.
 */
describe("a nem látható jegy csatolmányaihoz nem lehet hozzáférni", () => {
  const nemLathato = { visibleJobId: async () => null };

  it("feltöltés: 404, és a tárolóba SEMMI nem kerül", async () => {
    const store = new InMemoryDocumentStore();
    process.env.DOCUMENT_STORE_ROOT = "/nem-letezik-de-a-memoriabeli-kesz";
    const service = serviceWith(nemLathato, store);
    try {
      await assert.rejects(
        () => service.addDocument("job-1", "PHOTO", JPEG, BELSOS),
        (hiba: { status?: number }) => hiba.status === 404,
      );
      assert.deepEqual(await collectDocumentKeys(store.list()), []);
    } finally {
      delete process.env.DOCUMENT_STORE_ROOT;
    }
  });

  it("listázás: 404, nem üres lista", async () => {
    /*
      AZ URES LISTA ITT NEM ARTALMATLAN: azt mondana, hogy a jegy LETEZIK es
      nincs csatolmanya. A 404 a nem letezo jeggyel AZONOS valaszt ad, es ez a
      cel.
    */
    await assert.rejects(
      () => serviceWith(nemLathato).documents("job-1", BELSOS),
      (hiba: { status?: number }) => hiba.status === 404,
    );
  });

  it("letöltés: 404, akkor is, ha a sor LÉTEZIK", async () => {
    const service = serviceWith({
      ...nemLathato,
      document: async () => ({
        id: "doc-1",
        fileName: "kep.jpg",
        contentType: "image/jpeg",
        sizeBytes: 8,
        content: Buffer.from([1]),
        storageKey: null,
      }),
    });

    await assert.rejects(
      () => service.documentBytes("job-1", "doc-1", BELSOS),
      (hiba: { status?: number }) => hiba.status === 404,
    );
  });

  it("törlés: 404, és a sort NEM törli", async () => {
    let torolve = 0;
    const service = serviceWith({
      ...nemLathato,
      deleteDocument: async () => {
        torolve += 1;
        return { id: "doc-1", fileName: "kep.jpg", storageKey: null };
      },
    });

    await assert.rejects(
      () => service.deleteDocument("job-1", "doc-1", BELSOS),
      (hiba: { status?: number }) => hiba.status === 404,
    );
    assert.equal(torolve, 0, "a törlés el sem indulhat");
  });
});

/**
 * A LETOLTES HAROM KUDARCA, ES MIERT KELL SZETVALASZTANI OKET.
 *
 * A masik ket gazdanal 2026-09-09-ig mind a harom ugyanazt a 404-et adta,
 * vagyis ugy neztek ki, mintha a csatolmany nem letezne -- es aki azt latja,
 * ADATOT fog keresni, nem beallitast. Ez a harom allitas azert all itt, hogy
 * az uj gazda ne ORAKOLJE ujra azt a hibat.
 */
describe("a hibajegy-csatolmány letöltésének kudarcai", () => {
  const SOR = {
    id: "doc-1",
    fileName: "kep.jpg",
    contentType: "image/jpeg",
    sizeBytes: 8,
    content: null,
    storageKey: "service-jobs/job-1/doc-1",
  };

  it("NEM LÉTEZŐ csatolmány: 404, mert tényleg nincs ilyen", async () => {
    await assert.rejects(
      () =>
        serviceWith({ document: async () => null }).documentBytes(
          "job-1",
          "doc-1",
          BELSOS,
        ),
      (hiba: { status?: number }) => hiba.status === 404,
    );
  });

  it("BE NEM KÖTÖTT tároló: 503, és a beállítást nevezi meg", async () => {
    await assert.rejects(
      () =>
        serviceWithoutStore({ document: async () => SOR }).documentBytes(
          "job-1",
          "doc-1",
          BELSOS,
        ),
      (hiba: { status?: number; message?: string }) =>
        hiba.status === 503 && /nincs beállítva/.test(hiba.message ?? ""),
    );
  });

  it("ÜRES tároló: 503, és a TÁROLÓT nevezi meg, nem a beállítást", async () => {
    await assert.rejects(
      () =>
        serviceWith({ document: async () => SOR }).documentBytes(
          "job-1",
          "doc-1",
          BELSOS,
        ),
      (hiba: { status?: number; message?: string }) =>
        hiba.status === 503 &&
        /tárolóban nem érhető el/.test(hiba.message ?? ""),
    );
  });

  it("MÁS ELRENDEZÉSSEL írt sor: megáll, nem keres rossz helyen", async () => {
    /*
      A `storageKey` a sorbol JON, es a kulcs a mai elrendezesbol SZAMOLODIK.
      Ha a ketto eltér, a helyes viselkedes a MEGALLAS: kulonben a mai
      elrendezes szerint keresnenk egy fajlt, ami nincs ott, es a valasz „a
      csatolmany nem talalhato" lenne -- egy MASIK, artalmatlanabb helyzet
      leirasa.
    */
    await assert.rejects(
      () =>
        serviceWith({
          document: async () => ({
            ...SOR,
            storageKey: "worksheets/job-1/doc-1",
          }),
        }).documentBytes("job-1", "doc-1", BELSOS),
      /nem a mai elrendezés szerint áll/,
    );
  });
});

/**
 * A TORLES: ELOSZOR A SOR, AZUTAN A BAJTOK.
 *
 * A sorrend a feltoltes forditottja, es ugyanabbol az okbol: forditva egy
 * LATSZO csatolmany maradna, aminek a letoltese hibat ad. Igy legfeljebb egy
 * arva fajl marad -- szemet, nem adatvesztes.
 */
describe("a hibajegy-csatolmány törlése", () => {
  it("a tárolóból is elviszi a bájtokat", async () => {
    const store = new InMemoryDocumentStore();
    await store.put(
      { owner: "service-job", ownerId: "job-1", documentId: "doc-1" },
      Uint8Array.from([1, 2, 3]),
    );

    const service = serviceWith(
      {
        deleteDocument: async () => ({
          id: "doc-1",
          fileName: "kep.jpg",
          storageKey: "service-jobs/job-1/doc-1",
        }),
      },
      store,
    );

    assert.deepEqual(await service.deleteDocument("job-1", "doc-1", BELSOS), {
      removed: true,
    });
    assert.deepEqual(
      await collectDocumentKeys(store.list()),
      [],
      "az árva fájl nem maradhat a tárolóban",
    );
  });

  it("NEM LÉTEZŐ csatolmány: 404", async () => {
    await assert.rejects(
      () => serviceWith().deleteDocument("job-1", "doc-1", BELSOS),
      (hiba: { status?: number }) => hiba.status === 404,
    );
  });
});
