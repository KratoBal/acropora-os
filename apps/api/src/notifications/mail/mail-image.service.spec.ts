import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";
import sharp from "sharp";

import type {
  MailImageRepository,
  MailImageSummary,
} from "./mail-image.repository.js";
import {
  inspectMailImage,
  MAIL_IMAGE_MAX_BYTES,
  MailImageService,
  safeMailImageFileName,
} from "./mail-image.service.js";

/**
 * A FELTOLTES VIZSGALATA VALODI KEPEKEN. A fixturakat a `sharp` allitja elo,
 * nem kezzel irt bajtsor: egy kezzel irt "PNG" fejlec a vizsgalo egy
 * rovidebb, csak a fejlecet nezo valtozatan is atmenne.
 */
const kep = (
  format: "png" | "jpeg" | "gif" | "webp",
  width = 40,
  height = 20,
) =>
  sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 80, b: 160 } },
  })
    .toFormat(format)
    .toBuffer();

const elutasit = async (bytes: Uint8Array, minta: RegExp) =>
  assert.rejects(
    () => inspectMailImage(bytes),
    (hiba: unknown) =>
      hiba instanceof BadRequestException && minta.test(hiba.message),
  );

describe("a levélkép vizsgálata", () => {
  for (const [format, tipus] of [
    ["png", "image/png"],
    ["jpeg", "image/jpeg"],
    ["gif", "image/gif"],
    ["webp", "image/webp"],
  ] as const)
    it(`${format}: elfogadja, a típus és a méret a tartalomból jön`, async () => {
      const eredmeny = await inspectMailImage(await kep(format));
      assert.equal(eredmeny.contentType, tipus);
      assert.equal(eredmeny.width, 40);
      assert.equal(eredmeny.height, 20);
    });

  /**
   * AZ SVG SZOVEG, AMIBEN SZKRIPT ALLHAT -- a `sharp` olvassa, tehat a
   * formatum-listanak kell kizarnia. Ha ez zold marad egy olyan valtozaton,
   * ami minden olvashato kepet elfogad, a lista nem vedett.
   */
  it("az SVG-t elutasítja, pedig olvasható kép", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>',
    );
    await elutasit(svg, /PNG, JPG, GIF vagy WebP/);
  });

  it("a nem kép fájlt elutasítja", async () => {
    await elutasit(Buffer.from("%PDF-1.7 nem kep"), /nem olvasható képként/);
  });

  it("az üres fájlt elutasítja", async () => {
    await elutasit(new Uint8Array(), /üres/);
  });

  it("az 1 MB feletti fájlt elutasítja", async () => {
    await elutasit(new Uint8Array(MAIL_IMAGE_MAX_BYTES + 1), /1 MB/);
  });

  it("az 5000 képpontnál szélesebb képet elutasítja", async () => {
    await elutasit(await kep("png", 5001, 1), /5000/);
  });

  /**
   * A JPEG METAADATA (pl. a keszites helye) NEM MEHET KI A VEVOKNEK. A
   * fixturaba szerzoi jog kerul EXIF-kent; a tarolt kepben nem szabad
   * maradnia.
   */
  it("a JPEG metaadatát eldobja", async () => {
    const exifes = await sharp(await kep("jpeg"))
      .withExif({ IFD0: { Copyright: "Titkos hely" } })
      .jpeg()
      .toBuffer();
    assert.ok(
      (await sharp(exifes).metadata()).exif,
      "a fixtura nem visel EXIF-et",
    );
    const eredmeny = await inspectMailImage(exifes);
    assert.equal(
      (await sharp(Buffer.from(eredmeny.bytes)).metadata()).exif,
      undefined,
    );
  });

  it("a PNG bájtjait változatlanul hagyja", async () => {
    const png = await kep("png");
    const eredmeny = await inspectMailImage(png);
    assert.deepEqual(Buffer.from(eredmeny.bytes), png);
  });
});

describe("a levélkép fájlneve", () => {
  it("ASCII marad, útvonal és ékezet nélkül", () => {
    assert.equal(
      safeMailImageFileName("C:\\\\kepek\\\\Acropora lógó.png"),
      "Acropora_logo.png",
    );
    assert.equal(safeMailImageFileName("../../etc/passwd"), "passwd");
    assert.equal(
      safeMailImageFileName('logo"\r\nBcc: x.png'),
      "logo_Bcc_x.png",
    );
    assert.equal(safeMailImageFileName(""), "kep");
  });
});

describe("a levélkép feltöltése", () => {
  const OSSZEGZES: MailImageSummary = {
    id: "logo1",
    fileName: "logo.png",
    contentType: "image/png",
    sizeBytes: 4,
    width: 40,
    height: 20,
    createdAt: new Date("2026-09-28T08:00:00Z"),
  };

  function szolgaltatas(meglevo: MailImageSummary | null) {
    const letrehozott: unknown[] = [];
    const tarolo: Pick<
      MailImageRepository,
      "findBySha256" | "create" | "list"
    > = {
      findBySha256: async () => meglevo,
      create: async (input) => {
        letrehozott.push(input);
        return { ...OSSZEGZES, id: "uj1" };
      },
      list: async () => [],
    };
    return {
      service: new MailImageService(tarolo as MailImageRepository),
      letrehozott,
    };
  }

  /** A LOGO NEM SZAPORODIK: ugyanaz a fajl masodszor a meglevo sort adja. */
  it("ugyanazt a fájlt másodszor NEM tárolja el újra", async () => {
    const { service, letrehozott } = szolgaltatas(OSSZEGZES);
    const eredmeny = await service.upload(
      { originalname: "logo.png", buffer: await kep("png") },
      "user-1",
    );
    assert.equal(eredmeny.id, "logo1");
    assert.deepEqual(letrehozott, []);
  });

  it("új fájlt a vizsgált alakban tárol, biztonságos névvel", async () => {
    const { service, letrehozott } = szolgaltatas(null);
    const eredmeny = await service.upload(
      { originalname: "Acropora lógó.png", buffer: await kep("png") },
      "user-1",
    );
    assert.equal(eredmeny.id, "uj1");
    assert.equal(letrehozott.length, 1);
    assert.deepEqual(
      (({ fileName, contentType, width, height, uploadedById }) => ({
        fileName,
        contentType,
        width,
        height,
        uploadedById,
      }))(letrehozott[0] as Record<string, unknown>),
      {
        fileName: "Acropora_logo.png",
        contentType: "image/png",
        width: 40,
        height: 20,
        uploadedById: "user-1",
      },
    );
  });
});
