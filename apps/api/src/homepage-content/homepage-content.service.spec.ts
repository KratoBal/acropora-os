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
} from "./homepage-content.service.js";

/*
  THE HOME PAGE CONTENT SERVICE. What turns these red: an invalid record
  stored; a save that skips the projection, or one that fails because the
  projection failed (the save must be kept); an empty store answering anything
  but "nothing set" (empty texts, null slides); a null slides list turning into
  an empty list on the way out (that would mean "no hero" in the shop).
*/
function setup(
  projection: () => Promise<"sent" | "unchanged">,
  options: { switchedOn?: boolean; env?: NodeJS.ProcessEnv } = {},
) {
  let row: HomepageContentRow | null =
    options.switchedOn === false
      ? null
      : {
          key: "main",
          texts: {},
          slides: null,
          projectionEnabled: true,
          updatedAt: new Date("2026-10-20T11:00:00Z"),
        };
  const saved: { input: HomepageContentInput; userId: string }[] = [];
  const store: HomepageContentStore = {
    find: async () => row,
    save: async (key, input, userId) => {
      saved.push({ input, userId });
      row = {
        key,
        texts: input.texts,
        slides: input.slides,
        projectionEnabled: row?.projectionEnabled ?? false,
        updatedAt: new Date("2026-10-20T12:00:00Z"),
      };
      return row;
    },
    setProjection: async (key, enabled) => {
      row = {
        key,
        texts: row?.texts ?? {},
        slides: row?.slides ?? null,
        projectionEnabled: enabled,
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
      return { url: `https://shop.example/static/${image.fileName}` };
    },
    options.env ?? {},
  );
  return { service, saved, uploads };
}

describe("HomepageContentService", () => {
  it("answers 'nothing set, switch off' before the first save", async () => {
    const { service } = setup(async () => "sent", { switchedOn: false });
    assert.deepEqual(await service.get(), {
      texts: {},
      slides: null,
      updatedAt: null,
      projectionEnabled: false,
    });
  });

  it("stores a valid record with the user and asks for one projection when the switch is on", async () => {
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

  it("does not project, and says off, when neither the switch nor the variable is on", async () => {
    let asked = 0;
    const { service, saved } = setup(
      async () => {
        asked++;
        return "sent";
      },
      { switchedOn: false },
    );
    const out = await service.save({ texts: {}, slides: [] }, "u-1");
    assert.equal(out.projection, "off");
    assert.equal(asked, 0);
    assert.equal(saved.length, 1);
  });

  it("the variable turns it on without the switch, its absence does not turn the switch off", async () => {
    let asked = 0;
    const projection = async () => {
      asked++;
      return "sent" as const;
    };
    const viaVariable = setup(projection, {
      switchedOn: false,
      env: { MEDUSA_PROJECT_HOMEPAGE_CONTENT: "true" },
    });
    assert.equal(
      (await viaVariable.service.save({ texts: {}, slides: null }, "u"))
        .projection,
      "sent",
    );
    const viaSwitch = setup(projection, { env: {} });
    assert.equal(
      (await viaSwitch.service.save({ texts: {}, slides: null }, "u"))
        .projection,
      "sent",
    );
    const other = setup(projection, {
      switchedOn: false,
      env: { MEDUSA_PROJECT_HOMEPAGE_CONTENT: "false" },
    });
    assert.equal(
      (await other.service.save({ texts: {}, slides: null }, "u")).projection,
      "off",
    );
    assert.equal(asked, 2);
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

  it("the administrator's switch is its own write and keeps the content", async () => {
    const { service } = setup(async () => "sent", { switchedOn: false });
    await service.save({ texts: { "mit.cim": "Új" }, slides: null }, "u-1");
    assert.deepEqual(await service.setProjection(true, "admin"), {
      projectionEnabled: true,
    });
    const content = await service.get();
    assert.equal(content.projectionEnabled, true);
    assert.equal(content.texts["mit.cim"], "Új");
    await assert.rejects(
      service.setProjection("igen", "admin"),
      BadRequestException,
    );
  });
});

describe("toHomepageContent", () => {
  it("reads a hand-edited row defensively", () => {
    const row = {
      key: "main",
      texts: { "mit.cim": "ok", "mit.alcim": 5 },
      slides: "nem lista",
      projectionEnabled: "igen",
      updatedAt: new Date("2026-10-20T12:00:00Z"),
    } as unknown as HomepageContentRow;
    const content = toHomepageContent(row);
    assert.deepEqual(content.texts, { "mit.cim": "ok" });
    assert.equal(content.slides, null);
    assert.equal(content.projectionEnabled, false);
  });
});

describe("HomepageContentService.uploadImage", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0,
  ]);
  const gif = Buffer.from("GIF89a....");
  const html = Buffer.from("<html><script>alert(1)</script></html>");

  it("names the file after what it IS and never after the client's name", async () => {
    const { service, uploads } = setup(async () => "sent");
    await service.uploadImage({ originalname: "hero.png", buffer: jpeg });
    await service.uploadImage({ originalname: "kep.jpg", buffer: png });
    assert.match(uploads[0]?.fileName ?? "", /^kezdolap-[0-9a-f-]{36}\.jpg$/);
    assert.equal(uploads[0]?.contentType, "image/jpeg");
    assert.match(uploads[1]?.fileName ?? "", /^kezdolap-[0-9a-f-]{36}\.png$/);
    assert.notEqual(uploads[0]?.fileName, uploads[1]?.fileName);
  });

  it("takes nothing of a hostile client name into the shop's file name (barracuda, #1721)", async () => {
    const { service, uploads } = setup(async () => "sent");
    for (const originalname of [
      "../../x.png",
      "a\\b.png",
      ".htaccess",
      "a/b/c.webp",
      "..\\..\\y.jpg",
    ])
      await service.uploadImage({ originalname, buffer: jpeg });
    assert.equal(uploads.length, 5);
    for (const upload of uploads) {
      assert.doesNotMatch(upload.fileName, /[/\\]/);
      assert.ok(!upload.fileName.startsWith("."));
      assert.match(upload.fileName, /^[A-Za-z0-9._-]+$/);
    }
  });

  it("refuses what is not a JPEG, PNG or WebP image, before the shop sees it", async () => {
    const { service, uploads } = setup(async () => "sent");
    for (const buffer of [html, gif, Buffer.alloc(0), Buffer.from("x")])
      await assert.rejects(
        service.uploadImage({ originalname: "kep.jpg", buffer }),
        BadRequestException,
      );
    assert.equal(uploads.length, 0);
  });

  it("refuses an image over 8 MB", async () => {
    const { service, uploads } = setup(async () => "sent");
    const big = Buffer.concat([jpeg, Buffer.alloc(8 * 1024 * 1024)]);
    await assert.rejects(
      service.uploadImage({ originalname: "nagy.jpg", buffer: big }),
      BadRequestException,
    );
    assert.equal(uploads.length, 0);
  });

  it("says so when the shop is switched off, instead of pretending", async () => {
    const { service, uploads } = setup(async () => "sent", {
      switchedOn: false,
    });
    await assert.rejects(
      service.uploadImage({ originalname: "kep.jpg", buffer: jpeg }),
      ServiceUnavailableException,
    );
    assert.equal(uploads.length, 0);
  });
});
