import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
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
function setup(projection: () => Promise<HomepageProjectionResult>) {
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
  return { service: new HomepageContentService(store, projection), saved };
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
