import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InMemoryDocumentStore } from "../../service-assets/document-store/in-memory-document-store.js";
import {
  publishProductImages,
  type PublishDeps,
  type PublishableImage,
} from "./product-image-publisher.js";
import { MedusaAdminHttpError } from "./medusa-admin.client.js";
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
  /** Nyers bajtok EGY kephez, ha nem a JPEG-fejleces alapertelmezes kell. */
  nyersBajtok?: { n: number; bytes: Uint8Array };
  linkelt?: Record<string, string>;
  feltoltesDob?: boolean;
  feltoltesHttpHiba?: { status: number; body: string };
}) {
  const store = new InMemoryDocumentStore();
  for (const n of options.tarolt ?? [])
    await store.put(
      {
        owner: "product",
        ownerId: PROD,
        documentId: productImageDocumentId(kep(n).url),
      },
      /**
       * VALODI JPEG-FEJLEC, es ez nem koritmenyeskedes: a publikalo 2026-09-04
       * ota a BAJTOKBOL ismeri fel a tipust, es amit nem ismer fel, azt NEM
       * tolti fel. Egy `[n]` egybajtos fixtura ezert MINDEN feltoltest
       * blokkolna -- es a hiba ugy nezne ki, mintha a feltoltes romlott volna
       * el.
       *
       * Az utolso bajt tovabbra is `n`, hogy a kepek megkulonboztethetok
       * maradjanak (a meret- es sorrend-allitasok arra epulnek).
       */
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, n]),
    );

  if (options.nyersBajtok)
    await store.put(
      {
        owner: "product",
        ownerId: PROD,
        documentId: productImageDocumentId(kep(options.nyersBajtok.n).url),
      },
      options.nyersBajtok.bytes,
    );

  const feltoltott: {
    filename: string;
    meret: number;
    jeloloBajt: number | undefined;
    contentType: string;
  }[] = [];
  const linkelt = new Map(Object.entries(options.linkelt ?? {}));

  const d: PublishDeps = {
    store,
    medusa: {
      // eslint-disable-next-line @typescript-eslint/require-await
      uploadFile: async (file) => {
        if (options.feltoltesHttpHiba)
          throw new MedusaAdminHttpError(
            options.feltoltesHttpHiba.status,
            options.feltoltesHttpHiba.body,
          );
        if (options.feltoltesDob) throw new Error("a bolt nem valaszol");
        feltoltott.push({
          filename: file.filename,
          meret: file.content.length,
          /** A fixtura utolso bajtja azonositja, MELYIK kep ment ki. */
          jeloloBajt: file.content[file.content.length - 1],
          contentType: file.contentType,
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

  /**
   * A TIPUS A BAJTOKBOL MEGY KI, ES A NEV IS AHHOZ IGAZODIK.
   *
   * A publikalo 2026-09-04-ig KEMENYEN `image/jpeg` tipust kuldott (a hivo
   * mezojet), mert a `ProductImage` soron nincs tipus-mezo. Ez az allitas a
   * BEKOTEST meri: a felismero kulon modulban all, sajat tesztekkel -- de egy
   * tiszta fuggveny, amit senki nem hiv, pontosan ugy nez ki, mint egy
   * bekotott.
   */
  it("PNG bajtoknal PNG tipus es .png nev megy ki", async () => {
    const f = await deps({
      nyersBajtok: {
        n: 3,
        bytes: new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x03,
        ]),
      },
    });

    await publishProductImages(PROD, [kep(3)], f.deps);

    assert.equal(f.feltoltott.length, 1);
    assert.equal(f.feltoltott[0]?.contentType, "image/png");
    assert.match(f.feltoltott[0]?.filename ?? "", /\.png$/);
  });

  /**
   * AMIT NEM ISMERUNK FEL, AZT NEM TOLTJUK FEL -- ES A KIHAGYAS HANGOS.
   *
   * Ez VALTOZAS a korabbi viselkedeshez kepest: eddig minden bajtsor kiment,
   * `image/jpeg` tipussal. Egy nem-kep fajlt kikuldeni a boltba rosszabb, mint
   * kihagyni, es a `blockedBy` sor a jelentesbe kerul -- a termek tobbi mezoje
   * ettol meg kimegy.
   */
  it("fel nem ismert tartalmat NEM tolt fel, es megnevezi", async () => {
    const f = await deps({
      nyersBajtok: { n: 4, bytes: new Uint8Array([0x3c, 0x21, 0x44, 0x4f]) },
    });

    const eredmeny = await publishProductImages(PROD, [kep(4)], f.deps);

    assert.equal(
      f.feltoltott.length,
      0,
      "fel nem ismert tartalmat toltott fel",
    );
    assert.deepEqual(eredmeny.urls, []);
    assert.match(eredmeny.blockedBy ?? "", /nem ismerhető fel képként/);
  });

  it("a bájtok a tárolóból jönnek, nem a forrás URL-ről", async () => {
    const f = await deps({ tarolt: [7] });

    await publishProductImages(PROD, [kep(7)], f.deps);

    /**
     * A JELOLO BAJTOT nezzuk, nem a MERETET.
     *
     * A meret 2026-09-04-ig 1 volt, mert a fixtura egyetlen bajtot tarolt.
     * Azota a tartalomnak valodi kep-fejlecet kell viselnie (a publikalo a
     * bajtokbol ismeri fel a tipust), tehat a meret a fixtura reszlete lett --
     * es egy allitas, ami egy fixtura-reszletre epul, a kovetkezo valtozasnal
     * ujra eltorik. Az utolso bajt viszont AZT mondja meg, amit az allitas
     * neve iger: MELYIK kep bajtjai mentek ki.
     */
    assert.equal(
      f.feltoltott[0]?.jeloloBajt,
      7,
      "nem a tárolt bájtokat küldte",
    );
  });
});

/**
 * A MEDUSA VALASZANAK TORZSE NEM KERULHET A KIMENETRE.
 *
 * A `blockedBy` a parancssori kimenetre kerul, es onnantol nem tudjuk, ki
 * olvassa. A `MedusaAdminHttpError` uzenete viszont a valasz elso 500
 * karakteret is viszi -- a `String(error)` ezt eddig atengedte.
 *
 * Ez NEM uj szabaly: a keszlet-vetites ugyanezt mar megoldotta, es ott minden
 * megnevezett Medusa-hiba a `describeMedusaFailure`-on megy at. Ez a ket hely
 * ugyanannak a javitasnak a HATOKORE volt (nautilus merese, 2026-09-04).
 */
describe("a feltoltes hibaja nem viszi ki a valasz torzset", () => {
  const TITOK =
    '{"message":"Unauthorized","echoed":"sk_test_titok123","detail":"belso reszlet"}';

  it("a STATUSZ megy ki, a TORZS nem", async () => {
    /*
      MI PIROSIT: a `String(error)` visszaallitasa. Az a
      `MedusaAdminHttpError: MEDUSA_ADMIN_HTTP_401: {...}` alakot adja, benne a
      teljes torzzsel -- es a hiba NEMA, mert a sor amugy helyesnek latszik.
    */
    const f = await deps({
      tarolt: [1],
      feltoltesHttpHiba: { status: 401, body: TITOK },
    });
    const eredmeny = await publishProductImages(PROD, [kep(1)], f.deps);

    assert.equal(
      eredmeny.blockedBy?.includes("HTTP 401"),
      true,
      eredmeny.blockedBy ?? "",
    );
    assert.equal(eredmeny.blockedBy?.includes("sk_test_titok123"), false);
    assert.equal(eredmeny.blockedBy?.includes("belso reszlet"), false);
    assert.equal(eredmeny.blockedBy?.includes("MEDUSA_ADMIN_HTTP"), false);
  });

  it("a NEM HTTP hiba uzenete viszont megmarad", async () => {
    /*
      ISMERT POZITIV KONTROLL: a fenti allitasok akkor is teljesulnenek, ha a
      `blockedBy` MINDEN hibaszoveget elnyelne. Egy futtatokornyezeti hiba
      (idotullepes, nevfeloldas) NEM a Medusa valaszabol jon, tehat nem
      visszhangozhat semmit -- annak at kell mennie.
    */
    const f = await deps({ tarolt: [1], feltoltesDob: true });
    const eredmeny = await publishProductImages(PROD, [kep(1)], f.deps);

    assert.equal(
      eredmeny.blockedBy?.includes("a bolt nem valaszol"),
      true,
      eredmeny.blockedBy ?? "",
    );
  });
});
