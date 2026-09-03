import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InMemoryDocumentStore } from "../../service-assets/document-store/in-memory-document-store.js";
import {
  publishProductImages,
  type PublishDeps,
  type PublishableImage,
} from "./product-image-publisher.js";
import { productImageDocumentId } from "./product-image-storage-key.js";

const MOST = new Date("2026-09-03T20:00:00.000Z");
const PROD = "prod_1";

function kep(n: number, storageKey: string | null = "van"): PublishableImage {
  return {
    id: `img_${n}`,
    url: `https://shop.acropora.hu/img/${n}.jpg`,
    storageKey,
    fileName: `${n}.jpg`,
    contentType: "image/jpeg",
  };
}

async function deps(options: {
  tarolt?: number[];
  linkelt?: Record<string, string>;
  feltoltesDob?: boolean;
}) {
  const store = new InMemoryDocumentStore();
  for (const n of options.tarolt ?? [])
    await store.put(
      {
        owner: "product",
        ownerId: PROD,
        documentId: productImageDocumentId(kep(n).url),
      },
      new Uint8Array([n]),
    );

  const feltoltott: { filename: string; meret: number }[] = [];
  const linkelt = new Map(Object.entries(options.linkelt ?? {}));

  const d: PublishDeps = {
    store,
    medusa: {
      // eslint-disable-next-line @typescript-eslint/require-await
      uploadFile: async (file) => {
        if (options.feltoltesDob) throw new Error("a bolt nem valaszol");
        feltoltott.push({
          filename: file.filename,
          meret: file.content.length,
        });
        return {
          id: `fajl_${file.filename}`,
          url: `https://bolt/${file.filename}`,
        };
      },
    },
    links: {
      // eslint-disable-next-line @typescript-eslint/require-await
      findByImage: async (productId: string, url: string) => {
        const megvan = linkelt.get(url);
        return megvan
          ? {
              productId,
              sourceUrl: url,
              medusaFileId: "regi",
              medusaUrl: megvan,
              lastSyncedAt: MOST,
            }
          : null;
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      link: async (
        productId: string,
        url: string,
        fileId: string,
        medusaUrl: string,
      ) => {
        linkelt.set(url, medusaUrl);
        return {
          productId,
          sourceUrl: url,
          medusaFileId: fileId,
          medusaUrl,
          lastSyncedAt: MOST,
        };
      },
    },
    now: MOST,
  };
  return { deps: d, feltoltott, linkelt };
}

describe("a termékképek kivitele a kirakatba", () => {
  it("feltölti a képeket, és a bolti URL-eket SORRENDBEN adja vissza", async () => {
    const f = await deps({ tarolt: [1, 2] });

    const out = await publishProductImages(PROD, [kep(1), kep(2)], f.deps);

    assert.equal(out.blockedBy, null);
    assert.equal(out.uploaded, 2);
    assert.deepEqual(out.urls, ["https://bolt/1.jpg", "https://bolt/2.jpg"]);
  });

  it("amit a leképezés MÁR ismer, azt nem tölti fel újra", async () => {
    const f = await deps({
      tarolt: [1, 2],
      linkelt: { [kep(1).url]: "https://bolt/regi-1.jpg" },
    });

    const out = await publishProductImages(PROD, [kep(1), kep(2)], f.deps);

    assert.equal(out.reused, 1);
    assert.equal(out.uploaded, 1);
    assert.deepEqual(
      f.feltoltott.map((x) => x.filename),
      ["2.jpg"],
    );
    // ES A SORREND ATTOL MEG A BEMENETE, nem a feltoltes sorrendje.
    assert.deepEqual(out.urls, [
      "https://bolt/regi-1.jpg",
      "https://bolt/2.jpg",
    ]);
  });

  /**
   * A KOTEG-HATAR, ES EZ A MODUL LETEZESENEK OKA.
   *
   * A cel oldalon a kep-mezo CSERE-szemantikaju: egy felig feltoltott termek
   * listaja LETOROLNE a mar kint levo kepeket. Ezert minden bukasi agon URES
   * lista megy vissza, nem reszleges.
   */
  it("ha EGY képnek nincs mestere, a termék EGYETLEN URL-t sem ad", async () => {
    const f = await deps({ tarolt: [1] });

    const out = await publishProductImages(
      PROD,
      [kep(1), kep(2, null)],
      f.deps,
    );

    assert.deepEqual(out.urls, [], "részleges listát adott vissza");
    assert.match(out.blockedBy ?? "", /nincs áthozva/);
  });

  /**
   * A `storageKey` AZT ALLITJA, hogy a fajl ott van -- ez MEGNEZI. A ketto
   * elterese NEM ujra-feltoltessel javul, hanem a mester helyreallitasaval,
   * ezert kulon uzenetet kap.
   */
  it("ha a kulcs áll, de a FÁJL nincs meg, megáll és megnevezi", async () => {
    const f = await deps({ tarolt: [] });

    const out = await publishProductImages(PROD, [kep(1)], f.deps);

    assert.deepEqual(out.urls, []);
    assert.match(out.blockedBy ?? "", /a mester sérült/);
    assert.equal(f.feltoltott.length, 0);
  });

  it("elhasalt feltöltésnél sem ad részleges listát", async () => {
    const f = await deps({ tarolt: [1, 2], feltoltesDob: true });

    const out = await publishProductImages(PROD, [kep(1), kep(2)], f.deps);

    assert.deepEqual(out.urls, []);
    assert.match(out.blockedBy ?? "", /elhasalt/);
  });

  /**
   * A LEKEPEZES A FELTOLTES UTAN. Ha forditva lenne, egy elhasalt feltoltes
   * utan olyan lekepezes maradna, ami nem letezo fajlra mutat -- es a
   * kovetkezo futas azt hinne, kesz.
   */
  it("elhasalt feltöltés után NEM ír leképezést", async () => {
    const f = await deps({ tarolt: [1], feltoltesDob: true });

    await publishProductImages(PROD, [kep(1)], f.deps);

    assert.equal(f.linkelt.size, 0, "bukás után is rögzített leképezést");
  });

  it("a bájtok a tárolóból jönnek, nem a forrás URL-ről", async () => {
    const f = await deps({ tarolt: [7] });

    await publishProductImages(PROD, [kep(7)], f.deps);

    assert.equal(f.feltoltott[0]?.meret, 1, "nem a tárolt bájtokat küldte");
  });
});
