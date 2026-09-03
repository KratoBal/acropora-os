import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InMemoryDocumentStore } from "../../service-assets/document-store/in-memory-document-store.js";
import {
  copyProductImages,
  type CopyableImage,
  type ImageCopyDeps,
} from "./product-image-copier.js";
import { productImageDocumentId } from "./product-image-storage-key.js";

const KEP: CopyableImage = {
  id: "img_1",
  productId: "prod_1",
  url: "https://shop.acropora.hu/img/47679/AI-PUCKPHD/AI-PUCKPHD.jpg",
};

function deps(valasz: {
  ok?: boolean;
  status?: number;
  bytes?: Uint8Array;
  dob?: boolean;
}) {
  const store = new InMemoryDocumentStore();
  const rogzitett: { imageId: string; storageKey: string }[] = [];
  const lehivott: string[] = [];

  const fetchImpl = (async (url: string) => {
    lehivott.push(String(url));
    if (valasz.dob) throw new Error("halozat");
    return {
      ok: valasz.ok ?? true,
      status: valasz.status ?? 200,
      arrayBuffer: async () =>
        (valasz.bytes ?? new Uint8Array([1, 2, 3])).buffer,
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const d: ImageCopyDeps = {
    fetchImpl,
    store,
    // eslint-disable-next-line @typescript-eslint/require-await
    recordStorageKey: async (imageId: string, storageKey: string) => {
      rogzitett.push({ imageId, storageKey });
    },
  };
  return { deps: d, store, rogzitett, lehivott };
}

describe("a termékkép másolása a saját tárolónkba", () => {
  it("lehívja, eltárolja, és rögzíti a kulcsot", async () => {
    const f = deps({});

    const outcome = await copyProductImages([KEP], f.deps);

    assert.equal(outcome.copied, 1);
    assert.equal(outcome.failed.length, 0);
    assert.deepEqual(f.lehivott, [KEP.url]);
    assert.equal(f.rogzitett.length, 1);
    assert.equal(
      f.rogzitett[0]!.storageKey,
      `products/prod_1/${productImageDocumentId(KEP.url)}`,
    );
    const tarolt = await f.store.get({
      owner: "product",
      ownerId: "prod_1",
      documentId: productImageDocumentId(KEP.url),
    });
    assert.deepEqual(tarolt, new Uint8Array([1, 2, 3]));
  });

  /**
   * EZ AZ ALLITAS A MASOLO LETEZESENEK OKA, MASODIK FUTASRA.
   *
   * A `storageKey` mezo minden UNAS-import utan NULLRA all vissza (az import
   * `deleteMany` + `createMany` parossal dolgozik). A FAJL viszont ott marad,
   * es a kulcsa az URL-bol jon. Ha a masolo a mezore hagyatkozna, minden
   * import utan ujra letoltene mind a 3426 kepet.
   */
  it("ha a fájl MÁR a tárolóban van, NEM hívja le újra", async () => {
    const f = deps({});
    await copyProductImages([KEP], f.deps);

    // Ugyanaz a kep, UJ sor-azonositoval: pontosan ez tortenik egy import utan.
    const ujSor = { ...KEP, id: "img_UJ" };
    const masodik = await copyProductImages([ujSor], f.deps);

    assert.equal(masodik.alreadyStored, 1);
    assert.equal(masodik.copied, 0);
    assert.equal(f.lehivott.length, 1, "másodszor is lehívta");
    // ES A MEZOT ATTOL MEG VISSZAIRJA, kulonben orokre nullan maradna.
    assert.equal(f.rogzitett.length, 2);
    assert.equal(f.rogzitett[1]!.imageId, "img_UJ");
  });

  /**
   * A HAROM BUKASI AG, ES MINDHAROMNAL A SOR VALTOZATLAN MARAD.
   *
   * Ha barmelyiknel rogzitenenk a kulcsot, a sor AZT ALLITANA, hogy a kep
   * nalunk van -- es a kesobbi feltoltes egy nem letezo fajlt keresne.
   */
  it("HTTP-hibánál nem tárol és nem rögzít", async () => {
    const f = deps({ ok: false, status: 404 });

    const outcome = await copyProductImages([KEP], f.deps);

    assert.equal(outcome.copied, 0);
    assert.equal(outcome.failed[0]?.reason, "HTTP 404");
    assert.equal(f.rogzitett.length, 0, "hibás lehívás után rögzített");
  });

  it("hálózati hibánál nem tárol és nem rögzít", async () => {
    const f = deps({ dob: true });

    const outcome = await copyProductImages([KEP], f.deps);

    assert.equal(outcome.copied, 0);
    assert.match(outcome.failed[0]?.reason ?? "", /elhasalt/);
    assert.equal(f.rogzitett.length, 0);
  });

  /**
   * AZ URES VALASZ NEM SIKER. Egy nulla bajtos fajl a taroloban ugy nezne ki,
   * mint egy athozott kep, es a hiba a BOLTBAN jelenne meg, egy ures kep
   * helyen. A HTTP-statusz itt 200, tehat a lehivas "sikeres" -- ez pontosan az
   * a nema alak, amit kulon allitas nelkul semmi nem fogna meg.
   */
  it("ÜRES válaszra nem tárol, pedig a HTTP-státusz 200", async () => {
    const f = deps({ bytes: new Uint8Array([]) });

    const outcome = await copyProductImages([KEP], f.deps);

    assert.equal(outcome.copied, 0);
    assert.match(outcome.failed[0]?.reason ?? "", /üres/);
    assert.equal(f.rogzitett.length, 0);
  });

  /**
   * A SORREND: ELOSZOR A TAROLO, AZTAN A MEZO -- ES ERRE ALLITAS KELL, NEM
   * KOMMENT.
   *
   * A kalibracio hozta elo: a ket lepes felcserelese NULLA allitast dontott
   * pirosra, tehat a szabaly csak a fejlecben allt. Ha forditva lenne, egy
   * sikeres mezo-iras utan elhasalo tarolas olyan sort hagyna maga utan, ami
   * AZT ALLITJA, hogy a kep nalunk van -- es a kesobbi feltoltes egy nem
   * letezo fajlt keresne. A mai sorrendben a legrosszabb eset egy ARVA FAJL,
   * amit az egyeztetes megtalal.
   */
  it("ha a TÁROLÁS hasal el, a mezőt NEM írja vissza", async () => {
    const rogzitett: string[] = [];
    const d: ImageCopyDeps = {
      fetchImpl: (async () =>
        ({
          ok: true,
          status: 200,
          arrayBuffer: async () => new Uint8Array([7]).buffer,
        }) as unknown as Response) as unknown as typeof fetch,
      store: {
        // eslint-disable-next-line @typescript-eslint/require-await
        get: async () => null,
        put: () => Promise.reject(new Error("a lemez tele van")),
        delete: () => Promise.resolve(false),
        // eslint-disable-next-line require-yield
        list: async function* () {
          return;
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        status: async () => ({ state: "ready" as const }),
      } as unknown as ImageCopyDeps["store"],
      // eslint-disable-next-line @typescript-eslint/require-await
      recordStorageKey: async (imageId: string) => {
        rogzitett.push(imageId);
      },
    };

    await assert.rejects(() => copyProductImages([KEP], d));
    assert.deepEqual(
      rogzitett,
      [],
      "a tárolás bukása után is visszaírta a mezőt",
    );
  });

  /**
   * EGY BUKAS NEM ALLITJA MEG A TOBBIT. 3426 kepnel egy megszunt URL nem indok
   * arra, hogy a maradek se keruljon at.
   */
  it("egy bukás után a többi kép ATTÓL MÉG átjön", async () => {
    const store = new InMemoryDocumentStore();
    const rogzitett: string[] = [];
    let hivas = 0;
    const d: ImageCopyDeps = {
      fetchImpl: (async () => {
        hivas += 1;
        // A MASODIK hivas bukik el, a harmadik nem.
        return {
          ok: hivas !== 2,
          status: hivas === 2 ? 500 : 200,
          arrayBuffer: async () => new Uint8Array([9]).buffer,
        } as unknown as Response;
      }) as unknown as typeof fetch,
      store,
      // eslint-disable-next-line @typescript-eslint/require-await
      recordStorageKey: async (imageId: string) => {
        rogzitett.push(imageId);
      },
    };

    const outcome = await copyProductImages(
      [
        { id: "a", productId: "p", url: "https://kep/1.jpg" },
        { id: "b", productId: "p", url: "https://kep/2.jpg" },
        { id: "c", productId: "p", url: "https://kep/3.jpg" },
      ],
      d,
    );

    assert.equal(outcome.copied, 2);
    assert.equal(outcome.failed.length, 1);
    assert.equal(outcome.failed[0]?.imageId, "b");
    assert.deepEqual(rogzitett, ["a", "c"]);
  });
});
