import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FilesystemDocumentStore } from "./document-store/filesystem-document-store.js";
import { InMemoryDocumentStore } from "./document-store/in-memory-document-store.js";
import { ServiceAssetsService } from "./service-assets.service.js";
import type { ServiceAssetsRepository } from "./service-assets.repository.js";

const repository = {} as unknown as ServiceAssetsRepository;

/**
 * A TELEPÍTÉS ELLENŐRZŐ PONTJA.
 *
 * A kötet, a jelölő fájl és a jogosultság felrakása után van egy pillanat,
 * amikor el kell dönteni, sikerült-e. Enélkül a válasz csak egy feltöltéssel
 * derülne ki -- és egy sikertelen feltöltés már a felhasználó előtt történik.
 *
 * A KÉT MEZŐ KÉT KÜLÖN KÉRDÉS, és ezt a suite külön is méri: `enabled` azt
 * mondja meg, HASZNÁLJUK-e a tárolót, `status` azt, HASZNÁLHATÓ-e. A kettő
 * eltérhet, és épp az eltérés a telepítés legveszélyesebb pillanata.
 */
describe("the document store's reported status", () => {
  it("says it is off while the root is unset", async () => {
    delete process.env.DOCUMENT_STORE_ROOT;
    const service = new ServiceAssetsService(
      repository,
      new InMemoryDocumentStore(),
    );

    const reported = await service.documentStoreStatus();

    assert.equal(reported.enabled, false);
  });

  /**
   * ÉS KIKAPCSOLT ÁLLAPOTBAN A `status` NEM MONDHATJA, HOGY `ready`.
   *
   * MÉRVE 2026-09-01, egy éles telepítés ELŐTT, és majdnem kárt okozott. A válasz
   * ilyenkor `{ enabled: false, status: { state: "ready" } }` volt, mert a
   * változó hiányában a MEMÓRIABELI tároló fut, annak pedig nincs mit
   * beállítani. A `ready` szó igaz volt -- csak nem arról, amiről az olvasója
   * hitte: a telepítés ellenőrzése úgy zárult volna, hogy „a kötet a helyén van
   * és használható", holott a kötetet SEMMI nem nézte meg.
   *
   * EZ AZ ÁLLÍTÁS AZÉRT ÁLL KÜLÖN A FÖLÖTTÉTŐL, mert a kettő MÁS kérdés. Az
   * `enabled` hamis értéke önmagában igaz volt akkor is, amikor a `status`
   * félrevezetett -- vagyis a fenti teszt zölden hallgatott végig arról a
   * mezőről, ami a bajt okozta.
   */
  it("does not let the off state look like a working volume", async () => {
    delete process.env.DOCUMENT_STORE_ROOT;
    const service = new ServiceAssetsService(
      repository,
      new InMemoryDocumentStore(),
    );

    const reported = await service.documentStoreStatus();

    assert.notEqual(
      reported.status.state,
      "ready",
      "kikapcsolt tárolónál a ready a memóriabeli változatról szólna, nem a kötetről",
    );
    assert.equal(reported.status.state, "not-enabled");
    // ÉS AZ INDOK MONDJA IS KI, MIT NEM TUD. Egy állapotnév önmagában nem
    // elég: aki a választ olvassa, abból tudja meg, hogy a kötetet másutt kell
    // megnéznie.
    assert.match(
      "reason" in reported.status ? reported.status.reason : "",
      /kötet/i,
    );
  });

  it("says it is on once the root is set", async () => {
    process.env.DOCUMENT_STORE_ROOT = "/tmp/does-not-need-to-exist";
    const service = new ServiceAssetsService(
      repository,
      new InMemoryDocumentStore(),
    );

    try {
      assert.equal((await service.documentStoreStatus()).enabled, true);
    } finally {
      delete process.env.DOCUMENT_STORE_ROOT;
    }
  });

  /**
   * A LEGVESZÉLYESEBB TELEPÍTÉSI PILLANAT: a változó már beállítva, a kötet még
   * nincs csatolva. A két mező ilyenkor ELTÉR, és pontosan ez az eltérés az,
   * amit a telepítőnek látnia kell -- egyetlen közös „működik/nem működik"
   * jelzés ezt a helyzetet elrejtené.
   */
  it("reports on-but-unusable as two different things", async () => {
    process.env.DOCUMENT_STORE_ROOT = "/tmp/no-such-mount-point-at-all";
    const service = new ServiceAssetsService(
      repository,
      new FilesystemDocumentStore("/tmp/no-such-mount-point-at-all"),
    );

    try {
      const reported = await service.documentStoreStatus();

      assert.equal(reported.enabled, true);
      assert.equal(reported.status.state, "not-configured");
    } finally {
      delete process.env.DOCUMENT_STORE_ROOT;
    }
  });
});
