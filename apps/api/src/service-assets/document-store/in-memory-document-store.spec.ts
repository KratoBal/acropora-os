import assert from "node:assert/strict";
import { collectDocumentKeys } from "./document-store.js";
import { describe, it } from "node:test";

import { InMemoryDocumentStore } from "./in-memory-document-store.js";

describe("the in-memory document store", () => {
  /**
   * A KÉRT KALIBRÁCIÓ a végrehajtási sorrend 1. lépéséből: ha a `get` MÁS
   * bájtot adna vissza, mint amit a `put` kapott, ennek pirosra kell váltania.
   */
  it("gives back the bytes it was given", async () => {
    const store = new InMemoryDocumentStore();
    const bytes = Uint8Array.from([1, 2, 3, 250]);

    await store.put(
      { owner: "asset" as const, ownerId: "asset-1", documentId: "doc-1" },
      bytes,
    );

    assert.deepEqual(
      await store.get({
        owner: "asset" as const,
        ownerId: "asset-1",
        documentId: "doc-1",
      }),
      bytes,
    );
  });

  /**
   * A KULCS KÉT RÉSZE VALÓBAN KÉT RÉSZ. Ugyanaz a `documentId` két külön
   * eszköz alatt két külön dokumentum. Ha a megvalósítás bármelyik felét
   * elhagyná a kulcsból, ez az állítás pirosodik.
   */
  it("keeps the same document id apart under two assets", async () => {
    const store = new InMemoryDocumentStore();

    await store.put(
      { owner: "asset" as const, ownerId: "asset-1", documentId: "same" },
      Uint8Array.from([1]),
    );
    await store.put(
      { owner: "asset" as const, ownerId: "asset-2", documentId: "same" },
      Uint8Array.from([2]),
    );

    assert.deepEqual(
      await store.get({
        owner: "asset" as const,
        ownerId: "asset-1",
        documentId: "same",
      }),
      Uint8Array.from([1]),
    );
    assert.deepEqual(
      await store.get({
        owner: "asset" as const,
        ownerId: "asset-2",
        documentId: "same",
      }),
      Uint8Array.from([2]),
    );
  });

  /**
   * AZ ELVÁLASZTÓ-ÜTKÖZÉS, és ez az az állítás, amiért a kulcs JSON-alakú.
   *
   * Egy egyszerű összefűzés (`assetId` + elválasztó + `documentId`) esetén az
   * alábbi két KÜLÖNBÖZŐ kulcs ugyanarra a szövegre képződne le, tehát a
   * második `put` felülírná az elsőt. A hiba néma: nincs kivétel, nincs hibás
   * státusz, csak a tartalom cserélődik ki.
   */
  it("does not let a separator inside an id collide two keys", async () => {
    const store = new InMemoryDocumentStore();

    await store.put(
      { owner: "asset" as const, ownerId: "a", documentId: "b c" },
      Uint8Array.from([1]),
    );
    await store.put(
      { owner: "asset" as const, ownerId: "a b", documentId: "c" },
      Uint8Array.from([2]),
    );

    assert.deepEqual(
      await store.get({
        owner: "asset" as const,
        ownerId: "a",
        documentId: "b c",
      }),
      Uint8Array.from([1]),
    );
    assert.deepEqual(
      await store.get({
        owner: "asset" as const,
        ownerId: "a b",
        documentId: "c",
      }),
      Uint8Array.from([2]),
    );
  });

  it("answers null for a document it never stored", async () => {
    const store = new InMemoryDocumentStore();

    assert.equal(
      await store.get({
        owner: "asset" as const,
        ownerId: "asset-1",
        documentId: "missing",
      }),
      null,
    );
  });

  /**
   * A MÁSOLÁS A HÍVÓ FELŐL. A fájlrendszeres változat a bájtokat KIÍRJA, tehát
   * a hívó által utólag módosított tömb nem változtatja meg a tárolt tartalmat.
   * Ha a memóriabeli megvalósítás a kapott tömböt tartaná meg, a két
   * megvalósítás csendben eltérne, és ez az állítás pirosodik.
   */
  it("is not changed by the caller mutating the array it handed in", async () => {
    const store = new InMemoryDocumentStore();
    const bytes = Uint8Array.from([1, 2, 3]);

    await store.put(
      { owner: "asset" as const, ownerId: "asset-1", documentId: "doc-1" },
      bytes,
    );
    bytes[0] = 99;

    assert.deepEqual(
      await store.get({
        owner: "asset" as const,
        ownerId: "asset-1",
        documentId: "doc-1",
      }),
      Uint8Array.from([1, 2, 3]),
    );
  });

  /**
   * A MÁSOLÁS A TÁROLÓ FELŐL, ugyanabból az okból: a lemezről beolvasott tömb
   * módosítása sem ír vissza a lemezre.
   */
  it("is not changed by the caller mutating what it read back", async () => {
    const store = new InMemoryDocumentStore();
    await store.put(
      { owner: "asset" as const, ownerId: "asset-1", documentId: "doc-1" },
      Uint8Array.from([1, 2, 3]),
    );

    const first = await store.get({
      owner: "asset" as const,
      ownerId: "asset-1",
      documentId: "doc-1",
    });
    assert.ok(first);
    first[0] = 99;

    assert.deepEqual(
      await store.get({
        owner: "asset" as const,
        ownerId: "asset-1",
        documentId: "doc-1",
      }),
      Uint8Array.from([1, 2, 3]),
    );
  });

  it("reports whether the delete removed anything", async () => {
    const store = new InMemoryDocumentStore();
    const key = {
      owner: "asset" as const,
      ownerId: "asset-1",
      documentId: "doc-1",
    };
    await store.put(key, Uint8Array.from([1]));

    assert.equal(await store.delete(key), true);
    assert.equal(await store.get(key), null);
    assert.equal(await store.delete(key), false);
  });

  /**
   * A memóriabeli tároló mindig kész. Ez nem a beállítottság MÉRÉSE, hanem
   * annak kimondása, hogy itt nincs mit beállítani: a jelölő fájlt és az
   * írhatóságot a fájlrendszeres változat vizsgálja, a 3. lépésben.
   */
  it("lists what it holds, as keys rather than strings", async () => {
    const store = new InMemoryDocumentStore();
    await store.put(
      { owner: "asset" as const, ownerId: "a", documentId: "1" },
      Uint8Array.from([1]),
    );
    await store.put(
      { owner: "asset" as const, ownerId: "b", documentId: "2" },
      Uint8Array.from([2]),
    );

    const listed = await collectDocumentKeys(store.list());

    assert.equal(listed.length, 2);
    assert.deepEqual(
      listed
        .map((key) => `${key.owner}/${key.ownerId}/${key.documentId}`)
        .sort(),
      ["asset/a/1", "asset/b/2"],
    );
  });

  it("stops listing what was deleted", async () => {
    const store = new InMemoryDocumentStore();
    const key = { owner: "asset" as const, ownerId: "a", documentId: "1" };
    await store.put(key, Uint8Array.from([1]));
    await store.delete(key);

    assert.deepEqual(await collectDocumentKeys(store.list()), []);
  });

  it("describes itself as ready, because there is nothing to configure", async () => {
    const store = new InMemoryDocumentStore();

    assert.deepEqual(await store.describe(), { state: "ready" });
  });
});
