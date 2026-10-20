import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { HomepageContentInput } from "@acropora/types";

import {
  HomepageContentService,
  toHomepageContent,
  type HomepageContentRow,
  type HomepageContentStore,
  type HomepageProjectionResult,
} from "./homepage-content.service.js";

/*
  THE HOME PAGE CONTENT SERVICE. What turns these red: an invalid record
  stored; a save that skips the projection, or one that fails because the
  projection failed (the save must be kept); an empty store answering anything
  but "nothing set" (empty texts, null slides); a null slides list turning into
  an empty list on the way out (that would mean "no hero" in the shop).
*/
function setup(
  projection: () => Promise<HomepageProjectionResult>,
  shopOn = true,
) {
  let row: HomepageContentRow | null = null;
  const saved: { input: HomepageContentInput; userId: string }[] = [];
  const store: HomepageContentStore = {
    find: async () => row,
    save: async (key, input, userId) => {
      saved.push({ input, userId });
      row = {
        key,
        texts: input.texts,
        slides: input.slides,
        updatedAt: new Date("2026-10-20T12:00:00Z"),
      };
      return row;
    },
  };
  const uploads: { fileName: string; contentType: string }[] = [];
  const service = new HomepageContentService(
    store,
    projection,
    async (image) => {
      uploads.push({
        fileName: image.fileName,
        contentType: image.contentType,
      });
      return shopOn
        ? { url: `https://shop.example/static/${image.fileName}` }
        : null;
    },
  );
  return { service, saved, uploads };
}

describe("HomepageContentService", () => {
  it("answers 'nothing set' before the first save", async () => {
    const { service } = setup(async () => "off");
    assert.deepEqual(await service.get(), {
      texts: {},
      slides: null,
      updatedAt: null,
    });
  });

  it("stores a valid record with the user and asks for one projection", async () => {
    let asked = 0;
    const { service, saved } = setup(async () => {
      asked++;
      return "sent";
    });
    const out = await service.save(
      { texts: { "mit.cim": "Új" }, slides: null },
      "u-1",
    );
    assert.equal(out.projection, "sent");
    assert.equal(asked, 1);
    assert.deepEqual(saved, [
      { input: { texts: { "mit.cim": "Új" }, slides: null }, userId: "u-1" },
    ]);
    assert.equal(out.content.slides, null);
    assert.equal((await service.get()).texts["mit.cim"], "Új");
  });

  it("keeps the save when the projection fails", async () => {
    const { service, saved } = setup(async () => {
      throw new Error("shop down");
    });
    const out = await service.save({ texts: {}, slides: [] }, "u-1");
    assert.equal(out.projection, "failed");
    assert.equal(saved.length, 1);
    assert.deepEqual(out.content.slides, []);
  });

  it("refuses an invalid record before it reaches the store or the projection", async () => {
    let asked = 0;
    const { service, saved } = setup(async () => {
      asked++;
      return "sent";
    });
    for (const bad of [
      { texts: { "nincs.ilyen": "x" }, slides: null },
      { texts: { "mit.1.l1.link": "javascript:alert(1)" }, slides: null },
      { texts: {} },
    ])
      await assert.rejects(service.save(bad, "u-1"), BadRequestException);
    assert.equal(saved.length, 0);
    assert.equal(asked, 0);
  });
});

describe("toHomepageContent", () => {
  it("reads a hand-edited row defensively", () => {
    const row = {
      key: "main",
      texts: { "mit.cim": "ok", "mit.alcim": 5 },
      slides: "nem lista",
      updatedAt: new Date("2026-10-20T12:00:00Z"),
    } as HomepageContentRow;
    const content = toHomepageContent(row);
    assert.deepEqual(content.texts, { "mit.cim": "ok" });
    assert.equal(content.slides, null);
  });
});

describe("HomepageContentService.uploadImage", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0,
  ]);
  const gif = Buffer.from("GIF89a....");
  const html = Buffer.from("<html><script>alert(1)</script></html>");

  it("names the file after what it IS, not what the editor called it", async () => {
    const { service, uploads } = setup(async () => "off");
    const out = await service.uploadImage({
      originalname: "hero.png",
      buffer: jpeg,
    });
    assert.equal(out.url, "https://shop.example/static/hero.jpg");
    assert.deepEqual(uploads, [
      { fileName: "hero.jpg", contentType: "image/jpeg" },
    ]);
    await service.uploadImage({ originalname: "kep.jpg", buffer: png });
    assert.equal(uploads[1].contentType, "image/png");
  });

  it("refuses what is not a JPEG, PNG or WebP image, before the shop sees it", async () => {
    const { service, uploads } = setup(async () => "off");
    for (const buffer of [html, gif, Buffer.alloc(0), Buffer.from("x")])
      await assert.rejects(
        service.uploadImage({ originalname: "kep.jpg", buffer }),
        BadRequestException,
      );
    assert.equal(uploads.length, 0);
  });

  it("refuses an image over 8 MB", async () => {
    const { service, uploads } = setup(async () => "off");
    const big = Buffer.concat([jpeg, Buffer.alloc(8 * 1024 * 1024)]);
    await assert.rejects(
      service.uploadImage({ originalname: "nagy.jpg", buffer: big }),
      BadRequestException,
    );
    assert.equal(uploads.length, 0);
  });

  it("says so when the shop is switched off, instead of pretending", async () => {
    const { service } = setup(async () => "off", false);
    await assert.rejects(
      service.uploadImage({ originalname: "kep.jpg", buffer: jpeg }),
      ServiceUnavailableException,
    );
  });
});
