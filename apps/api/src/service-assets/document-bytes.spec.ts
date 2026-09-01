import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PartnerScope } from "../auth/partner-scope.util.js";
import { InMemoryDocumentStore } from "./document-store/in-memory-document-store.js";
import { storageKeyFor } from "./document-store/document-storage-key.js";
import { ServiceAssetsService } from "./service-assets.service.js";
import type { ServiceAssetsRepository } from "./service-assets.repository.js";

const INTERNAL: PartnerScope = { kind: "internal" };
const ASSET = "asset-1";
const DOCUMENT = "doc-1";

/**
 * A LETÖLTÉS KÉT FORRÁSA, TISZTA BEMENETEKKEL.
 *
 * Amit ez a suite mér: a szolgáltatás a `storageKey` alapján dönt, a régi
 * sorokat változatlanul szolgálja ki, és egy hiányzó fájlra ÉRTELMES hibát ad,
 * nem üres letöltést. A tárolót és a repository-t is helyettesítjük, mert a
 * kérdés a DÖNTÉS, nem az adatbázis.
 */
function repositoryWith(document: {
  content: Uint8Array | null;
  storageKey: string | null;
}): ServiceAssetsRepository {
  return {
    document: async () => ({
      fileName: "x.pdf",
      contentType: "application/pdf",
      ...document,
    }),
  } as unknown as ServiceAssetsRepository;
}

describe("which source a document's bytes come from", () => {
  /**
   * A RÉGI SOROK VÁLTOZATLANUL MENNEK. Nekik nincs `storageKey`-ük, és a
   * bájtok ott állnak, ahol eddig -- a tárolóhoz hozzá sem nyúlunk. Ha ez az
   * állítás pirosodik, az a mai, éles adat kiszolgálása romlott el.
   */
  it("serves a row that only has content, without touching the store", async () => {
    const store = new InMemoryDocumentStore();
    const service = new ServiceAssetsService(
      repositoryWith({ content: Uint8Array.from([1, 2, 3]), storageKey: null }),
      store,
    );

    const result = await service.documentBytes(ASSET, DOCUMENT, INTERNAL);

    assert.deepEqual(result.bytes, Uint8Array.from([1, 2, 3]));
  });

  it("serves a row with a storage key from the store", async () => {
    const store = new InMemoryDocumentStore();
    await store.put(
      { assetId: ASSET, documentId: DOCUMENT },
      Uint8Array.from([9, 8, 7]),
    );
    const service = new ServiceAssetsService(
      repositoryWith({
        content: null,
        storageKey: storageKeyFor({ assetId: ASSET, documentId: DOCUMENT }),
      }),
      store,
    );

    const result = await service.documentBytes(ASSET, DOCUMENT, INTERNAL);

    assert.deepEqual(result.bytes, Uint8Array.from([9, 8, 7]));
  });

  /**
   * A KÉRT KALIBRÁCIÓ a végrehajtási sorrend 6. lépéséből: egy `storageKey`-es
   * sor, aminek a fájlja HIÁNYZIK, értelmes hibát adjon, ne üres letöltést.
   *
   * MIÉRT EZ A LEGFONTOSABB ÁLLÍTÁS ITT: egy nulla bájtos válasz SIKERESNEK
   * látszik. A böngésző elmenti, a felhasználó megnyitja, és ő veszi észre a
   * bajt, nem mi. A hibának a mi oldalunkat kell megneveznie, mert az
   * újrapróbálás nála semmit nem old meg.
   */
  it("raises instead of streaming an empty file when the stored bytes are gone", async () => {
    const service = new ServiceAssetsService(
      repositoryWith({
        content: null,
        storageKey: storageKeyFor({ assetId: ASSET, documentId: DOCUMENT }),
      }),
      new InMemoryDocumentStore(),
    );

    await assert.rejects(
      () => service.documentBytes(ASSET, DOCUMENT, INTERNAL),
      /a tárolóban nem érhető el/,
    );
  });

  /**
   * EGY MÁS ELRENDEZÉS SZERINT ÍRT KULCS MEGÁLLÍT, és nem „nem található"
   * hibává alakul. A kettő különbözik: az utóbbi egy ártalmatlanabb helyzetet
   * ír le (a dokumentum nincs meg), és elrejtené a valódi okot (a sort más
   * elrendezéssel írták, mint amit ma olvasunk).
   */
  it("stops on a storage key that is not today's layout", async () => {
    const service = new ServiceAssetsService(
      repositoryWith({ content: null, storageKey: "regi/elrendezes/doc-1" }),
      new InMemoryDocumentStore(),
    );

    await assert.rejects(
      () => service.documentBytes(ASSET, DOCUMENT, INTERNAL),
      /nem a mai elrendezés szerint/,
    );
  });

  /**
   * A TÁBLA MEGKÖTÉSE KIZÁRJA, HOGY EGYIK FORRÁS SE LEGYEN -- a TÍPUS viszont
   * nem. Ha ez az ág mégis lefut, az a megkötés megkerülését jelenti, és azt
   * jelenteni kell, nem üres letöltéssé alakítani.
   */
  it("raises when neither source has the bytes", async () => {
    const service = new ServiceAssetsService(
      repositoryWith({ content: null, storageKey: null }),
      new InMemoryDocumentStore(),
    );

    await assert.rejects(
      () => service.documentBytes(ASSET, DOCUMENT, INTERNAL),
      /nincs tartalma egyik forrásban sem/,
    );
  });
});
