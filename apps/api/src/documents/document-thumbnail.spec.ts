import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  makeThumbnail,
  THUMBNAIL_CONTENT_TYPE,
  THUMBNAIL_MAX_EDGE,
  thumbnailResponse,
  thumbnailable,
  wantsThumbnail,
} from "./document-thumbnail.js";

/**
 * A BEMENET VALODI KEP, NEM ATTRAPP.
 *
 * A `sharp` ugyanaz a konyvtar, amit az eloallitas hasznal, es itt csak a
 * BEMENET keszitesere szolgal. Egy kitalalt bajtsor semmit nem bizonyitana:
 * azon az atmeretezes elhasalna, es a `null` ag futna le -- vagyis pontosan a
 * mert viselkedes maradna ki.
 */
async function kep(
  szelesseg: number,
  magassag: number,
  extra?: { orientation?: number },
): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const nyers = Buffer.alloc(szelesseg * magassag * 3);
  for (let i = 0; i < nyers.length; i += 1) nyers[i] = (i * 37) % 251;
  let kep = sharp(nyers, {
    raw: { width: szelesseg, height: magassag, channels: 3 },
  });
  if (extra?.orientation)
    kep = kep.withMetadata({ orientation: extra.orientation });
  const bajtok = await kep.jpeg({ quality: 92 }).toBuffer();

  /*
    A FIXTURA IS MERES: ha a kert EXIF-allas nem kerul bele, a ra epulo allitas
    NEM a kodot merne, hanem a sajat hitunket -- es a bukasa hibas eszkoznek
    latszana. Merve 2026-09-18: az elso alakom (`withExifMerge` az `IFD0`
    agon) `orientation: 1` erteket adott, es majdnem a `makeThumbnail`-t
    kezdtem javitani miatta.
  */
  if (extra?.orientation) {
    const ellenorzes = await sharp(bajtok).metadata();
    assert.equal(
      ellenorzes.orientation,
      extra.orientation,
      "a fixtura nem viseli a kert EXIF allast, tehat nem mer semmit",
    );
  }
  return bajtok;
}

async function meret(
  bajtok: Buffer,
): Promise<{ width: number; height: number }> {
  const { default: sharp } = await import("sharp");
  const m = await sharp(bajtok).metadata();
  return { width: m.width ?? 0, height: m.height ?? 0 };
}

describe("a csempe kepe", () => {
  it("egy nagy fenykepbol kisebb JPEG-et ad, a hosszabb ele a hataron", async () => {
    const eredeti = await kep(1600, 1200);
    const belyeg = await makeThumbnail(eredeti, "jpeg");

    assert.ok(belyeg, "belyegkepnek kellett volna keszulnie");
    const { width, height } = await meret(belyeg);
    assert.equal(width, THUMBNAIL_MAX_EDGE);
    assert.equal(height, (THUMBNAIL_MAX_EDGE * 1200) / 1600);
    assert.ok(
      belyeg.length < eredeti.length,
      `a belyegkep (${belyeg.length}) nem kisebb az eredetinel (${eredeti.length})`,
    );
  });

  /**
   * AZ EXIF FORGATAS NEM RESZLETKERDES, ES EZ AZ AZ ALLITAS, AMI EGY NEMA
   * HIBAT FOG MEG: a telefonok a kepet nyersen mentik, es az allast egy
   * cimkeben jelolik. A bongeszo es a natív kepbetolto ERTELMEZI, a nyers
   * atmeretezes NEM -- `rotate()` nelkul a csempe oldalra fordulna, mikozben a
   * teljes kepernyos nezet allna. Semmi nem hibazna: csak forditva lenne.
   */
  it("az EXIF allast alkalmazza, nem csak atmeretez", async () => {
    // 6 = 90 fokkal el van forgatva; a helyes kimenet ALLO.
    const fekvo = await kep(1600, 1200, { orientation: 6 });
    const belyeg = await makeThumbnail(fekvo, "jpeg");

    assert.ok(belyeg);
    const { width, height } = await meret(belyeg);
    assert.ok(
      height > width,
      `az allasra forgatott kepbol allo belyegkepnek kell lennie, ez ${width}x${height}`,
    );
  });

  it("a mar kicsi kepet nem nagyitja fel", async () => {
    const kicsi = await kep(200, 150);
    const belyeg = await makeThumbnail(kicsi, "jpeg");

    assert.ok(belyeg);
    assert.deepEqual(await meret(belyeg), { width: 200, height: 150 });
  });

  it("PDF-hez nem keszit belyegkepet", async () => {
    assert.equal(thumbnailable("pdf"), false);
    assert.equal(
      await makeThumbnail(Buffer.from("%PDF-1.4"), "pdf"),
      null,
      "a PDF-bol nem szabad belyegkepnek keszulnie",
    );
  });

  /**
   * A HIBA NEM ALLITJA MEG A FELTOLTEST. Ha ez dobna, egy serult fajl az egesz
   * feltoltest vinne el -- egy csempe-optimalizacio miatt.
   */
  it("olvashatatlan tartalomnal `null`-t ad, nem dob", async () => {
    const szemet = Buffer.from("ez nem kep, csak ugy hivjak");
    assert.equal(await makeThumbnail(szemet, "jpeg"), null);
  });
});

describe("melyik valtozatot kerte a hivo", () => {
  /**
   * A POZITIV KONTROLL ITT NEM EGY TAVOLI HELYES ERTEK, HANEM A LEGKOZELEBBI
   * TEVESZTES: az elgepelt es a resz-egyezo alak. Egy `startsWith` alaku
   * ellenorzes a `thumbnail-xyz` erteket is atengedne, es az a hiba pontosan
   * ilyen bemeneten latszik.
   */
  it("csak a pontos ertek keri a belyegkepet", () => {
    assert.equal(wantsThumbnail("thumbnail"), true);
    assert.equal(wantsThumbnail(undefined), false);
    assert.equal(wantsThumbnail(""), false);
    assert.equal(wantsThumbnail("thumbnial"), false);
    assert.equal(wantsThumbnail("thumbnails"), false);
    assert.equal(wantsThumbnail("Thumbnail"), false);
  });
});

describe("a belyegkep-valasz alakja", () => {
  it("a belyegkep tipusat adja, de az EREDETI fajlnevet", () => {
    const valasz = thumbnailResponse({
      fileName: "kompresszor.jpg",
      thumbnail: Uint8Array.from([1, 2, 3]),
    });
    assert.equal(valasz.contentType, THUMBNAIL_CONTENT_TYPE);
    assert.equal(valasz.fileName, "kompresszor.jpg");
    assert.deepEqual([...valasz.bytes], [1, 2, 3]);
  });
});
